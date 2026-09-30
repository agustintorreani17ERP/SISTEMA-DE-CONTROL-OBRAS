import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { audit } from "../../domain/audit";
import { costEngine } from "../../domain/costEngine";
import { reconciliation } from "../../domain/reconciliation";
import { dashboard, itemDrill, obraInicio } from "../../domain/dashboard";
import { assertOpenPeriod } from "../../domain/progress";
import { today, toDay } from "../../domain/prices";

/** Motor de costos por rango y horas de equipo del parte diario (llave de la vía C). */
export const costosRouter = Router();

const intId = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const iso = (d: Date) => d.toISOString().slice(0, 10);

costosRouter.get(
  "/projects/:id/costos",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema, hasta: dateSchema, oficial: z.enum(["true", "false"]).optional() }).parse(req.query);
    if (q.desde > q.hasta) throw new DomainError("INVALID_RANGE", "La fecha desde es posterior a la fecha hasta", 400);
    if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new NotFoundError("Obra", projectId);
    ok(res, await costEngine(prisma, projectId, q.desde, q.hasta, { soloOficial: q.oficial === undefined ? undefined : q.oficial === "true" }));
  })
);

/** Tablero de costos (hoja 8 Resumen). Sin `desde`: desde el inicio de obra. */
costosRouter.get(
  "/projects/:id/dashboard",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema.optional(), hasta: dateSchema }).parse(req.query);
    const desde = q.desde ?? (await obraInicio(prisma, projectId));
    if (desde > q.hasta) throw new DomainError("INVALID_RANGE", "La fecha desde es posterior a la fecha hasta", 400);
    ok(res, await dashboard(prisma, projectId, desde, q.hasta));
  })
);

/** Drill-down: documentos, insumos y horas que forman el costo de un ítem en el rango. */
costosRouter.get(
  "/projects/:id/dashboard/items/:itemId",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const itemId = intId.parse(req.params.itemId);
    const q = z.object({ desde: dateSchema, hasta: dateSchema }).parse(req.query);
    ok(res, await itemDrill(prisma, projectId, itemId, q.desde, q.hasta));
  })
);

/** Conciliación por rango: documentos ↔ libro mayor ↔ motor de costos. */
costosRouter.get(
  "/projects/:id/conciliacion",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema, hasta: dateSchema }).parse(req.query);
    if (q.desde > q.hasta) throw new DomainError("INVALID_RANGE", "La fecha desde es posterior a la fecha hasta", 400);
    if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new NotFoundError("Obra", projectId);
    ok(res, await reconciliation(prisma, projectId, q.desde, q.hasta));
  })
);

costosRouter.get(
  "/projects/:id/partes-equipo",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema, hasta: dateSchema }).parse(req.query);
    const rows = await prisma.parteEquipo.findMany({
      where: { projectId, fecha: { gte: toDay(q.desde), lte: toDay(q.hasta) } },
      include: { insumo: { select: { code: true, description: true, unit: true } }, budgetItem: { select: { code: true, name: true } } },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 1000,
    });
    ok(res, rows.map((r) => ({ ...r, fecha: iso(r.fecha), horas: moneyNumber(r.horas) })));
  })
);

const parteSchema = z.object({
  fecha: dateSchema,
  lineas: z
    .array(z.object({ insumoId: intId, budgetItemId: intId.nullish(), horas: z.number().positive().max(24 * 31), nota: z.string().max(300).nullish() }))
    .min(1)
    .max(300),
  createdBy: z.string().max(120).nullish(),
});

costosRouter.post(
  "/projects/:id/partes-equipo",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = parteSchema.parse(req.body);
    if (toDay(body.fecha) > today()) throw new DomainError("FUTURE_DATE", "El parte no puede tener fecha futura", 400);
    const insumoIds = [...new Set(body.lineas.map((l) => l.insumoId))];
    const equipos = await prisma.material.count({ where: { id: { in: insumoIds }, tipo: "TIEMPO" } });
    if (equipos !== insumoIds.length) throw new DomainError("NOT_TIME_INSUMO", "Las horas se cargan sobre insumos de tipo TIEMPO (equipos)", 422);
    const itemIds = [...new Set(body.lineas.map((l) => l.budgetItemId).filter((x): x is number => Boolean(x)))];
    if (itemIds.length) {
      const n = await prisma.budgetItem.count({ where: { id: { in: itemIds }, projectId, nodeKind: "ITEM", isSystem: false } });
      if (n !== itemIds.length) throw new DomainError("INVALID_ITEM", "Hay ítems que no son del presupuesto de esta obra", 422);
    }
    const r = await prisma.$transaction(async (tx) => {
      await assertOpenPeriod(tx, projectId, body.fecha, "El parte de equipos");
      const created = await tx.parteEquipo.createMany({
        data: body.lineas.map((l) => ({
          projectId,
          fecha: toDay(body.fecha),
          insumoId: l.insumoId,
          budgetItemId: l.budgetItemId ?? null,
          horas: l.horas,
          nota: l.nota || null,
          createdBy: body.createdBy || null,
        })),
      });
      await audit(tx, { entity: "ParteEquipo", entityId: projectId, action: "CREATE", payload: { fecha: body.fecha, lineas: body.lineas.length } });
      return created.count;
    });
    ok(res, { creados: r }, 201);
  })
);

costosRouter.delete(
  "/partes-equipo/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const p = await tx.parteEquipo.findUnique({ where: { id } });
      if (!p) throw new NotFoundError("Parte de equipo", id);
      await assertOpenPeriod(tx, p.projectId, p.fecha, "El parte de equipos");
      await tx.parteEquipo.delete({ where: { id } });
      await audit(tx, { entity: "ParteEquipo", entityId: id, action: "DELETE" });
    });
    ok(res, { deleted: true, id });
  })
);
