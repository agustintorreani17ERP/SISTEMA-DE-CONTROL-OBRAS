import { describe, expect, it } from "vitest";
import { auxFormula, auxSubtotal, buildCertificate, measuredQuantity } from "../certMath";

describe("cálculo auxiliar (cómputo métrico)", () => {
  it("multiplica solo las dimensiones cargadas", () => {
    expect(auxSubtotal({ largo: 12 })).toBe(12); // ml
    expect(auxSubtotal({ largo: 4, ancho: 2.8 })).toBe(11.2); // m²
    expect(auxSubtotal({ largo: 2, ancho: 0.3, alto: 0.4, factor_repeticion: 5 })).toBe(1.2); // m³ × piezas
    expect(auxSubtotal({ factor_repeticion: 7 })).toBe(7); // unidades
  });

  it("descuenta vanos y aberturas", () => {
    const lines = [
      { largo: 10, ancho: 2.8 }, // muro
      { largo: 1.2, ancho: 1.1, factor_repeticion: 2, isDeduction: true }, // 2 ventanas
    ];
    expect(measuredQuantity(lines)).toBe(25.36);
    expect(auxFormula(lines[1])).toBe("− 2 × 1,2 × 1,1");
  });
});

describe("certificado (Medición N / Cert N)", () => {
  const rows = [
    { code: "3.1", name: "Mampostería", unit: "m²", contractedQuantity: 100, previousQuantity: 40, periodQuantity: 30, unitPrice: 50000 },
    { code: "4.1", name: "Revoque", unit: "m²", contractedQuantity: 50, previousQuantity: 45, periodQuantity: 10, unitPrice: 20000 },
  ];

  it("calcula acumulados, avance, saldo, fondo de reparo y neto", () => {
    const c = buildCertificate(rows, 5);
    expect(c.rows[0].accumulatedQuantity).toBe(70);
    expect(c.rows[0].progress).toBe(0.7);
    expect(c.periodAmount).toBe(1_500_000 + 200_000);
    expect(c.contractAmount).toBe(5_000_000 + 1_000_000);
    expect(c.accumulatedAmount).toBe(3_500_000 + 1_100_000);
    expect(c.balance).toBe(6_000_000 - 4_600_000);
    expect(c.retentionAmount).toBe(85_000);
    expect(c.netAmount).toBe(1_615_000);
  });

  it("alerta cuando el acumulado supera lo contratado", () => {
    const c = buildCertificate(rows);
    expect(c.rows[1].overContract).toBe(true); // 55 de 50
    expect(c.rows[0].overContract).toBe(false);
  });
});
