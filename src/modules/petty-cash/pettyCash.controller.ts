import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../domain/audit";
import { assertImputableItem, postCost, reverseMovements } from "../../domain/budget";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { moneyNumber } from "../../lib/money";

/**
 * Caja chica (fondo fijo) de obra.
 * Cada comprobante se imputa a una partida (o a Gastos Generales) y descuenta del
 * presupuesto al registrarse. Si en la rendición se rechaza, se revierte.
 * La reposición del fondo es un movimiento de caja, no de presupuesto.
 */
export const pettyCashRouter = Router();

const SOURCE_TYPE = "PettyCashExpense";

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
          include: { budgetItem: { select: { id: true, code: true, name: true } } },
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
  budgetItemId: z.coerce.number().int().positive({ message: "Elegí el rubro (o Gastos Generales)" }),
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
      await assertImputableItem(tx, fund.projectId, body.budgetItemId);

      const expense = await tx.pettyCashExpense.create({ data: body });
      const budgetWarnings = await postCost(tx, {
        projectId: fund.projectId,
        budgetItemId: body.budgetItemId,
        amount: body.amount,
        source: "PETTY_CASH",
        sourceType: SOURCE_TYPE,
        sourceId: expense.id,
        sourceNumber: body.receiptNumber,
        note: body.concept,
        createdBy: body.responsibleName,
      });
      await recalculateProjectFinancials(tx, fund.projectId);
      return { ...expense, budgetWarnings };
    });
    ok(res, result, 201);
  })
);

/** Rendición: todos los comprobantes pendientes del fondo quedan rendidos (el fondo se repone). */
pettyCashRouter.post(
  "/fondos/:id/rendicion",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.findUnique({ where: { id } });
      if (!fund) throw new NotFoundError("Fondo de caja chica", id);
      const { count } = await tx.pettyCashExpense.updateMany({
        where: { fundId: id, status: "PENDIENTE_RENDICION" },
        data: { status: "RENDIDO", settledAt: new Date() },
      });
      await audit(tx, { entity: "PettyCashFund", entityId: id, action: "SETTLE", payload: { expenses: count } });
      return { settled: count };
    });
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
