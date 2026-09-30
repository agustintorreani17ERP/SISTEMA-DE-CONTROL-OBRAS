import { describe, expect, it } from "vitest";
import { AcuComp, computeCostEngine, EngineInput, EngineInsumo, LedgerLine, teoricoPorInsumo } from "../costEngineMath";

/**
 * Mes 3 del Excel docs/Control_Costo_Venta_Ejecutado_CTN.xlsx.
 * Ítems: 1 = 3.3 (B3) visto, 2 = 3.4 (B3) común, 3 = 3.2 losa, 4 = 3.3 viga.
 */
const MAR = { desde: "2026-03-01", hasta: "2026-03-31" };
const VENTANA = { desde: "2026-02-28", hasta: "2026-03-31" };

// Hoja "2 Insumos"
const ins = (id: number, code: string, tipo: EngineInsumo["tipo"], precio: number, tol = 0, unit = "un"): EngineInsumo => ({
  id,
  code,
  description: code,
  unit,
  tipo,
  precio,
  toleranciaPct: tol,
});
const insumos: Record<number, EngineInsumo> = {
  1: ins(1, "LC", "COMUN", 700, 5),
  2: ins(2, "LV", "COMUN", 1300, 4),
  3: ins(3, "CEM", "COMUN", 58000, 5),
  4: ins(4, "CAL", "COMUN", 1200, 5),
  5: ins(5, "AR", "COMUN", 150000, 10),
  6: ins(6, "MM", "COMUN", 5000),
  7: ins(7, "HE", "DIRECTO", 900000, 3),
  8: ins(8, "AC", "DIRECTO", 9500, 3),
  9: ins(9, "AL", "COMUN", 15000, 10),
  10: ins(10, "EN", "TIEMPO", 35000),
  11: ins(11, "BV", "TIEMPO", 55000),
  12: ins(12, "MOV", "DIRECTO", 50000),
  13: ins(13, "MOC", "DIRECTO", 31000),
  14: ins(14, "MOL", "DIRECTO", 850000),
  15: ins(15, "MOW", "DIRECTO", 800000),
};

// Hoja "3 ACU"
const c = (insumoId: number, consumo: number): AcuComp => ({ insumoId, consumo, desperdicioPct: 0 });
const acu: Record<number, AcuComp[]> = {
  1: [c(2, 58), c(3, 0.12), c(4, 6), c(5, 0.035), c(6, 1), c(12, 1)],
  2: [c(1, 60), c(3, 0.1), c(4, 6), c(5, 0.035), c(13, 1)],
  3: [c(7, 1.05), c(8, 100), c(9, 1.5), c(10, 8), c(11, 1), c(14, 1)],
  4: [c(7, 1.05), c(8, 120), c(9, 2), c(10, 12), c(11, 1), c(15, 1)],
};

// Hoja "5 Medición mes" (ejecutado) y costo meta de la hoja 4 → VG
const items = [
  { id: 1, code: "3.3 (B3)", name: "Mampostería visto", unit: "m2", ejecutado: 18, vg: 18 * 149810 },
  { id: 2, code: "3.4 (B3)", name: "Mampostería común", unit: "m2", ejecutado: 95, vg: 95 * 91250 },
  { id: 3, code: "3.2 (B6)", name: "Losas HºAº", unit: "m3", ejecutado: 40, vg: 40 * 3102500 },
  { id: 4, code: "3.3 (B6)", name: "Vigas HºAº", unit: "m3", ejecutado: 58, vg: 58 * 3390000 },
];

// Hoja "7 Costo real mes": MO certificada y materiales directos por remito (vía A)
const L = (budgetItemId: number, amount: number, source: string, bucket: LedgerLine["bucket"] = "ITEM"): LedgerLine => ({
  budgetItemId,
  amount,
  source,
  bucket,
  fecha: "2026-03-31",
});
const ledger: LedgerLine[] = [
  L(1, 18 * 50000, "SUBCONTRACT"),
  L(2, 95 * 31000, "SUBCONTRACT"),
  L(3, 40 * 850000, "SUBCONTRACT"),
  L(3, 43.5 * 915000, "PURCHASE_ORDER"),
  L(3, 3900 * 9500, "PURCHASE_ORDER"),
  L(4, 58 * 800000, "SUBCONTRACT"),
  L(4, 62 * 915000, "PURCHASE_ORDER"),
  L(4, 7300 * 9500, "PURCHASE_ORDER"),
  // Equipos (encofrado + bombeo) contratados sin ítem → pozo de tiempo
  L(900, 40950000, "PURCHASE_ORDER", "POOL_TIEMPO"),
  // Compras de comunes del mes (hoja 6B, columna "Compras del mes") → pozo de stock
  L(901, 5000 * 700 + 1200 * 1300 + 12 * 58000 + 700 * 1200 + 4 * 150000 + 180 * 15000, "PURCHASE_ORDER", "POOL_STOCK"),
];

const ejecutado = new Map(items.map((i) => [i.id, i.ejecutado]));
const teorico = teoricoPorInsumo(ejecutado, acu, (id) => insumos[id].tipo === "COMUN");
const teoricoTotal = (id: number) => [...(teorico.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
// Hoja "6 Materiales", bloque B: stock inicial, compras, stock final
const invRow = (insumoId: number, stockInicial: number, entradas: number, stockFinal: number) => ({
  insumoId,
  ventana: VENTANA,
  stockInicial,
  entradas,
  stockFinal,
  teoricoVentana: teoricoTotal(insumoId),
});

const input: EngineInput = {
  ...MAR,
  items,
  acu,
  insumos,
  ledger,
  inventario: [invRow(1, 2000, 5000, 1000), invRow(2, 0, 1200, 120), invRow(3, 5, 12, 4), invRow(4, 100, 700, 75), invRow(5, 1, 4, 0.8), invRow(9, 20, 180, 15)],
  // Horas de encofrado y bombeo del parte diario, valorizadas (llave de la vía C)
  horas: [
    { budgetItemId: 3, peso: 320 * 35000 + 40 * 55000, origen: "EQUIPO" },
    { budgetItemId: 4, peso: 696 * 35000 + 58 * 55000, origen: "EQUIPO" },
  ],
};

describe("motor de costos — Excel CTN, mes 3", () => {
  const r = computeCostEngine(input);
  const item = (id: number) => r.items.find((i) => i.budgetItemId === id)!;

  it("hoja 6A: consumo teórico de comunes", () => {
    expect(teoricoTotal(1)).toBe(5700);
    expect(teoricoTotal(2)).toBe(1044);
    expect(teoricoTotal(3)).toBeCloseTo(11.66, 6);
    expect(teoricoTotal(4)).toBe(678);
    expect(teoricoTotal(9)).toBe(176);
  });

  it("hoja 6B: desvío de inventario, estado según tolerancia y pérdida total", () => {
    const m = (code: string) => r.materiales.find((x) => x.code === code)!;
    expect(m("LC")).toMatchObject({ consumoReal: 6000, desvio: 300, estado: "ALERTA", perdidaValorizada: 210000, ventana: VENTANA, prorrateado: false });
    expect(m("LV")).toMatchObject({ consumoReal: 1080, desvio: 36, estado: "OK", perdidaValorizada: 46800 });
    expect(m("CEM").estado).toBe("ALERTA");
    expect(m("CEM").perdidaValorizada).toBeCloseTo(77720, 4);
    expect(m("CAL")).toMatchObject({ estado: "ALERTA", perdidaValorizada: 56400 });
    expect(m("AR").estado).toBe("OK");
    expect(m("AR").perdidaValorizada).toBeCloseTo(36750, 4);
    expect(m("AL")).toMatchObject({ estado: "OK", perdidaValorizada: 135000 });
    expect(m("MM").estado).toBe("SIN_CONTEO");
    expect(r.totales.perdidas).toBeCloseTo(562670, 3);
  });

  it("hoja 7: costo real por ítem y vía", () => {
    expect(item(1)).toMatchObject({ a: { total: 900000 }, c: { total: 0 } });
    expect(item(1).b.total).toBeCloseTo(1796580, 4);
    expect(item(1).total).toBeCloseTo(2696580, 4);
    expect(item(2).b.total).toBeCloseTo(5723750, 4);
    expect(item(2).total).toBeCloseTo(8668750, 4);
    expect(item(3).a.porFuente).toEqual({ SUBCONTRACT: 34000000, PURCHASE_ORDER: 76852500 });
    expect(item(3).b.total).toBeCloseTo(900000, 4);
    expect(item(3).c.total).toBeCloseTo(13400000, 4);
    expect(item(3).total).toBeCloseTo(125152500, 3);
    expect(Math.round(item(3).costoUnitario!)).toBe(3128813);
    expect(item(4).a.total).toBe(46400000 + 126080000);
    expect(item(4).c.total).toBeCloseTo(27550000, 4);
    expect(item(4).total).toBeCloseTo(201770000, 3);
    expect(Math.round(item(4).costoUnitario!)).toBe(3478793);
    expect(r.totales.imputado).toBeCloseTo(338287830, 2);
    expect(r.totales.costoReal).toBeCloseTo(338850500, 2);
  });

  it("hoja 8: índice de costo IC = VG ÷ CR", () => {
    expect(item(1).ic!).toBeCloseTo(1, 6);
    expect(item(3).ic!).toBeCloseTo(0.99, 2);
    expect(item(4).ic!).toBeCloseTo(0.97, 2);
    expect(r.totales.ic!).toBeCloseTo(0.98, 2);
  });

  it("validación: imputado + pérdidas + no imputado = total contable", () => {
    // Se compraron comunes por 9.896.000 y se consumieron (teórico + pérdidas) 10.723.000: salió stock inicial.
    expect(r.noImputado.stockNoConsumido).toBeCloseTo(9896000 - 10160330 - 562670, 2);
    expect(r.totales.totalContable).toBe(287177500 + 40950000 + 9896000);
    expect(r.totales.diferencia).toBeCloseTo(0, 6);
    expect(r.totales.ok).toBe(true);
  });
});

describe("motor de costos — reglas", () => {
  it("vía C: lo que no tiene ítem se prorratea por valor ganado", () => {
    const r = computeCostEngine({
      ...input,
      ledger: [L(900, 1000, "PETTY_CASH", "GG")],
      horas: [
        { budgetItemId: 3, peso: 300, origen: "EQUIPO" },
        { budgetItemId: null, peso: 700, origen: "PERSONAL" },
      ],
      inventario: [],
    });
    const i3 = r.items.find((i) => i.budgetItemId === 3)!;
    expect(i3.c.porHoras).toBeCloseTo(300, 6);
    expect(r.tiempo.porVG).toBeCloseTo(700, 6);
    const vgTot = items.reduce((a, i) => a + i.vg, 0);
    expect(r.items.find((i) => i.budgetItemId === 1)!.c.porVG).toBeCloseTo((700 * items[0].vg) / vgTot, 6);
    expect(r.totales.ok).toBe(true);
  });

  it("sin horas ni valor ganado, el tiempo queda no imputado", () => {
    const r = computeCostEngine({ ...input, items: items.map((i) => ({ ...i, ejecutado: 0, vg: 0 })), ledger: [L(900, 500, "PURCHASE_ORDER", "POOL_TIEMPO")], horas: [], inventario: [] });
    expect(r.noImputado.tiempoSinDistribuir).toBe(500);
    expect(r.totales.imputado).toBe(0);
    expect(r.totales.ok).toBe(true);
  });

  it("si la ventana de conteos es más larga que el rango, la pérdida se prorratea por el teórico", () => {
    const r = computeCostEngine({
      ...input,
      inventario: [{ insumoId: 1, ventana: { desde: "2026-02-28", hasta: "2026-04-30" }, stockInicial: 2000, entradas: 10000, stockFinal: 800, teoricoVentana: 11400 }],
    });
    const lc = r.materiales.find((m) => m.code === "LC")!;
    // Ventana: real 11.200, teórico 11.400 → sobrante 200; al rango le toca 5.700/11.400 = la mitad.
    expect(lc).toMatchObject({ desvio: -200, prorrateado: true, perdidaRango: -100, estado: "OK" });
  });

  it("personal liquidado con rubro va directo al ítem por la vía C", () => {
    const r = computeCostEngine({ ...input, ledger: [L(2, 1234, "LABOR_COST", "ITEM_TIEMPO")], horas: [], inventario: [] });
    expect(r.items.find((i) => i.budgetItemId === 2)!.c).toMatchObject({ asignado: 1234, total: 1234 });
  });
});
