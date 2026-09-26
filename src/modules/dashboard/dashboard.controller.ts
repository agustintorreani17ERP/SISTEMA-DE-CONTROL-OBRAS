import { Router } from "express";
import { DocumentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { moneyNumber } from "../../lib/money";
import { DomainError } from "../../errors/domain";
import { portfolio, projectOverview } from "./overview.service";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const projectFilter = projectId
      ? { projectId, project: { deletedAt: null } }
      : { project: { deletedAt: null } };

    const [projects, items, issuedOrders, certificates, contracts, spentOrders, paidCertificates] = await Promise.all([
      prisma.project.findMany({
        where: projectId ? { id: projectId, deletedAt: null } : { deletedAt: null },
      }),
      // Solo hojas: rubros y subrubros no tienen monto propio (sería contar dos veces)
      prisma.budgetItem.findMany({ where: { ...projectFilter, nodeKind: "ITEM" }, orderBy: { sortOrder: "asc" } }),
      prisma.purchaseOrder.findMany({
        where: {
          ...projectFilter,
          status: { in: [DocumentStatus.EMITIDA, DocumentStatus.RECIBIDO] },
        },
        include: { partner: true, details: { include: { material: true } } },
        orderBy: { issueDate: "desc" },
        take: 12,
      }),
      prisma.subcontractorCertificate.findMany({
        where: { contract: projectId ? { projectId, project: { deletedAt: null } } : { project: { deletedAt: null } } },
        include: { contract: { include: { partner: true } } },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.subcontractorContract.findMany({
        where: projectFilter,
        include: { partner: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { ...projectFilter, status: { in: [DocumentStatus.EMITIDA, DocumentStatus.RECIBIDO] } },
        _sum: { totalAmount: true },
      }),
      prisma.subcontractorCertificate.aggregate({
        where: { contract: projectId ? { projectId, project: { deletedAt: null } } : { project: { deletedAt: null } }, status: "PAGADO" },
        _sum: { amount: true },
      }),
    ]);

    const globalBudget = projects.reduce((acc, p) => acc + moneyNumber(p.globalBudget), 0);
    const original = items.reduce((acc, i) => acc + moneyNumber(i.originalAmount), 0);
    const committed = items.reduce((acc, i) => acc + moneyNumber(i.costCommittedAmount), 0);
    const executed = items.reduce((acc, i) => acc + moneyNumber(i.costActualAmount), 0);
    const certified = items.reduce((acc, i) => acc + moneyNumber(i.certifiedAmount), 0);
    const generalExpenses = items
      .filter((i) => i.isSystem)
      .reduce((acc, i) => acc + moneyNumber(i.costCommittedAmount), 0);
    const contractualAmount = projects.reduce(
      (acc, project) => acc + (moneyNumber(project.montoContractualManual) || moneyNumber(project.globalBudget)),
      0
    );
    const realUpdated = projects.reduce((acc, project) => acc + moneyNumber(project.montoRealActualizado), 0) || original;
    const totalSpent = executed;

    const issuedCount = await prisma.purchaseOrder.count({
      where: {
        ...projectFilter,
        status: { in: [DocumentStatus.EMITIDA, DocumentStatus.RECIBIDO] },
      },
    });

    ok(res, {
      kpis: {
        globalBudget,
        originalBudget: original,
        realSpend: executed,
        committed,
        available: original - committed,
        variance: original - executed,
        issuedPurchaseOrders: issuedCount,
        subcontractCertified: contracts.reduce((a, c) => a + moneyNumber(c.certifiedAmount), 0),
        subcontractPaid: contracts.reduce((a, c) => a + moneyNumber(c.paidAmount), 0),
        contractualAmount,
        realUpdated,
        totalSpent,
        availableReal: realUpdated - totalSpent,
        certifiedToClient: certified,
        generalExpensesShare: committed > 0 ? generalExpenses / committed : 0,
        purchaseOrdersAmount: moneyNumber(spentOrders._sum.totalAmount ?? 0),
        subcontractPaidCertificates: moneyNumber(paidCertificates._sum.amount ?? 0),
      },
      budgetByItem: items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        category: i.category,
        original: moneyNumber(i.originalAmount),
        committed: moneyNumber(i.costCommittedAmount),
        executed: moneyNumber(i.costActualAmount),
        certified: moneyNumber(i.certifiedAmount),
        remaining: moneyNumber(i.originalAmount) - moneyNumber(i.costCommittedAmount),
      })),
      issuedOrders,
      subcontractors: contracts.map((c) => ({
        id: c.id,
        number: c.number,
        partner: c.partner.name,
        taxId: c.partner.taxId,
        status: c.status,
        contractAmount: moneyNumber(c.contractAmount),
        certifiedAmount: moneyNumber(c.certifiedAmount),
        paidAmount: moneyNumber(c.paidAmount),
        outstanding: moneyNumber(c.certifiedAmount) - moneyNumber(c.paidAmount),
      })),
      recentCertificates: certificates,
    });
  })
);

/** Rutas del dashboard nuevo (se montan en /api). */
export const overviewRouter = Router();

/** GET /api/portfolio — todas las obras con sus indicadores y semáforo. */
overviewRouter.get(
  "/portfolio",
  asyncHandler(async (_req, res) => {
    ok(res, await portfolio());
  })
);

/** GET /api/projects/:id/overview — resumen de una obra para el jefe. */
overviewRouter.get(
  "/projects/:id/overview",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
    ok(res, await projectOverview(id));
  })
);
