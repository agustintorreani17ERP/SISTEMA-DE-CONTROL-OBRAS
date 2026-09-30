import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../domain/audit";
import { postMovement, reverseMovements, type BudgetWarning } from "../../domain/budget";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { ledgerItemFor, resolveExpenseLine } from "../../domain/imputation";
import { fechaContable } from "../../domain/progress";
import { recordStockMovement } from "../../domain/stock";
import { moneyNumber, toDecimal } from "../../lib/money";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";

/**
 * Caja chica (fondo fijo) de obra.
 * Cada comprobante lleva insumo y sigue la regla de imputación: DIRECTO exige ítem, COMÚN va al
 * stock de la obra (sin ítem, con cantidad), TIEMPO ítem opcional. Al cargarse compromete; con la
 * rendición aprobada pasa a costo incurrido (y el COMÚN entra al stock), con la fecha del gasto.
 * La reposición del fondo es un movimiento de caja, no de presupuesto.
 */
export const pettyCashRouter = Router();

const SOURCE_TYPE = "PettyCashExpense";
const fmt = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

pettyCashRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    }
    const funds = await prisma.pettyCashFund.findMany({
      where: { projectId },
      include: {
        expenses: {
          include: {
            budgetItem: { select: { id: true, code: true, name: true } },
            insumo: { select: { id: true, code: true, description: true, unit: true, tipo: true } },
          },
          orderBy: { date: "desc" },
        },
      },
      orderBy: { id: "asc" },
    });
    ok(
      res,
      funds.map((fund) => {
        const pending = fund.expenses
          .filter((e) => e.status === "PENDIENTE_RENDICION")
          .reduce((acc, e) => acc + moneyNumber(e.amount), 0);
        return {
          ...fund,
          expenses: fund.expenses.map((e) => ({ ...e, quantity: e.quantity === null ? null : moneyNumber(e.quantity) })),
          pendingAmount: pending,
          currentBalance: moneyNumber(fund.assignedAmount) - pending,
        };
      })
    );
  })
);

const fundSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).default("Fondo fijo de obra"),
  responsibleName: z.string().trim().min(2),
  assignedAmount: z.coerce.number().positive(),
});

pettyCashRouter.post(
  "/fondos",
  asyncHandler(async (req, res) => {
    const body = fundSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    ok(res, await prisma.pettyCashFund.create({ data: body }), 201);
  })
);

pettyCashRouter.patch(
  "/fondos/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = fundSchema.partial().omit({ projectId: true }).extend({ active: z.boolean().optional() }).parse(req.body);
    ok(res, await prisma.pettyCashFund.update({ where: { id }, data: body }));
  })
);

const expenseSchema = z.object({
  fundId: z.coerce.number().int().positive(),
  insumoId: z.coerce.number().int().positive({ message: "Elegí el insumo del gasto" }),
  budgetItemId: z.coerce.number().int().positive().nullish(),
  quantity: z.coerce.number().positive().nullish(),
  date: z.coerce.date(),
  receiptNumber: z.string().trim().min(1),
  supplierName: z.string().trim().min(1),
  concept: z.string().trim().min(2),
  amount: z.coerce.number().positive(),
  responsibleName: z.string().trim().optional(),
});

pettyCashRouter.post(
  "/gastos",
  asyncHandler(async (req, res) => {
    const body = expenseSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.findUnique({ where: { id: body.fundId } });
      if (!fund) throw new NotFoundError("Fondo de caja chica", body.fundId);
      if (!fund.active) throw new DomainError("FUND_INACTIVE", "El fondo está inactivo", 409);
      const insumo = await tx.material.findUnique({ where: { id: body.insumoId } });
      if (!insumo) throw new NotFoundError("Insumo", body.insumoId);
      if (insumo.tipo === "COMUN" && !body.quantity) {
        throw new DomainError("QUANTITY_REQUIRED", `${insumo.code} es COMÚN: entra al stock, indicá la cantidad (${insumo.unit})`, 422);
      }
      const { itemId, ledgerItemId } = await resolveExpenseLine(tx, fund.projectId, insumo, body.budgetItemId);
      const fc = await fechaContable(tx, fund.projectId, body.date);

      const expense = await tx.pettyCashExpense.create({
        data: { ...body, budgetItemId: itemId, quantity: body.quantity ?? null },
      });
      // Compromiso al cargar; el costo incurrido entra con la rendición aprobada.
      const { warnings } = await postMovement(tx, {
        projectId: fund.projectId,
        budgetItemId: ledgerItemId,
        insumoId: insumo.id,
        amount: body.amount,
        quantity: body.quantity ?? null,
        source: "PETTY_CASH",
        stage: "COMMITTED",
        sourceType: SOURCE_TYPE,
        sourceId: expense.id,
        sourceNumber: body.receiptNumber,
        note: body.concept,
        createdBy: body.responsibleName,
        fecha: fc.fecha,
      });
      await recalculateProjectFinancials(tx, fund.projectId);
      return { ...expense, budgetWarnings: warnings as BudgetWarning[] };
    });
    ok(res, result, 201);
  })
);

/**
 * Rendición aprobada: los comprobantes pendientes del fondo (o los elegidos) pasan a costo
 * incurrido con la fecha del gasto (o el primer día abierto si su período ya cerró) y los
 * insumos COMUNES entran al stock de la obra.
 */
pettyCashRouter.post(
  "/fondos/:id/rendicion",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).optional() }).parse(req.body ?? {});
    const result = await prisma.$transaction(
      async (tx) => {
        const fund = await tx.pettyCashFund.findUnique({ where: { id } });
        if (!fund) throw new NotFoundError("Fondo de caja chica", id);
        const pendientes = await tx.pettyCashExpense.findMany({
          where: { fundId: id, status: "PENDIENTE_RENDICION", ...(ids ? { id: { in: ids } } : {}) },
          include: { insumo: true },
          orderBy: { date: "asc" },
        });
        const avisos: string[] = [];
        for (const e of pendientes) {
          const fc = await fechaContable(tx, fund.projectId, e.date);
          if (fc.desplazada) avisos.push(`${e.receiptNumber}: su fecha ${fmt(e.date)} está en un período cerrado; entra el ${fmt(fc.fecha)}`);
          // Gastos anteriores a este flujo ya registraron el costo al cargarse
          const yaIncurrido = await tx.budgetMovement.count({ where: { sourceType: SOURCE_TYPE, sourceId: e.id, stage: "ACTUAL", reversalOfId: null } });
          if (!yaIncurrido) {
            const ledgerItemId = e.budgetItemId ?? (await ledgerItemFor(tx, fund.projectId, { tipo: e.insumo?.tipo ?? "COMUN", budgetItemId: null }));
            await postMovement(tx, {
              projectId: fund.projectId,
              budgetItemId: ledgerItemId,
              insumoId: e.insumoId,
              amount: e.amount,
              quantity: e.quantity,
              source: "PETTY_CASH",
              stage: "ACTUAL",
              sourceType: SOURCE_TYPE,
              sourceId: e.id,
              sourceNumber: e.receiptNumber,
              note: `Rendición: ${e.concept}`,
              fecha: fc.fecha,
            });
            await postAsientoDesdeRegla(tx, {
              evento: EVENTO.CAJA_CHICA_RENDIDA,
              projectId: fund.projectId,
              concepto: `Caja chica ${e.receiptNumber}: ${e.concept}`,
              sourceType: SOURCE_TYPE,
              sourceId: e.id,
              fecha: fc.fecha,
              debe: [{ monto: e.amount, budgetItemId: ledgerItemId }],
              haber: [{ monto: e.amount }],
            });
          }
          if (e.insumo?.tipo === "COMUN" && e.quantity && !toDecimal(e.quantity).isZero()) {
            await recordStockMovement(tx, {
              projectId: fund.projectId,
              materialId: e.insumo.id,
              kind: "RECEIPT",
              quantity: e.quantity,
              fecha: fc.fecha,
              sourceType: SOURCE_TYPE,
              sourceId: e.id,
              unitCost: toDecimal(e.amount).div(toDecimal(e.quantity)),
              note: `Caja chica ${e.receiptNumber} · ${e.supplierName}`,
            });
          }
          await tx.pettyCashExpense.update({ where: { id: e.id }, data: { status: "RENDIDO", settledAt: new Date() } });
        }
        await recalculateProjectFinancials(tx, fund.projectId);
        await audit(tx, { entity: "PettyCashFund", entityId: id, action: "SETTLE", payload: { expenses: pendientes.length, avisos } });
        return { settled: pendientes.length, avisos };
      },
      { timeout: 60_000 }
    );
    ok(res, result);
  })
);

pettyCashRouter.post(
  "/gastos/:id/rechazar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3, "Indicá el motivo del rechazo") }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.pettyCashExpense.findUnique({ where: { id } });
      if (!expense) throw new NotFoundError("Comprobante de caja chica", id);
      if (expense.status === "RECHAZADO") return expense;
      if (expense.status === "RENDIDO") {
        throw new DomainError("ALREADY_SETTLED", "El comprobante ya está rendido: corregilo con un ajuste", 409);
      }
      const fund = await tx.pettyCashFund.findUnique({ where: { id: expense.fundId } });
      if (!fund) throw new NotFoundError("Fondo de caja chica", expense.fundId);
      await reverseMovements(tx, { sourceType: SOURCE_TYPE, sourceId: id, note: `Rechazado: ${reason}` });
      const next = await tx.pettyCashExpense.update({
        where: { id },
        data: { status: "RECHAZADO", rejectionReason: reason, settledAt: new Date() },
      });
      await recalculateProjectFinancials(tx, fund.projectId);
      return next;
    });
    ok(res, result);
  })
);
