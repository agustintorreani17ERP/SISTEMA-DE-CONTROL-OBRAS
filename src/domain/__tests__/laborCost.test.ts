import { describe, expect, it } from "vitest";
import { CARGAS_DEFAULT, asistenciaDesdeParte, cargasPct, costoHora, pesosPersonal } from "../laborCost";

describe("costo hora con cargas", () => {
  it("mensualero: salario ÷ 26 días ÷ 8 h × (1 + IPS 16,5 + aguinaldo 8,33 + vacaciones 4,17)", () => {
    const c = costoHora({ tipo: "MENSUALERO", salarioBase: 2_899_048 }, CARGAS_DEFAULT);
    expect(c.base).toBeCloseTo(2_899_048 / 26 / 8, 6);
    expect(cargasPct(CARGAS_DEFAULT).total).toBeCloseTo(16.5 + 100 / 12 + 4.17, 6);
    expect(c.costoHora).toBe(Math.round((2_899_048 / 208) * (1 + (16.5 + 100 / 12 + 4.17) / 100)));
    expect(c.manual).toBe(false);
  });

  it("jornalero: el salario base es el jornal diario", () => {
    const c = costoHora({ tipo: "JORNALERO", salarioBase: 120_000 }, { ...CARGAS_DEFAULT, pctVacaciones: 0, aguinaldoMeses: 12, pctIpsPatronal: 0 });
    expect(c.base).toBe(15_000);
    expect(c.costoHora).toBe(Math.round(15_000 * (1 + 100 / 12 / 100)));
  });

  it("el costo hora manual reemplaza al calculado", () => {
    const c = costoHora({ tipo: "MENSUALERO", salarioBase: 3_000_000, costoHoraManual: 25_000 }, CARGAS_DEFAULT);
    expect(c.costoHora).toBe(25_000);
    expect(c.manual).toBe(true);
  });
});

describe("pesos de personal para la vía C", () => {
  const costo = () => ({ base: 10_000, cargas: { ipsPatronal: 0, aguinaldo: 0, vacaciones: 0, otras: 0, total: 30 }, factor: 1.3, costoHora: 13_000, manual: false });

  it("el parte por ítem reemplaza la asistencia del mismo empleado y día", () => {
    const pesos = pesosPersonal(
      [
        { empleadoId: 1, fecha: "2026-09-01", budgetItemId: 10, horas: 5 },
        { empleadoId: 1, fecha: "2026-09-01", budgetItemId: 11, horas: 3 },
      ],
      [
        { empleadoId: 1, fecha: "2026-09-01", budgetItemId: 99, horas: 8, jornal: 0 },
        { empleadoId: 2, fecha: "2026-09-01", budgetItemId: null, horas: 8, jornal: 0 },
        { empleadoId: 3, fecha: "2026-09-01", budgetItemId: 12, horas: 8, jornal: 100_000 },
      ],
      costo
    );
    expect(pesos).toEqual([
      { budgetItemId: 10, peso: 65_000 },
      { budgetItemId: 11, peso: 39_000 },
      { budgetItemId: null, peso: 104_000 },
      { budgetItemId: 12, peso: 130_000 },
    ]);
  });

  it("asistencia derivada: normales hasta la jornada, extra el resto, ítem con más horas", () => {
    expect(asistenciaDesdeParte([{ budgetItemId: 1, horas: 4 }, { budgetItemId: 2, horas: 6 }], 8)).toEqual({
      estado: "PRESENTE",
      horasNormales: 8,
      horasExtra: 2,
      budgetItemId: 2,
    });
    expect(asistenciaDesdeParte([{ budgetItemId: null, horas: 4 }], 8).estado).toBe("MEDIA_JORNADA");
  });
});
