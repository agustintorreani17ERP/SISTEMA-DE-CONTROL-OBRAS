import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { deleteCount, recordStockMovement, registerCount, stockAt, transferStock } from "../../domain/stock";
import { resolveLineItem } from "../../domain/imputation";
import { audit } from "../../domain/audit";
import { toDay, today } from "../../domain/prices";
import { moneyNumber } from "../../lib/money";
import { assertImputableItem } from "../../domain/budget";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";

/**
 * Stock por obra e insumo con movimientos fechados: compras (desde la OC), salidas, salidas
 * directas a ítem, transferencias entre obras, ajustes y conteos de inventario.
 */
export const stockRouter = Router();

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 };
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const notFuture = (d: string) => toDay(d) <= today();
const fechaSchema = dateSchema.refine(notFuture, "La fecha no puede ser futura");
const intId = z.coerce.number().int().positive();

stockRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z.object({ projectId: intId.optional(), fecha: dateSchema.optional() }).parse(req.query);
    const rows = await prisma.warehouseStock.findMany({
      where: q.projectId ? { projectId: q.projectId } : undefined,
      include: { project: true, material: true },
      orderBy: [{ projectId: "asc" }, { materialId: "asc" }],
    });
    let atDate: Map<string, number> | null = null;
    if (q.fecha) {
      const sums = await prisma.stockMovement.groupBy({
        by: ["projectId", "materialId"],
        where: { projectId: q.projectId, fecha: { lte: toDay(q.fecha) } },
        _sum: { quantity: true },
      });
      atDate = new Map(sums.map((s) => [`${s.projectId}:${s.materialId}`, moneyNumber(s._sum.quantity)]));
    }
    // La pantalla usa currentStock/reservedStock; el modelo guarda quantityOnHand.
    ok(
      res,
      rows.map((r) => ({
        ...r,
        currentStock: atDate ? atDate.get(`${r.projectId}:${r.materialId}`) ?? 0 : r.quantityOnHand,
        reservedStock: 0,
      }))
    );
  })
);

stockRouter.get(
  "/teorico",
  asyncHandler(async (req, res) => {
    const q = z.object({ projectId: intId, materialId: intId, fecha: dateSchema }).parse(req.query);
    const qty = await stockAt(prisma, q.projectId, q.materialId, q.fecha);
    ok(res, { ...q, stockTeorico: moneyNumber(qty) });
  })
);

async function selfSourced<T extends { id: number }>(tx: Prisma.TransactionClient, created: Promise<T>) {
  const m = await created;
  await tx.stockMovement.update({ where: { id: m.id }, data: { sourceId: m.id } });
  return m;
}

const salidaSchema = z.object({
  fecha: fechaSchema,
  materialId: intId,
  quantity: z.coerce.number().positive(),
  /** Obligatorio si el insumo es DIRECTO. Con ítem es una salida directa; sin ítem, salida a obra. */
  budgetItemId: intId.nullish(),
  note: z.string().max(500).optional(),
});

stockRouter.post(
  "/:projectId/salidas",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.projectId);
    const body = salidaSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const material = await tx.material.findUnique({ where: { id: body.materialId } });
      if (!material) throw new NotFoundError("Insumo", body.materialId);
      // En una salida el ítem es opcional para COMÚN (dato de control, sin costo: el costo sale del ACU).
      let budgetItemId: number | null;
      if (material.tipo === "COMUN") {
        budgetItemId = body.budgetItemId ?? null;
        if (budgetItemId) await assertImputableItem(tx, projectId, budgetItemId);
      } else {
        budgetItemId = await resolveLineItem(tx, { projectId, material, explicitItemId: body.budgetItemId });
      }
      const m = await selfSourced(
        tx,
        recordStockMovement(tx, {
          projectId,
          materialId: body.materialId,
          kind: budgetItemId ? "DIRECT_ISSUE" : "CONSUMPTION",
          quantity: -body.quantity,
          fecha: body.fecha,
          budgetItemId,
          sourceType: "StockIssue",
          sourceId: 0,
          note: body.note,
        })
      );
      await audit(tx, { entity: "StockMovement", entityId: m.id, action: m.kind, payload: { projectId, ...body } });
      return m;
    }, serializable);
    ok(res, created, 201);
  })
);

const adjustmentSchema = z.object({
  projectId: intId,
  materialId: intId,
  fecha: fechaSchema,
  quantity: z.coerce.number().refine((value) => value !== 0, "El ajuste no puede ser cero"),
  note: z.string().min(3).max(500),
});

stockRouter.post(
  "/ajustes",
  asyncHandler(async (req, res) => {
    const body = adjustmentSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const m = await selfSourced(
        tx,
        recordStockMovement(tx, {
          projectId: body.projectId,
          materialId: body.materialId,
          kind: "ADJUSTMENT",
          quantity: body.quantity,
          fecha: body.fecha,
          sourceType: "ManualAdjustment",
          sourceId: 0,
          note: body.note,
        })
      );
      await audit(tx, { entity: "StockMovement", entityId: m.id, action: "ADJUSTMENT", payload: body });
      return m;
    }, serializable);
    ok(res, created, 201);
  })
);

const transferSchema = z.object({
  fromProjectId: intId,
  toProjectId: intId,
  materialId: intId,
  fecha: fechaSchema,
  quantity: z.coerce.number().positive(),
  note: z.string().max(500).optional(),
});

stockRouter.post(
  "/transferencias",
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const r = await transferStock(tx, body);
      await audit(tx, { entity: "StockMovement", entityId: r.out.id, action: "TRANSFER", payload: body });
      await recalculateProjectFinancials(tx, body.fromProjectId);
      await recalculateProjectFinancials(tx, body.toProjectId);
      return r;
    }, serializable);
    ok(res, result, 201);
  })
);

// ─── Conteos de inventario ────────────────────────────────────────────────

stockRouter.get(
  "/conteos",
  asyncHandler(async (req, res) => {
    const q = z.object({ projectId: intId }).parse(req.query);
    const conteos = await prisma.conteoInventario.findMany({
      where: { projectId: q.projectId },
      include: { material: { select: { id: true, code: true, description: true, unit: true, tipo: true } } },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 300,
    });
    const ajustes = await prisma.stockMovement.findMany({
      where: { sourceType: "ConteoInventario", sourceId: { in: conteos.map((c) => c.id) } },
      select: { sourceId: true, quantity: true },
    });
    const diff = new Map(ajustes.map((a) => [a.sourceId, moneyNumber(a.quantity)]));
    ok(
      res,
      conteos.map((c) => {
        const d = diff.get(c.id) ?? 0;
        const contada = moneyNumber(c.cantidadContada);
        return { ...c, fecha: c.fecha.toISOString().slice(0, 10), cantidadContada: contada, diferencia: d, stockTeorico: contada - d };
      })
    );
  })
);

const conteoSchema = z.object({
  projectId: intId,
  materialId: intId,
  fecha: fechaSchema,
  cantidadContada: z.coerce.number().min(0),
  fotoUrl: z.string().max(500).nullish(),
  nota: z.string().max(500).nullish(),
  createdBy: z.string().max(120).nullish(),
});

stockRouter.post(
  "/conteos",
  asyncHandler(async (req, res) => {
    const body = conteoSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const r = await registerCount(tx, body);
      await audit(tx, { entity: "ConteoInventario", entityId: r.conteo.id, action: "CREATE", payload: body });
      return r;
    }, serializable);
    ok(
      res,
      {
        id: result.conteo.id,
        fecha: body.fecha,
        cantidadContada: body.cantidadContada,
        stockTeorico: moneyNumber(result.stockTeorico),
        diferencia: moneyNumber(result.diferencia),
      },
      201
    );
  })
);

stockRouter.delete(
  "/conteos/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const c = await deleteCount(tx, id);
      await audit(tx, { entity: "ConteoInventario", entityId: id, action: "DELETE", payload: { projectId: c.projectId, materialId: c.materialId } });
    }, serializable);
    ok(res, { deleted: true, id });
  })
);

stockRouter.get(
  "/movimientos",
  asyncHandler(async (req, res) => {
    const q = z.object({ projectId: intId.optional(), materialId: intId.optional() }).parse(req.query);
    if (!q.projectId && q.materialId) throw new DomainError("PROJECT_REQUIRED", "Indicá la obra", 400);
    ok(
      res,
      (
        await prisma.stockMovement.findMany({
          where: { projectId: q.projectId, materialId: q.materialId },
          include: {
            project: true,
            material: true,
            budgetItem: { select: { id: true, code: true, name: true } },
            counterpartProject: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ fecha: "desc" }, { id: "desc" }],
          take: 300,
        })
      ).map((m) => ({ ...m, fecha: m.fecha.toISOString().slice(0, 10), movementType: m.kind === "REVERSAL" ? "ADJUSTMENT" : m.kind }))
    );
  })
);
