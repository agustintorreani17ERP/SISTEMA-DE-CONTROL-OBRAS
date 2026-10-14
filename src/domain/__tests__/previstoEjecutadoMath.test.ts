import { describe, expect, it } from "vitest";
import {
  buildPrevistoRows,
  cantidadVigente,
  montoVigente,
  type PrevistoAdenda,
  type PrevistoDelta,
  type PrevistoItem,
} from "../../ecms/domain/previstoEjecutadoMath";

const item = (p: Partial<PrevistoItem> & { id: number }): PrevistoItem => ({
  parentId: 1,
  code: String(p.id),
  name: `Ítem ${p.id}`,
  unit: "m3",
  nodeKind: "ITEM",
  sortOrder: p.id,
  unitPrice: 10_000,
  contractQuantity: 100,
  contractAmount: 1_000_000,
  isExtra: false,
  origenAdendaId: null,
  ...p,
});
const rubro: PrevistoItem = item({ id: 1, parentId: null, nodeKind: "RUBRO", unitPrice: 0, contractQuantity: 0, contractAmount: 0 });
const adenda = (id: number, numero: number): PrevistoAdenda => ({ id, numero, titulo: `Adenda ${numero}`, fecha: "2026-10-01" });

describe("cantidad y monto vigentes", () => {
  it("vigente = contractual + Σ deltas; el monto usa el mismo precio", () => {
    expect(cantidadVigente(100, [20, -5])).toBe(115);
    expect(montoVigente(1_000_000, 10_000, [20, -5])).toBe(1_150_000);
  });
});

describe("filas del Previsto vs Ejecutado", () => {
  const items = [rubro, item({ id: 2 }), item({ id: 3, contractQuantity: 50, contractAmount: 500_000 })];

  it("contractual, deltas por adenda, real y ejecutada", () => {
    const adendas = [adenda(1, 1), adenda(2, 2)];
    const deltas: PrevistoDelta[] = [
      { adendaId: 1, budgetItemId: 2, delta: 20 },
      { adendaId: 2, budgetItemId: 2, delta: -5 },
    ];
    const rows = buildPrevistoRows(items, adendas, deltas, new Map([[2, 60]]));
    const r2 = rows.find((r) => r.id === 2)!;
    expect(r2.contractQty).toBe(100);
    expect(r2.deltas).toEqual({ 1: 20, 2: -5 });
    expect(r2.realQty).toBe(115);
    expect(r2.executedQty).toBe(60);
    expect(r2.saldoQty).toBe(55);
    expect(r2.pct).toBeCloseTo(60 / 115, 10);
    expect(r2.exceeded).toBe(false);
    expect(r2.contractAmount).toBe(1_000_000);
    expect(r2.realAmount).toBe(1_150_000);
    expect(r2.executedAmount).toBe(600_000);
    expect(r2.saldoAmount).toBe(550_000);
    const r3 = rows.find((r) => r.id === 3)!;
    expect(r3.realQty).toBe(50);
    expect(r3.executedQty).toBe(0);
  });

  it("marca excedida la ejecutada por encima de la real; los rubros no llevan cantidades", () => {
    const rows = buildPrevistoRows(items, [], [], new Map([[3, 55]]));
    expect(rows.find((r) => r.id === 3)!.exceeded).toBe(true);
    const rub = rows.find((r) => r.id === 1)!;
    expect([rub.contractQty, rub.realQty, rub.executedQty]).toEqual([null, null, null]);
  });

  it("ignora los deltas de adendas que no están incluidas", () => {
    const rows = buildPrevistoRows(items, [adenda(1, 1)], [{ adendaId: 9, budgetItemId: 2, delta: 999 }], new Map());
    expect(rows.find((r) => r.id === 2)!.realQty).toBe(100);
  });

  it("un extra nace en su adenda: contractual 0; sin su adenda no aparece", () => {
    const extra = item({ id: 4, isExtra: true, origenAdendaId: 1, contractQuantity: 0, contractAmount: 0, unitPrice: 5_000 });
    const deltas: PrevistoDelta[] = [{ adendaId: 1, budgetItemId: 4, delta: 10 }];
    const con = buildPrevistoRows([rubro, extra], [adenda(1, 1)], deltas, new Map());
    expect(con.find((r) => r.id === 4)).toMatchObject({ contractQty: 0, realQty: 10, contractAmount: 0, realAmount: 50_000, isExtra: true, extraAdendaNumero: 1 });
    const sin = buildPrevistoRows([rubro, extra], [], deltas, new Map());
    expect(sin.find((r) => r.id === 4)).toBeUndefined();
  });
});
