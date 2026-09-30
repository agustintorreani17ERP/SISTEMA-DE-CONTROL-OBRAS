/**
 * Modelo de la planilla técnica del Centro de Costos: filas en orden visual con su nivel,
 * cantidades previstas/ejecutadas, saldos y % de avance físico. Código puro (lo usan la
 * tabla y la exportación a Excel).
 */
import type { CostNode } from "../types";

export interface SheetRow {
  node: CostNode;
  depth: number;
  hasChildren: boolean;
  isItem: boolean;
  plannedQty: number | null;
  executedQty: number | null;
  balanceQty: number | null;
  progress: number | null; // ítems: cantidad ejecutada ÷ prevista; rubros: total ejecutado ÷ total previsto
  unitPrice: number | null;
  plannedTotal: number;
  executedTotal: number;
  balanceTotal: number;
  exceeded: boolean;
  costoMetaUnit: number | null;
  costoMetaTotal: number | null;
  /** Participación en el costo meta (fracción); null si no hay desglose por ACU. */
  shareMaterial: number | null;
  shareManoObra: number | null;
  shareEquipo: number | null;
  margenPrevisto: number | null;
  margenPct: number | null;
}

export interface SheetFilters {
  rubroId?: number | null;
  onlyDeviation?: boolean;
  onlyPareto?: boolean;
  search?: string;
}

/** Hay desvío si la cantidad ejecutada supera la prevista o el costo comprometido supera el presupuesto. */
export const hasDeviation = (n: CostNode) => n.quantityExceeded || n.overBudget;

export function toRow(node: CostNode, depth: number, hasChildren: boolean): SheetRow {
  const isItem = node.nodeKind === "ITEM";
  const planned = node.totalQuantity;
  const executed = node.executedQuantity;
  const hasMeta = isItem ? node.costoMetaFuente !== null : node.costoMetaTotal > 0;
  const acuPart = node.metaMaterial + node.metaManoObra + node.metaEquipo;
  const share = (v: number) => (acuPart > 0 && node.costoMetaTotal > 0 ? v / node.costoMetaTotal : null);
  return {
    node,
    depth,
    hasChildren,
    isItem,
    plannedQty: isItem ? planned : null,
    executedQty: isItem ? executed : null,
    balanceQty: isItem ? planned - executed : null,
    progress: isItem ? (planned > 0 ? executed / planned : null) : node.budget > 0 ? node.executedAmount / node.budget : null,
    unitPrice: isItem ? node.unitPrice : null,
    plannedTotal: node.budget,
    executedTotal: node.executedAmount,
    balanceTotal: node.budget - node.executedAmount,
    exceeded: node.quantityExceeded,
    costoMetaUnit: isItem ? node.costoMetaUnit : null,
    costoMetaTotal: hasMeta ? node.costoMetaTotal : null,
    shareMaterial: share(node.metaMaterial),
    shareManoObra: share(node.metaManoObra),
    shareEquipo: share(node.metaEquipo),
    margenPrevisto: hasMeta ? node.margenPrevisto : null,
    margenPct: node.margenPct,
  };
}

/**
 * Filas visibles en orden (rubro → subrubro → ítem). Con filtros, se muestran los nodos que
 * cumplen y sus rubros padre para no perder el contexto.
 */
export function buildSheetRows(nodes: CostNode[], filters: SheetFilters = {}, collapsed: Set<number> = new Set()): SheetRow[] {
  const children = new Map<number | null, CostNode[]>();
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const q = filters.search?.trim().toLowerCase() ?? "";
  const filtering = Boolean(q || filters.onlyDeviation || filters.onlyPareto || filters.rubroId);
  let keep: Set<number> | null = null;
  if (filtering) {
    keep = new Set();
    const inRubro = (n: CostNode) => {
      if (!filters.rubroId) return true;
      let cur: CostNode | undefined = n;
      while (cur) {
        if (cur.id === filters.rubroId) return true;
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      }
      return false;
    };
    for (const n of nodes) {
      const matchesSearch = !q || `${n.code} ${n.name}`.toLowerCase().includes(q);
      const matchesDeviation = !filters.onlyDeviation || (n.nodeKind === "ITEM" && hasDeviation(n));
      const matchesPareto = !filters.onlyPareto || (n.nodeKind === "ITEM" && n.pareto);
      if (!(matchesSearch && matchesDeviation && matchesPareto && inRubro(n))) continue;
      if ((filters.onlyDeviation || filters.onlyPareto) && n.nodeKind !== "ITEM") continue;
      let cur: CostNode | undefined = n;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      }
    }
  }

  const rows: SheetRow[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const n of children.get(parentId) ?? []) {
      if (keep && !keep.has(n.id)) continue;
      const kids = children.get(n.id) ?? [];
      rows.push(toRow(n, depth, kids.length > 0));
      if (kids.length && (filtering || !collapsed.has(n.id))) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Totales de la planilla: suma de los ítems visibles (o de todo si no hay filtro). */
export function sheetTotals(rows: SheetRow[], nodes: CostNode[], filtered: boolean) {
  const leaves = filtered ? rows.filter((r) => r.isItem).map((r) => r.node) : nodes.filter((n) => n.nodeKind === "ITEM");
  const planned = leaves.reduce((acc, n) => acc + n.budget, 0);
  const executed = leaves.reduce((acc, n) => acc + n.executedAmount, 0);
  const withMeta = leaves.filter((n) => n.costoMetaFuente !== null);
  const costoMeta = withMeta.reduce((acc, n) => acc + n.costoMetaTotal, 0);
  const venta = withMeta.reduce((acc, n) => acc + n.ventaSinIva, 0);
  const margen = withMeta.reduce((acc, n) => acc + n.margenPrevisto, 0);
  const acu = (k: "metaMaterial" | "metaManoObra" | "metaEquipo") => {
    const v = leaves.reduce((acc, n) => acc + n[k], 0);
    return costoMeta > 0 && v > 0 ? v / costoMeta : null;
  };
  return {
    planned,
    executed,
    balance: planned - executed,
    progress: planned > 0 ? executed / planned : null,
    costoMeta,
    shareMaterial: acu("metaMaterial"),
    shareManoObra: acu("metaManoObra"),
    shareEquipo: acu("metaEquipo"),
    margen,
    margenPct: venta > 0 ? margen / venta : null,
  };
}
