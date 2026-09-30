import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { computeItemsAcu } from "../../domain/acu";
import { today, toDay } from "../../domain/prices";
import { audit } from "../../domain/audit";
import { invalidateCostCache } from "../../domain/costCache";

/** Análisis de costo unitario por ítem, biblioteca de ACU y parámetros de costo de la obra. */
export const acuRouter = Router();

const idOf = (raw: unknown, what = "Identificador") => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_ID", `${what} inválido`);
  return id;
};
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function loadItem(id: number) {
  const item = await prisma.budgetItem.findUnique({
    where: { id },
    include: { project: { select: { id: true, code: true, name: true, coeficienteK: true, ivaPct: true } } },
  });
  if (!item) throw new NotFoundError("Ítem", id);
  if (item.nodeKind !== "ITEM") throw new DomainError("NOT_AN_ITEM", "El ACU se arma sobre ítems, no sobre rubros", 400);
  return item;
}

acuRouter.put(
  "/projects/:id/parametros-costo",
  asyncHandler(async (req, res) => {
    const projectId = idOf(req.params.id, "Obra");
    const body = z
      .object({
        coeficienteK: z.number().positive().max(10).nullable(),
        ivaPct: z.number().min(0).max(100),
      })
      .parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundError("Obra", projectId);
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { coeficienteK: body.coeficienteK, ivaPct: body.ivaPct },
      select: { id: true, coeficienteK: true, ivaPct: true },
    });
    invalidateCostCache();
    ok(res, {
      id: updated.id,
      coeficienteK: updated.coeficienteK === null ? null : moneyNumber(updated.coeficienteK),
      ivaPct: moneyNumber(updated.ivaPct),
    });
  })
);

acuRouter.get(
  "/budget-items/:id/acu",
  asyncHandler(async (req, res) => {
    const item = await loadItem(idOf(req.params.id));
    const fecha = req.query.fecha ? toDay(dateSchema.parse(req.query.fecha)) : today();
    const acu = (await computeItemsAcu(prisma, [item], item.project, fecha)).get(item.id)!;
    ok(res, {
      item: {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        quantity: moneyNumber(item.totalQuantity),
        unitPrice: moneyNumber(item.unitPrice),
        path: item.path,
      },
      project: {
        id: item.project.id,
        code: item.project.code,
        name: item.project.name,
        coeficienteK: item.project.coeficienteK === null ? null : moneyNumber(item.project.coeficienteK),
        ivaPct: moneyNumber(item.project.ivaPct),
      },
      fecha: fecha.toISOString().slice(0, 10),
      ...acu,
    });
  })
);

const componentsSchema = z.object({
  componentes: z
    .array(
      z.object({
        insumoId: z.number().int().positive(),
        consumo: z.number().min(0),
        desperdicioPct: z.number().min(0).max(500).default(0),
        nota: z.string().trim().max(500).nullish(),
      })
    )
    .max(200),
});

/** Reemplaza el ACU completo del ítem (el ACU es planificación, no un hecho de costo). */
acuRouter.put(
  "/budget-items/:id/acu",
  asyncHandler(async (req, res) => {
    const item = await loadItem(idOf(req.params.id));
    const { componentes } = componentsSchema.parse(req.body);
    const ids = componentes.map((c) => c.insumoId);
    if (new Set(ids).size !== ids.length) {
      throw new DomainError("DUPLICATE_INSUMO", "Un insumo aparece dos veces en el ACU: sumá los consumos en una sola fila", 400);
    }
    const found = await prisma.material.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new DomainError("INSUMO_NOT_FOUND", "Hay insumos que no existen en el catálogo", 400);

    await prisma.$transaction(async (tx) => {
      await tx.componenteItem.deleteMany({ where: { budgetItemId: item.id } });
      if (componentes.length) {
        await tx.componenteItem.createMany({
          data: componentes.map((c, i) => ({
            budgetItemId: item.id,
            insumoId: c.insumoId,
            consumo: c.consumo,
            desperdicioPct: c.desperdicioPct,
            nota: c.nota || null,
            sortOrder: i,
          })),
        });
      }
      await audit(tx, { entity: "BudgetItem", entityId: item.id, action: "ACU_UPDATE", payload: { componentes: componentes.length } });
    });
    invalidateCostCache();
    const acu = (await computeItemsAcu(prisma, [item], item.project)).get(item.id)!;
    ok(res, acu);
  })
);

/** Biblioteca: ítems de cualquier obra que ya tienen ACU, para copiar. */
acuRouter.get(
  "/acu/biblioteca",
  asyncHandler(async (req, res) => {
    const q = z.object({ q: z.string().optional(), projectId: z.coerce.number().int().optional() }).parse(req.query);
    const text = q.q?.trim();
    const items = await prisma.budgetItem.findMany({
      where: {
        nodeKind: "ITEM",
        componentes: { some: {} },
        projectId: q.projectId,
        project: { deletedAt: null },
        OR: text
          ? [{ code: { contains: text, mode: "insensitive" } }, { name: { contains: text, mode: "insensitive" } }]
          : undefined,
      },
      include: { project: { select: { id: true, code: true, name: true, coeficienteK: true, ivaPct: true } } },
      orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }],
      take: 200,
    });
    const acus = new Map<number, Awaited<ReturnType<typeof computeItemsAcu>>>();
    for (const projectId of new Set(items.map((i) => i.projectId))) {
      const list = items.filter((i) => i.projectId === projectId);
      acus.set(projectId, await computeItemsAcu(prisma, list, list[0].project));
    }
    ok(
      res,
      items.map((i) => {
        const a = acus.get(i.projectId)!.get(i.id)!;
        return {
          id: i.id,
          code: i.code,
          name: i.name,
          unit: i.unit,
          project: { id: i.project.id, code: i.project.code, name: i.project.name },
          componentes: a.lineas.length,
          costoAcu: a.result.costoAcu,
          lineas: a.lineas.map((l) => ({ codigo: l.codigo, insumo: l.insumo, unidad: l.unidad, consumo: l.consumo, grupo: l.grupo })),
        };
      })
    );
  })
);

const copySchema = z.object({
  sourceItemId: z.number().int().positive(),
  targetItemIds: z.array(z.number().int().positive()).min(1).max(500),
  modo: z.enum(["REEMPLAZAR", "AGREGAR"]).default("REEMPLAZAR"),
});

/**
 * Copia el ACU de un ítem a otros (de la misma u otra obra). AGREGAR conserva los componentes
 * del destino y actualiza el consumo de los insumos repetidos.
 */
acuRouter.post(
  "/acu/copiar",
  asyncHandler(async (req, res) => {
    const body = copySchema.parse(req.body);
    const source = await loadItem(body.sourceItemId);
    const comps = await prisma.componenteItem.findMany({ where: { budgetItemId: source.id }, orderBy: { sortOrder: "asc" } });
    if (!comps.length) throw new DomainError("ACU_EMPTY", "El ítem de origen no tiene ACU", 400);
    const targetIds = body.targetItemIds.filter((id) => id !== source.id);
    const targets = await prisma.budgetItem.findMany({ where: { id: { in: targetIds }, nodeKind: "ITEM" } });
    if (targets.length !== targetIds.length) throw new DomainError("TARGET_NOT_FOUND", "Hay ítems de destino que no existen o no son ítems", 400);

    const avisos: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const t of targets) {
        if ((t.unit || "").toLowerCase() !== (source.unit || "").toLowerCase()) {
          avisos.push(`${t.code}: unidad ${t.unit || "—"} distinta de la del origen (${source.unit || "—"}); revisá los consumos`);
        }
        const existing = body.modo === "AGREGAR" ? await tx.componenteItem.findMany({ where: { budgetItemId: t.id } }) : [];
        if (body.modo === "REEMPLAZAR") await tx.componenteItem.deleteMany({ where: { budgetItemId: t.id } });
        let order = existing.reduce((m, c) => Math.max(m, c.sortOrder + 1), 0);
        for (const c of comps) {
          await tx.componenteItem.upsert({
            where: { budgetItemId_insumoId: { budgetItemId: t.id, insumoId: c.insumoId } },
            update: { consumo: c.consumo, desperdicioPct: c.desperdicioPct, nota: c.nota },
            create: {
              budgetItemId: t.id,
              insumoId: c.insumoId,
              consumo: c.consumo,
              desperdicioPct: c.desperdicioPct,
              nota: c.nota,
              sortOrder: body.modo === "REEMPLAZAR" ? c.sortOrder : order++,
            },
          });
        }
      }
    });
    invalidateCostCache();
    ok(res, { copiados: targets.length, avisos });
  })
);
