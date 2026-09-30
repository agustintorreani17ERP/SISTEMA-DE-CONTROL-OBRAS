import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { computeItemsAcu } from "../../domain/acu";
import { CostoMetaFuente, paretoIds } from "../../domain/acuMath";

export interface CostNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  level: number;
  isSystem: boolean;
  unit: string | null;
  totalQuantity: number;
  unitPrice: number;
  budget: number;
  committed: number;
  actual: number;
  certifiedAmount: number;
  certifiedQuantity: number;
  subcontractQuantity: number;
  balance: number;
  overBudget: boolean;
  progressPct: number | null;
  bySource: Record<string, number>;
  /** Cantidad ejecutada = certificado al cliente aprobado (libro mayor, CLIENT_CERTIFICATE). */
  executedQuantity: number;
  executedAmount: number;
  /** Ejecutado supera lo previsto (ítems: cantidad; rubros: algún hijo excedido). */
  quantityExceeded: boolean;
  /** Costo meta (sin IVA): ACU si el ítem tiene componentes; si no, PU ÷ K. */
  costoMetaUnit: number | null;
  costoMetaTotal: number;
  costoMetaFuente: CostoMetaFuente;
  /** Parte del costo meta total por grupo de insumo (solo lo que sale de un ACU). */
  metaMaterial: number;
  metaManoObra: number;
  metaEquipo: number;
  ventaSinIva: number;
  /** Venta sin IVA − costo meta, sobre los ítems que tienen costo meta. */
  margenPrevisto: number;
  margenPct: number | null;
  acuComponentes: number;
  acuSuperaOferta: boolean;
  /** Rubros: ítems sin costo meta (sin ACU y sin K). */
  itemsSinCostoMeta: number;
  /** Ítem dentro del grupo que suma el 80 % del monto previsto. */
  pareto: boolean;
}

export type CostTree = Awaited<ReturnType<typeof buildCostTree>>;

/**
 * Árbol del presupuesto de una obra con subtotales por rubro (calculados sumando hojas),
 * desglose del costo comprometido por origen y KPIs. Lo usan el Centro de Costos, el
 * resumen de obra y la cartera.
 */
export async function buildCostTree(projectId: number) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Obra", projectId);

  const [items, grouped] = await Promise.all([
    prisma.budgetItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.budgetMovement.groupBy({
      by: ["budgetItemId", "source"],
      where: { projectId, stage: "COMMITTED" },
      _sum: { amount: true },
    }),
  ]);

  const acu = await computeItemsAcu(
    prisma,
    items.filter((i) => i.nodeKind === "ITEM"),
    project
  );
  const pareto = paretoIds(
    items.filter((i) => i.nodeKind === "ITEM" && !i.isSystem).map((i) => ({ id: i.id, amount: moneyNumber(i.originalAmount) }))
  );
  const ventaConMeta = new Map<number, number>();

  const sources = new Map<number, Record<string, number>>();
  for (const g of grouped) {
    const entry = sources.get(g.budgetItemId) ?? {};
    entry[g.source] = moneyNumber(g._sum.amount);
    sources.set(g.budgetItemId, entry);
  }

  const nodes = new Map<number, CostNode>();
  for (const i of items) {
    const isItem = i.nodeKind === "ITEM";
    const a = isItem ? acu.get(i.id) : undefined;
    const r = a?.result;
    const q = moneyNumber(i.totalQuantity);
    const hasMeta = r?.costoMetaTotal != null;
    if (isItem && hasMeta) ventaConMeta.set(i.id, r!.ventaSinIvaTotal);
    nodes.set(i.id, {
      id: i.id,
      parentId: i.parentId,
      code: i.code,
      name: i.name,
      nodeKind: i.nodeKind,
      level: i.hierarchyLevel,
      isSystem: i.isSystem,
      unit: i.unit,
      totalQuantity: isItem ? moneyNumber(i.totalQuantity) : 0,
      unitPrice: isItem ? moneyNumber(i.unitPrice) : 0,
      budget: isItem ? moneyNumber(i.originalAmount) : 0,
      committed: isItem ? moneyNumber(i.costCommittedAmount) : 0,
      actual: isItem ? moneyNumber(i.costActualAmount) : 0,
      certifiedAmount: isItem ? moneyNumber(i.certifiedAmount) : 0,
      certifiedQuantity: isItem ? moneyNumber(i.certifiedQuantity) : 0,
      subcontractQuantity: isItem ? moneyNumber(i.subcontractQuantity) : 0,
      balance: 0,
      overBudget: false,
      progressPct: null,
      bySource: isItem ? sources.get(i.id) ?? {} : {},
      executedQuantity: isItem ? moneyNumber(i.certifiedQuantity) : 0,
      executedAmount: isItem ? moneyNumber(i.certifiedAmount) : 0,
      quantityExceeded:
        isItem && moneyNumber(i.totalQuantity) > 0 && moneyNumber(i.certifiedQuantity) > moneyNumber(i.totalQuantity) + 0.0001,
      costoMetaUnit: r?.costoMetaUnit ?? null,
      costoMetaTotal: r?.costoMetaTotal ?? 0,
      costoMetaFuente: r?.fuente ?? null,
      metaMaterial: r && r.fuente === "ACU" ? r.subtotales.MATERIAL * q : 0,
      metaManoObra: r && r.fuente === "ACU" ? r.subtotales.MANO_OBRA * q : 0,
      metaEquipo: r && r.fuente === "ACU" ? r.subtotales.EQUIPO * q : 0,
      ventaSinIva: r?.ventaSinIvaTotal ?? 0,
      margenPrevisto: r?.margenTotal ?? 0,
      margenPct: r?.margenPct ?? null,
      acuComponentes: a?.lineas.length ?? 0,
      acuSuperaOferta: r?.superaOferta ?? false,
      itemsSinCostoMeta: isItem && !i.isSystem && !hasMeta ? 1 : 0,
      pareto: pareto.has(i.id),
    });
  }

  // Subtotales: de las hojas hacia arriba (niveles más profundos primero).
  const byDepth = [...nodes.values()].sort((a, b) => b.level - a.level);
  for (const n of byDepth) {
    if (n.parentId === null) continue;
    const parent = nodes.get(n.parentId);
    if (!parent) continue;
    parent.budget += n.budget;
    parent.committed += n.committed;
    parent.actual += n.actual;
    parent.certifiedAmount += n.certifiedAmount;
    parent.executedAmount += n.executedAmount;
    if (n.quantityExceeded) parent.quantityExceeded = true;
    parent.costoMetaTotal += n.costoMetaTotal;
    parent.metaMaterial += n.metaMaterial;
    parent.metaManoObra += n.metaManoObra;
    parent.metaEquipo += n.metaEquipo;
    parent.ventaSinIva += n.ventaSinIva;
    parent.margenPrevisto += n.margenPrevisto;
    parent.itemsSinCostoMeta += n.itemsSinCostoMeta;
    ventaConMeta.set(parent.id, (ventaConMeta.get(parent.id) ?? 0) + (ventaConMeta.get(n.id) ?? 0));
    if (n.acuSuperaOferta) parent.acuSuperaOferta = true;
    if (n.pareto) parent.pareto = true;
    for (const [src, value] of Object.entries(n.bySource)) {
      parent.bySource[src] = (parent.bySource[src] ?? 0) + value;
    }
  }
  for (const n of nodes.values()) {
    if (n.nodeKind !== "ITEM") {
      const venta = ventaConMeta.get(n.id) ?? 0;
      n.margenPct = venta > 0 ? n.margenPrevisto / venta : null;
    }
    n.balance = n.budget - n.committed;
    n.overBudget = n.committed > n.budget + 0.005;
    n.progressPct =
      n.nodeKind === "ITEM"
        ? n.totalQuantity > 0
          ? n.certifiedQuantity / n.totalQuantity
          : null
        : n.budget > 0
        ? n.certifiedAmount / n.budget
        : null;
  }

  const leaves = [...nodes.values()].filter((n) => n.nodeKind === "ITEM");
  const sum = (f: (n: CostNode) => number, list = leaves) => list.reduce((acc, n) => acc + f(n), 0);
  const committed = sum((n) => n.committed);
  const generalExpenses = sum((n) => n.committed, leaves.filter((n) => n.isSystem));
  const withMeta = leaves.filter((n) => n.costoMetaFuente !== null);
  const ventaMeta = sum((n) => n.ventaSinIva, withMeta);
  const margenPrevisto = sum((n) => n.margenPrevisto, withMeta);
  const bySource: Record<string, number> = {};
  for (const n of leaves) {
    for (const [src, value] of Object.entries(n.bySource)) bySource[src] = (bySource[src] ?? 0) + value;
  }

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      currency: project.currency,
      contractAmount: moneyNumber(project.montoContractualManual),
      coeficienteK: project.coeficienteK === null ? null : moneyNumber(project.coeficienteK),
      ivaPct: moneyNumber(project.ivaPct),
    },
    kpis: {
      budget: sum((n) => n.budget),
      committed,
      actual: sum((n) => n.actual),
      certified: sum((n) => n.certifiedAmount),
      balance: sum((n) => n.budget) - committed,
      generalExpenses,
      generalExpensesShare: committed > 0 ? generalExpenses / committed : 0,
      overBudgetItems: leaves.filter((n) => n.overBudget).length,
      exceededItems: leaves.filter((n) => n.quantityExceeded).length,
      bySource,
      costoMeta: sum((n) => n.costoMetaTotal),
      ventaSinIva: sum((n) => n.ventaSinIva),
      margenPrevisto,
      margenPct: ventaMeta > 0 ? margenPrevisto / ventaMeta : null,
      itemsConAcu: leaves.filter((n) => n.costoMetaFuente === "ACU").length,
      itemsSinCostoMeta: sum((n) => n.itemsSinCostoMeta),
      itemsSuperanOferta: leaves.filter((n) => n.acuSuperaOferta).length,
      itemsPareto: leaves.filter((n) => n.pareto).length,
    },
    nodes: [...nodes.values()],
  };
}
