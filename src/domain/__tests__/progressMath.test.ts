import { describe, expect, it } from "vitest";
import { acumuladoAl, AvanceFact, avanceRango, indicadores, planAcumulado, planRango } from "../progressMath";

const O = (fecha: string, cantidad: number): AvanceFact => ({ fecha, cantidad, origen: "MEDICION_OFICIAL" });
const P = (fecha: string, cantidad: number): AvanceFact => ({ fecha, cantidad, origen: "PARTE_DIARIO" });

// Hoja "5 Medición mes", ítem 3.3 (B3): contrato 51,70 m2, acum. anterior 10, plan mes 20, ejecutado 18.
const item33 = [O("2026-02-28", 10), P("2026-03-10", 7), P("2026-03-20", 9), O("2026-03-31", 18)];
const MES3 = ["2026-03-01", "2026-03-31"] as const;

describe("avance fechado", () => {
  it("reproduce la hoja 5 para el ítem 3.3", () => {
    const a = avanceRango(item33, ...MES3);
    expect(a).toMatchObject({ anterior: 10, rango: 18, acumulado: 28, rangoOficial: 18, provisorio: 0 });
    const ind = indicadores({ contrato: 51.7, acumulado: 28, ejecutado: 18, planificado: 20, costoMetaUnit: 149810, puSinIva: 228718 / 1.1 });
    expect(ind.pctAvance!).toBeCloseTo(0.542, 3);
    expect(ind.cumplimiento).toBe(0.9);
  });

  it("la medición oficial reemplaza a los partes hasta su fecha", () => {
    // Los partes decían 16; la medición oficial dice 18.
    expect(acumuladoAl(item33, "2026-03-25")).toMatchObject({ total: 26, oficial: 10, provisorio: 16 });
    expect(acumuladoAl(item33, "2026-03-31")).toMatchObject({ total: 28, oficial: 28, provisorio: 0 });
  });

  it("los partes posteriores a la última medición siguen como provisorios", () => {
    const facts = [...item33, P("2026-04-05", 4)];
    const abril = avanceRango(facts, "2026-04-01", "2026-04-30");
    expect(abril).toMatchObject({ anterior: 28, rango: 4, rangoOficial: 0, provisorio: 4, ultimaOficial: "2026-03-31" });
  });

  it("sin medición oficial todo el avance es provisorio", () => {
    expect(acumuladoAl([P("2026-03-02", 5), P("2026-03-03", 5)], "2026-03-31")).toMatchObject({ total: 10, oficial: 0, provisorio: 10, ultimaOficial: null });
  });

  it("losa 3.2: primer mes sin acumulado anterior", () => {
    expect(avanceRango([O("2026-03-31", 40)], ...MES3)).toMatchObject({ anterior: 0, rango: 40, acumulado: 40 });
  });
});

describe("planificado", () => {
  const plan = [
    { fecha: "2026-02-28", cantidad: 12 },
    { fecha: "2026-03-31", cantidad: 20 },
    { fecha: "2026-04-30", cantidad: 19.7 },
  ];
  it("suma el cronograma por fecha de fin de período", () => {
    expect(planRango(plan, ...MES3)).toBe(20);
    expect(planAcumulado(plan, "2026-03-31")).toBe(32);
    expect(planAcumulado(plan, "2026-04-30")).toBe(51.7);
  });
});

describe("valor ganado (hoja 8)", () => {
  it("VP = planificado × costo meta, VG = ejecutado × costo meta, venta sin IVA = ejecutado × PU sin IVA", () => {
    const i33 = indicadores({ contrato: 51.7, acumulado: 28, ejecutado: 18, planificado: 20, costoMetaUnit: 149810, puSinIva: 228718 / 1.1 });
    expect(i33.vp).toBe(2996200);
    expect(i33.vg).toBe(2696580);
    expect(i33.ip!).toBeCloseTo(0.9, 2);
    expect(Math.abs(i33.ventaSinIva - 3742656)).toBeLessThan(5);

    const losa = indicadores({ contrato: 97.5, acumulado: 40, ejecutado: 40, planificado: 48.75, costoMetaUnit: 3102500, puSinIva: 3543781 / 1.1 });
    expect(losa.vp).toBe(151246875);
    expect(losa.vg).toBe(124100000);
    expect(losa.ip!).toBeCloseTo(0.82, 2);
  });

  it("sin costo meta no hay VP ni VG", () => {
    expect(indicadores({ contrato: 1, acumulado: 1, ejecutado: 1, planificado: 1, costoMetaUnit: null, puSinIva: 1 })).toMatchObject({ vp: null, vg: null, ip: null });
  });
});
