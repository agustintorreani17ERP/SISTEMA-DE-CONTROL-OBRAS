import { describe, expect, it } from "vitest";
import type { PrevistoRow } from "../../types";
import { buildPrevistoView, montosPorNodo, totalesGenerales } from "../previstoModel";

const row = (p: Partial<PrevistoRow> & { id: number }): PrevistoRow => ({
  parentId: null,
  code: String(p.id),
  name: `Nombre ${p.id}`,
  unit: "m3",
  nodeKind: "ITEM",
  sortOrder: p.id,
  unitPrice: 10,
  isExtra: false,
  extraAdendaNumero: null,
  contractQty: 100,
  deltas: {},
  realQty: 100,
  executedQty: 0,
  saldoQty: 100,
  pct: 0,
  exceeded: false,
  contractAmount: 1000,
  realAmount: 1000,
  executedAmount: 0,
  saldoAmount: 1000,
  ...p,
});

// Rubro 1 → ítems 2 y 3; subrubro 4 (en 1) → ítem 5
const rubro = row({ id: 1, nodeKind: "RUBRO", parentId: null, sortOrder: 1, contractQty: null, realQty: null, executedQty: null, saldoQty: null, pct: null, contractAmount: 0, realAmount: 0, executedAmount: 0, saldoAmount: 0 });
const sub = row({ id: 4, nodeKind: "SUBRUBRO", parentId: 1, sortOrder: 2, contractQty: null, realQty: null, executedQty: null, saldoQty: null, pct: null, contractAmount: 0, realAmount: 0, executedAmount: 0, saldoAmount: 0 });
const a = row({ id: 2, parentId: 1, sortOrder: 3, code: "1.1", name: "Excavación", contractAmount: 1000, realAmount: 1200, executedAmount: 600, saldoAmount: 600, realQty: 120, executedQty: 60, saldoQty: 60 });
const b = row({ id: 3, parentId: 1, sortOrder: 4, code: "1.2", name: "Relleno", contractAmount: 500, realAmount: 500, executedAmount: 700, saldoAmount: -200, realQty: 50, executedQty: 70, saldoQty: -20, pct: 1.4, exceeded: true });
const c = row({ id: 5, parentId: 4, sortOrder: 5, code: "2.1", name: "Hormigón", contractAmount: 300, realAmount: 300, executedAmount: 0, saldoAmount: 300 });
const rows = [rubro, a, b, sub, c];

describe("montos de rubros y totales", () => {
  it("un rubro suma los montos de todos sus ítems descendientes; el total general no duplica rubros", () => {
    const m = montosPorNodo(rows);
    expect(m.get(1)).toEqual({ contractAmount: 1800, realAmount: 2000, executedAmount: 1300, saldoAmount: 700 });
    expect(m.get(4)).toEqual({ contractAmount: 300, realAmount: 300, executedAmount: 0, saldoAmount: 300 });
    expect(totalesGenerales(rows)).toEqual({ contractAmount: 1800, realAmount: 2000, executedAmount: 1300, saldoAmount: 700 });
  });
});

describe("árbol visible", () => {
  it("ordena por sortOrder y muestra la jerarquía con profundidad", () => {
    const v = buildPrevistoView(rows);
    expect(v.map((x) => [x.row.id, x.depth])).toEqual([[1, 0], [4, 1], [5, 2], [2, 1], [3, 1]]);
    expect(v[0].hasChildren).toBe(true);
    expect(v[3].hasChildren).toBe(false);
  });

  it("colapsar un rubro oculta sus hijos, salvo que haya filtros activos", () => {
    const colapsado = buildPrevistoView(rows, { collapsed: new Set([4]) });
    expect(colapsado.map((x) => x.row.id)).toEqual([1, 4, 2, 3]);
    const conFiltro = buildPrevistoView(rows, { collapsed: new Set([4]), search: "hormigón" });
    expect(conFiltro.map((x) => x.row.id)).toEqual([1, 4, 5]);
  });

  it("búsqueda: conserva los ancestros de cada coincidencia", () => {
    const v = buildPrevistoView(rows, { search: "relleno" });
    expect(v.map((x) => x.row.id)).toEqual([1, 3]);
  });

  it("solo con desvío: ítems excedidos o con saldo negativo, con sus rubros", () => {
    const v = buildPrevistoView(rows, { soloConDesvio: true });
    expect(v.map((x) => x.row.id)).toEqual([1, 3]);
  });

  it("los montos de cada fila: propios en ítems, sumados en rubros", () => {
    const v = buildPrevistoView(rows);
    expect(v.find((x) => x.row.id === 1)!.montos.realAmount).toBe(2000);
    expect(v.find((x) => x.row.id === 3)!.montos).toEqual({ contractAmount: 500, realAmount: 500, executedAmount: 700, saldoAmount: -200 });
  });
});
