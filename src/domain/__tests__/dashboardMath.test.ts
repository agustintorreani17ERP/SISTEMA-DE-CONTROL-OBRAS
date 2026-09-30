import { describe, expect, it } from "vitest";
import { aggregate, alertas, byRubro, codeName, cortes, curvaPorDias, curvaS, type DashItemInput, diagnostico, itemRow } from "../dashboardMath";
import { localIso } from "../localDate";

/**
 * Hoja "8 Resumen", mes 3 del Excel CTN. Costo meta (hoja 4), ejecutado y planificado (hoja 5),
 * costo real (hoja 7). PU sin IVA = certificado ÷ ejecutado; contrato = costo proyectado × IC ÷
 * costo meta. Mes 3 como rango y como acumulado (así el IC acumulado es el del mes, como en la hoja).
 */
const base = { unit: "m2", superaOferta: false, diferenciaOferta: null };
const rubroB3 = { id: 100, code: "B3", name: "Mampostería" };
const rubroB6 = { id: 200, code: "B6", name: "Estructura" };
const fila = (p: { id: number; code: string; name: string; rubro: typeof rubroB3; cm: number; ejec: number; venta: number; vp: number; cr: number; contrato: number; unit?: string }): DashItemInput => ({
  ...base,
  unit: p.unit ?? "m2",
  id: p.id,
  code: p.code,
  name: p.name,
  rubro: p.rubro,
  costoMetaUnit: p.cm,
  puSinIva: p.venta / p.ejec,
  ejecutado: p.ejec,
  planificado: p.vp / p.cm,
  costoReal: p.cr,
  contrato: p.contrato,
  acumulado: p.ejec,
  costoRealAcum: p.cr,
});
const inputs: DashItemInput[] = [
  fila({ id: 1, code: "3.3 (B3)", name: "Mampostería visto", rubro: rubroB3, cm: 149_810, ejec: 18, venta: 3_742_656, vp: 2_996_200, cr: 2_696_580, contrato: 7_745_776 / 149_810 }),
  fila({ id: 2, code: "3.4 (B3)", name: "Mampostería común", rubro: rubroB3, cm: 91_250, ejec: 95, venta: 10_975_992, vp: 7_300_000, cr: 8_668_750, contrato: 15_823_571 / 91_250 }),
  fila({ id: 3, code: "3.2 (B6)", name: "Losas HºAº", rubro: rubroB6, cm: 3_102_500, ejec: 40, venta: 128_864_766, vp: 151_246_875, cr: 125_152_500, contrato: 97.5, unit: "m3" }),
  fila({ id: 4, code: "3.3 (B6)", name: "Vigas HºAº", rubro: rubroB6, cm: 3_390_000, ejec: 58, venta: 207_851_921, vp: 224_418_000, cr: 201_770_000, contrato: 132.4, unit: "m3" }),
];

describe("tablero: reproduce la hoja 8 Resumen", () => {
  const rows = inputs.map(itemRow);

  it("por ítem: margen real y previsto, IC, IP, costo y resultado proyectados, diagnóstico", () => {
    const esperado = [
      { margen: 1_046_076, real: 0.28, prev: 0.28, ic: 1.0, ip: 0.9, eac: 7_745_776, res: 3_004_794, diag: "Costo OK · Leve atraso" },
      { margen: 2_307_242, real: 0.21, prev: 0.21, ic: 1.0, ip: 1.19, eac: 15_823_571, res: 4_211_542, diag: "Costo OK · En plazo" },
      { margen: 3_712_266, real: 0.029, prev: 0.037, ic: 0.99, ip: 0.82, eac: 305_059_219, res: 9_048_649, diag: "Leve sobrecosto · Atrasado" },
      { margen: 6_081_921, real: 0.029, prev: 0.054, ic: 0.97, ip: 0.88, eac: 460_592_207, res: 13_883_558, diag: "Leve sobrecosto · Atrasado" },
    ];
    rows.forEach((r, k) => {
      const e = esperado[k];
      expect(r.margenReal).toBeCloseTo(e.margen, 0);
      // La hoja muestra los % con un decimal
      expect(Math.abs(r.margenRealPct! - e.real)).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(Math.abs(r.margenPrevistoPct! - e.prev)).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(r.ic!).toBeCloseTo(e.ic, 2);
      expect(r.ip!).toBeCloseTo(e.ip, 2);
      expect(Math.abs(r.eac - e.eac)).toBeLessThan(2);
      expect(Math.abs(r.resultadoProyectado - e.res)).toBeLessThan(2);
      expect(r.diagnostico).toBe(e.diag);
    });
  });

  it("subtotal de ítems y resultado del mes con las pérdidas de material aparte", () => {
    const sub = aggregate(rows);
    expect(sub.ventaSinIva).toBeCloseTo(351_435_335, 0);
    expect(sub.vp).toBeCloseTo(385_961_075, 0);
    expect(sub.vg).toBe(332_085_330);
    expect(sub.costoReal).toBe(338_287_830);
    expect(sub.margenReal).toBeCloseTo(13_147_505, 0);
    expect(sub.margenRealPct!).toBeCloseTo(0.037, 3);
    expect(sub.ic!).toBeCloseTo(0.98, 2);
    expect(sub.ip!).toBeCloseTo(0.86, 2);
    expect(Math.abs(sub.eac - 789_220_773)).toBeLessThan(3); // suma de las proyecciones de los ítems
    expect(Math.abs(sub.resultadoProyectado - 30_148_542)).toBeLessThan(3);

    const obra = aggregate(rows, { costoReal: 338_850_500 }); // + pérdidas de material 562.670
    expect(obra.margenReal).toBeCloseTo(12_584_835, 0);
    expect(obra.margenRealPct!).toBeCloseTo(0.036, 3);
    expect(obra.ic!).toBeCloseTo(0.98, 2);

    const rub = byRubro(inputs, rows);
    expect(rub.map((r) => [r.code, r.items])).toEqual([
      ["B3", 2],
      ["B6", 2],
    ]);
    expect(rub[1].ic!).toBeCloseTo((124_100_000 + 196_620_000) / (125_152_500 + 201_770_000), 10);
  });

  it("proyección con acumulado distinto del rango: costo acumulado + lo que falta ÷ IC acumulado", () => {
    const r = itemRow({ ...base, id: 9, code: "9", name: "Contrapiso", rubro: null, contrato: 1000, puSinIva: 100, costoMetaUnit: 80, ejecutado: 100, planificado: 125, costoReal: 9_000, acumulado: 400, costoRealAcum: 40_000 });
    // BAC 80.000; VG acum 32.000; IC acum 0,8 → EAC = 40.000 + 48.000 ÷ 0,8 = 100.000 = BAC ÷ IC acum
    expect(r.eac).toBeCloseTo(100_000, 6);
    expect(r.resultadoProyectado).toBeCloseTo(0, 6); // venta total 100.000
    expect(r.ic).toBeCloseTo(8_000 / 9_000, 10); // IC del rango
    expect(diagnostico(null, null)).toBeNull();
  });

  it("alertas: IC, IP, desvío de material, ACU sobre la oferta y no imputado alto", () => {
    const ins = inputs.map((i) => (i.id === 4 ? { ...i, superaOferta: true, diferenciaOferta: 12_000 } : i));
    const rs = ins.map(itemRow);
    const obra = aggregate(rs, { costoReal: 338_850_500 });
    const a = alertas({
      obra,
      rubros: byRubro(ins, rs),
      items: rs,
      inputs: ins,
      materiales: [
        { code: "LC", description: "Ladrillo común", estado: "ALERTA", desvioPct: 0.0368, toleranciaPct: 3, perdidaValorizada: 210_000 },
        { code: "AR", description: "Arena", estado: "OK", desvioPct: 0.01, toleranciaPct: 5, perdidaValorizada: 5_000 },
      ],
      noImputado: 50_000_000,
      totalContable: 388_850_500,
      validacionOk: true,
    });
    const tipos = a.map((x) => `${x.tipo}:${x.nivel}:${x.itemId ?? x.ref}`);
    expect(tipos).toContain("IP:ITEM:3"); // 0,82 < 0,9
    expect(tipos).toContain("IP:ITEM:4"); // 0,88
    expect(tipos).toContain("IP:OBRA:Obra"); // 0,86
    expect(tipos).toContain("ACU_SOBRE_OFERTA:ITEM:4");
    expect(tipos).toContain("DESVIO_MATERIAL:INSUMO:LC Ladrillo común");
    expect(tipos).toContain("NO_IMPUTADO:OBRA:Obra"); // 12,9 % > 10 %
    expect(tipos.some((t) => t.startsWith("IC:"))).toBe(false); // todos ≥ 0,95
    expect(tipos).not.toContain("IP:ITEM:1"); // 0,90 justo en el umbral
    expect(tipos.some((t) => t.startsWith("DESVIO_MATERIAL") && t.includes("AR"))).toBe(false);
  });
});

describe("fechas locales y rótulos", () => {
  it("hoy se toma en hora de Asunción, no en UTC", () => {
    // 29/9 21:30 en Asunción (UTC-3) = 30/9 00:30 UTC
    expect(localIso(new Date("2026-09-30T00:30:00Z"))).toBe("2026-09-29");
    expect(localIso(new Date("2026-09-30T03:30:00Z"))).toBe("2026-09-30");
  });

  it("código y descripción iguales (o uno contiene al otro) se muestran una sola vez", () => {
    expect(codeName("Área: 1) OBRADOR", "Área: 1) OBRADOR")).toBe("Área: 1) OBRADOR");
    expect(codeName("1)", "1) OBRADOR")).toBe("1) OBRADOR");
    expect(codeName("3.3", "Mampostería")).toBe("3.3 Mampostería");
    expect(codeName("", "Sin rubro")).toBe("Sin rubro");
  });

  it("la curva va por días hasta ~2 meses y por meses después", () => {
    expect(curvaPorDias("2026-08-01", "2026-09-29")).toBe(true);
    expect(curvaPorDias("2026-06-01", "2026-09-29")).toBe(false);
  });
});

describe("curva S", () => {
  it("cortes por fin de mes (o semanales en lapsos cortos) más la fecha final", () => {
    expect(cortes("2026-01-15", "2026-04-10")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-10"]);
    expect(cortes("2026-09-01", "2026-09-20")).toEqual(["2026-09-06", "2026-09-13", "2026-09-20"]);
  });

  it("planificado, ganado y real acumulados a cada corte", () => {
    const pts = curvaS(["2026-01-31", "2026-02-28"], {
      items: [
        { id: 1, costoMetaUnit: 100 },
        { id: 2, costoMetaUnit: null },
      ],
      plan: new Map([[1, [{ fecha: "2026-01-31", cantidad: 10 }, { fecha: "2026-02-28", cantidad: 10 }]]]),
      acumuladoAl: (id, f) => (id === 1 ? (f >= "2026-02-01" ? 18 : 7) : 99),
      costos: [
        { fecha: "2026-01-10", amount: 500 },
        { fecha: "2026-02-10", amount: 1_400 },
      ],
    });
    expect(pts).toEqual([
      { fecha: "2026-01-31", planificado: 1_000, ganado: 700, real: 500 },
      { fecha: "2026-02-28", planificado: 2_000, ganado: 1_800, real: 1_900 },
    ]);
  });
});
