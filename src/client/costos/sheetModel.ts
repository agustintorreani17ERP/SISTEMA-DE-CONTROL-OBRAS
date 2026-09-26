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
}

export interface SheetFilters {
  rubroId?: number | null;
  onlyDeviation?: boolean;
  search?: string;
}

/** Hay desvío si la cantidad ejecutada supera la prevista o el costo comprometido supera el presupuesto. */
export const hasDeviation = (n: CostNode) => n.quantityExceeded || n.overBudget;

export function toRow(node: CostNode, depth: number, hasChildren: boolean): SheetRow {
  const isItem = node.nodeKind === "ITEM";
  const planned = node.totalQuantity;
  const executed = node.executedQuantity;
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
  const filtering = Boolean(q || filters.onlyDeviation || filters.rubroId);
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
      if (!(matchesSearch && matchesDeviation && inRubro(n))) continue;
      if (filters.onlyDeviation && n.nodeKind !== "ITEM") continue;
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
  return { planned, executed, balance: planned - executed, progress: planned > 0 ? executed / planned : null };
}
