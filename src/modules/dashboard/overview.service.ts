import { prisma } from "../../lib/prisma";
import { moneyNumber } from "../../lib/money";
import { buildCostTree } from "../cost-control/costTree";
import { ESTADOS_SIN_PAGAR, solicitadoSinPagar, type EstadoSolicitud } from "../../domain/fondosMath";

/**
 * Indicadores para el jefe de obra / gerencia. Responde:
 * ¿cuánto avanzó?, ¿cuánto gasté?, ¿gano o pierdo?, ¿voy bien?, ¿cómo va la plata?
 * y ¿qué tengo que resolver?
 */

export type Health = "good" | "warn" | "bad" | "none";

/** Desvío = costo % − avance %: ≤ 0 bien, ≤ 5 pp atención, > 5 pp problema. */
export function healthOf(progress: number, costPct: number, hasBudget: boolean): Health {
  if (!hasBudget) return "none";
  const deviation = costPct - progress;
  if (deviation <= 0) return "good";
  if (deviation <= 0.05) return "warn";
  return "bad";
}

export interface PendingItem {
  key: string;
  label: string;
  count: number;
  tab: "suministros" | "ejecucion-certificaciones" | "contabilidad-finanzas" | "centro-costos";
  subTab?: string;
}

async function projectKpis(projectId: number) {
  const tree = await buildCostTree(projectId);
  const { budget, actual, certified, committed, balance, overBudgetItems } = tree.kpis;
  const progress = budget > 0 ? certified / budget : 0;
  const costPct = budget > 0 ? actual / budget : 0;
  return {
    tree,
    kpis: {
      contract: tree.project.contractAmount,
      budget,
      committed,
      actual,
      certified,
      balance,
      progress,
      costPct,
      result: certified - actual,
      deviation: costPct - progress,
      health: healthOf(progress, costPct, budget > 0),
      overBudgetItems,
    },
  };
}

async function pendings(projectId: number): Promise<PendingItem[]> {
  const now = new Date();
  const [orders, requests, certifications, subCerts, funds, invoices] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { projectId }, select: { status: true } }),
    prisma.materialRequest.findMany({
      where: { projectId, status: "APROBADO_PARA_COMPRA" },
      include: { purchaseOrders: { select: { status: true } } },
    }),
    prisma.certification.findMany({ where: { projectId }, select: { estado: true } }),
    prisma.subcontractorCertificate.findMany({
      where: { status: "BORRADOR", contract: { projectId } },
      select: { id: true },
    }),
    prisma.pettyCashFund.findMany({ where: { projectId }, select: { id: true } }),
    prisma.invoice.findMany({
      where: { projectId, estado: { notIn: ["PAGADA", "ANULADA"] } },
      select: { fechaVencimiento: true },
    }),
  ]);
  const pettyPending = funds.length
    ? await prisma.pettyCashExpense.count({
        where: { fundId: { in: funds.map((f) => f.id) }, status: "PENDIENTE_RENDICION" },
      })
    : 0;

  const count = (status: string) => orders.filter((o) => o.status === status).length;
  const items: PendingItem[] = [
    { key: "po-approve", label: "Órdenes de compra por aprobar", count: count("BORRADOR"), tab: "suministros", subTab: "compras" },
    { key: "po-issue", label: "Órdenes aprobadas sin emitir", count: count("APROBADO_PARA_COMPRA"), tab: "suministros", subTab: "compras" },
    { key: "po-receive", label: "Compras por recibir en obra", count: count("EMITIDA"), tab: "suministros", subTab: "compras" },
    {
      key: "req-no-po",
      label: "Pedidos aprobados sin orden de compra",
      count: requests.filter((r) => !(r.purchaseOrders ?? []).some((po) => po.status !== "ANULADO")).length,
      tab: "suministros",
      subTab: "pedidos",
    },
    {
      key: "cert-draft",
      label: "Certificados de avance por aprobar",
      count: certifications.filter((c) => c.estado !== "APROBADO").length,
      tab: "ejecucion-certificaciones",
    },
    { key: "subcert-draft", label: "Certificados de subcontratistas por certificar", count: subCerts.length, tab: "ejecucion-certificaciones" },
    { key: "petty", label: "Gastos de caja chica por rendir", count: pettyPending, tab: "contabilidad-finanzas", subTab: "caja-chica" },
    {
      key: "overdue",
      label: "Facturas vencidas",
      count: invoices.filter((i) => new Date(i.fechaVencimiento) < now).length,
      tab: "contabilidad-finanzas",
      subTab: "facturas",
    },
  ];
  return items.filter((i) => i.count > 0);
}

async function cash(projectId: number) {
  const invoices = await prisma.invoice.findMany({
    where: { projectId, estado: { not: "ANULADA" } },
    include: { payments: true },
  });
  let receivable = 0;
  let payable = 0;
  for (const inv of invoices) {
    const paid = (inv.payments ?? []).reduce((acc, p) => acc + moneyNumber(p.montoPagado), 0);
    const open = Math.max(0, moneyNumber(inv.total) - paid);
    if (inv.tipo === "EMITIDA") receivable += open;
    else payable += open;
  }
  const solicitudes = await prisma.solicitudFondo.findMany({
    where: { projectId, estado: { in: ESTADOS_SIN_PAGAR } },
    select: { estado: true, montoNeto: true, montoPagado: true },
  });
  const requested = solicitadoSinPagar(
    solicitudes.map((s) => ({ estado: s.estado as EstadoSolicitud, montoNeto: moneyNumber(s.montoNeto), montoPagado: moneyNumber(s.montoPagado) }))
  );
  return { receivable, payable, requested };
}

/** Curva mensual acumulada: certificado al cliente vs. costo incurrido. */
async function monthlyCurve(projectId: number) {
  const movements = await prisma.budgetMovement.findMany({
    where: { projectId },
    select: { source: true, stage: true, amount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const months = new Map<string, { certified: number; cost: number }>();
  for (const m of movements) {
    if (m.source !== "CLIENT_CERTIFICATE" && m.stage !== "ACTUAL") continue;
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = months.get(key) ?? { certified: 0, cost: 0 };
    if (m.source === "CLIENT_CERTIFICATE") entry.certified += moneyNumber(m.amount);
    else entry.cost += moneyNumber(m.amount);
    months.set(key, entry);
  }
  let certified = 0;
  let cost = 0;
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => {
      certified += v.certified;
      cost += v.cost;
      return { label, values: { certified, cost } };
    });
}

export async function projectOverview(projectId: number) {
  const { tree, kpis } = await projectKpis(projectId);

  // Rubros de primer nivel ordenados por cuánto se están pasando (comprometido vs. presupuesto).
  const topRubros = tree.nodes
    .filter((n) => n.parentId === null && n.nodeKind !== "ITEM" && (n.budget > 0 || n.committed > 0))
    .map((n) => ({
      id: n.id,
      code: n.code,
      name: n.name,
      budget: n.budget,
      committed: n.committed,
      usage: n.budget > 0 ? n.committed / n.budget : 1,
      progress: n.budget > 0 ? n.certifiedAmount / n.budget : 0,
      overBudget: n.overBudget,
    }))
    .filter((r) => r.committed > 0)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 5);

  const [pending, money, curve] = await Promise.all([pendings(projectId), cash(projectId), monthlyCurve(projectId)]);

  return {
    project: tree.project,
    hasBudget: kpis.budget > 0,
    kpis,
    topRubros,
    pending,
    cash: money,
    curve,
  };
}

export async function portfolio() {
  const projects = await prisma.project.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } });
  const rows = await Promise.all(
    projects.map(async (p) => {
    const { kpis } = await projectKpis(p.id);
    const pending = await pendings(p.id);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      location: p.location,
      status: p.status,
      ...kpis,
      pendingCount: pending.reduce((acc, i) => acc + i.count, 0),
    };
    })
  );
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  return {
    totals: {
      projects: rows.length,
      contract: sum((r) => r.contract),
      budget: sum((r) => r.budget),
      certified: sum((r) => r.certified),
      actual: sum((r) => r.actual),
      result: sum((r) => r.result),
      atRisk: rows.filter((r) => r.health === "bad").length,
    },
    projects: rows,
  };
}
