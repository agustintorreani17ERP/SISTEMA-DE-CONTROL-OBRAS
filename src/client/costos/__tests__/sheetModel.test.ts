import { describe, expect, it } from "vitest";
import type { CostNode } from "../../types";
import { buildSheetRows, sheetTotals } from "../sheetModel";

const node = (p: Partial<CostNode> & { id: number; name: string }): CostNode => ({
  parentId: null,
  code: String(p.id),
  nodeKind: "ITEM",
  level: 0,
  isSystem: false,
  unit: "m³",
  totalQuantity: 0,
  unitPrice: 0,
  budget: 0,
  committed: 0,
  actual: 0,
  certifiedAmount: 0,
  certifiedQuantity: 0,
  subcontractQuantity: 0,
  balance: 0,
  overBudget: false,
  progressPct: null,
  bySource: {},
  executedQuantity: 0,
  executedAmount: 0,
  quantityExceeded: false,
  costoMetaUnit: null,
  costoMetaTotal: 0,
  costoMetaFuente: null,
  metaMaterial: 0,
  metaManoObra: 0,
  metaEquipo: 0,
  ventaSinIva: 0,
  margenPrevisto: 0,
  margenPct: null,
  acuComponentes: 0,
  acuSuperaOferta: false,
  itemsSinCostoMeta: 0,
  pareto: false,
  ...p,
});

const nodes: CostNode[] = [
  node({ id: 1, name: "Área: 2) BLOQUE 6", nodeKind: "RUBRO", budget: 1_000_000, executedAmount: 500_000, quantityExceeded: true }),
  node({ id: 2, name: "Fundaciones", nodeKind: "SUBRUBRO", parentId: 1, level: 1, budget: 1_000_000, executedAmount: 500_000, quantityExceeded: true }),
  node({ id: 3, name: "Cabezales", parentId: 2, level: 2, totalQuantity: 144.35, unitPrice: 5000, budget: 721_750, executedQuantity: 100, executedAmount: 500_000 }),
  node({ id: 4, name: "Pilotes", parentId: 2, level: 2, totalQuantity: 10, unitPrice: 27825, budget: 278_250, executedQuantity: 12, quantityExceeded: true }),
  node({ id: 5, name: "Área: 3) OTRA", nodeKind: "RUBRO", budget: 200 }),
];

describe("planilla técnica", () => {
  it("calcula saldo de cantidad, % de avance y saldo en Gs.", () => {
    const rows = buildSheetRows(nodes);
    const cab = rows.find((r) => r.node.id === 3)!;
    expect(cab.balanceQty).toBeCloseTo(44.35);
    expect(cab.progress).toBeCloseTo(100 / 144.35);
    expect(cab.balanceTotal).toBe(221_750);
    const rubro = rows.find((r) => r.node.id === 1)!;
    expect(rubro.plannedQty).toBeNull(); // no se suman unidades distintas
    expect(rubro.progress).toBe(0.5);
  });

  it("marca el excedente cuando lo ejecutado supera lo previsto", () => {
    const pil = buildSheetRows(nodes).find((r) => r.node.id === 4)!;
    expect(pil.exceeded).toBe(true);
    expect(pil.balanceQty).toBe(-2);
  });

  it("colapsa rubros y filtra manteniendo los padres", () => {
    expect(buildSheetRows(nodes, {}, new Set([1])).map((r) => r.node.id)).toEqual([1, 5]);
    expect(buildSheetRows(nodes, { onlyDeviation: true }).map((r) => r.node.id)).toEqual([1, 2, 4]);
    expect(buildSheetRows(nodes, { search: "cabez" }).map((r) => r.node.id)).toEqual([1, 2, 3]);
    expect(buildSheetRows(nodes, { rubroId: 5 }).map((r) => r.node.id)).toEqual([5]);
  });

  it("total general suma solo los ítems", () => {
    const t = sheetTotals(buildSheetRows(nodes), nodes, false);
    expect(t.planned).toBe(1_000_000);
    expect(t.executed).toBe(500_000);
  });
});

describe("filtro Pareto", () => {
  it("muestra solo los ítems marcados y sus rubros", () => {
    const withPareto = nodes.map((n) => (n.id === 3 || n.id === 1 || n.id === 2 ? { ...n, pareto: true } : n));
    const rows = buildSheetRows(withPareto, { onlyPareto: true });
    expect(rows.map((r) => r.node.id)).toEqual([1, 2, 3]);
  });
});
