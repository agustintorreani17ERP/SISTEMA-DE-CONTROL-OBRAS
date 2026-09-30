import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { postCost } from "../../domain/budget";
import { rebuildProjectLedger } from "../../domain/ledgerSync";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { buildCostTree } from "./costTree";
import { DISTRIBUTION_ROOT_PATH } from "../../domain/generalExpenses";

export const costControlRouter = Router();

function projectIdParam(raw: unknown) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
  return id;
}

/**
 * GET /api/projects/:id/cost-control
 * Árbol del presupuesto con subtotales por rubro calculados en el servidor, desglose
 * del costo por fuente (OC, subcontratos, caja chica, ajustes) y KPIs de la obra.
 */
costControlRouter.get(
  "/projects/:id/cost-control",
  asyncHandler(async (req, res) => {
    ok(res, await buildCostTree(projectIdParam(req.params.id)));
  })
);

/** GET /api/projects/:id/budget-movements?budgetItemId= — historial del libro mayor. */
costControlRouter.get(
  "/projects/:id/budget-movements",
  asyncHandler(async (req, res) => {
    const projectId = projectIdParam(req.params.id);
    const budgetItemId = req.query.budgetItemId ? Number(req.query.budgetItemId) : undefined;
    ok(
      res,
      await prisma.budgetMovement.findMany({
        where: { projectId, ...(budgetItemId ? { budgetItemId } : {}) },
        include: { budgetItem: { select: { id: true, code: true, name: true } } },
        orderBy: { id: "desc" },
        take: 500,
      })
    );
  })
);

/**
 * GET /api/projects/:id/imputable-items
 * Partidas hoja donde se puede imputar un gasto (incluye Gastos Generales), con su saldo.
 */
costControlRouter.get(
  "/projects/:id/imputable-items",
  asyncHandler(async (req, res) => {
    const projectId = projectIdParam(req.params.id);
    const items = await prisma.budgetItem.findMany({
      // Los pozos "a distribuir" los carga el sistema, no se eligen a mano.
      where: { projectId, NOT: { path: { startsWith: DISTRIBUTION_ROOT_PATH } } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        unit: true,
        nodeKind: true,
        isSystem: true,
        originalAmount: true,
        costCommittedAmount: true,
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    const trail = (id: number | null): string => {
      const names: string[] = [];
      let cur = id === null ? undefined : byId.get(id);
      while (cur) {
        names.unshift(cur.name);
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      }
      return names.join(" › ");
    };
    ok(
      res,
      items
        .filter((i) => i.nodeKind === "ITEM")
        .map((i) => ({
          id: i.id,
          code: i.code,
          name: i.name,
          unit: i.unit,
          isSystem: i.isSystem,
          rubro: trail(i.parentId),
          budget: moneyNumber(i.originalAmount),
          committed: moneyNumber(i.costCommittedAmount),
          balance: moneyNumber(i.originalAmount) - moneyNumber(i.costCommittedAmount),
        }))
    );
  })
);

const adjustmentSchema = z.object({
  budgetItemId: z.coerce.number().int().positive(),
  amount: z.coerce.number().refine((v) => v !== 0, "El monto no puede ser 0"),
  note: z.string().trim().min(5, "Explicá el motivo del ajuste (mínimo 5 caracteres)"),
  createdBy: z.string().trim().optional(),
});

/** POST /api/projects/:id/budget-adjustments — ajuste manual con motivo obligatorio. */
costControlRouter.post(
  "/projects/:id/budget-adjustments",
  asyncHandler(async (req, res) => {
    const projectId = projectIdParam(req.params.id);
    const body = adjustmentSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.documentAuditLog.create({
        data: {
          entity: "ManualAdjustment",
          entityId: body.budgetItemId,
          action: "ADJUST",
          payload: { amount: body.amount, note: body.note, createdBy: body.createdBy ?? null },
        },
      });
      const budgetWarnings = await postCost(tx, {
        projectId,
        budgetItemId: body.budgetItemId,
        amount: body.amount,
        source: "MANUAL_ADJUSTMENT",
        sourceType: "ManualAdjustment",
        sourceId: log.id,
        sourceNumber: `AJ-${log.id}`,
        note: body.note,
        createdBy: body.createdBy,
      });
      await recalculateProjectFinancials(tx, projectId);
      return { adjustmentId: log.id, budgetWarnings };
    });
    ok(res, result, 201);
  })
);

/** POST /api/projects/:id/budget-ledger/rebuild — sincroniza documentos y recalcula el caché. */
costControlRouter.post(
  "/projects/:id/budget-ledger/rebuild",
  asyncHandler(async (req, res) => {
    const projectId = projectIdParam(req.params.id);
    const result = await prisma.$transaction((tx) => rebuildProjectLedger(tx, projectId), { timeout: 120_000 });
    ok(res, result);
  })
);
