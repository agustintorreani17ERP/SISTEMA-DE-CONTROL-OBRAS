import { describe, expect, it } from "vitest";
import { AcuLineInput, computeAcu, paretoIds } from "../acuMath";

// Datos de las hojas "3 ACU" y "4 Presupuesto control" del Excel CTN.
const K = 1.3454;
const mat = (consumo: number, precio: number): AcuLineInput => ({ consumo, precio, desperdicioPct: 0, grupo: "MATERIAL" });
const mo = (consumo: number, precio: number): AcuLineInput => ({ consumo, precio, desperdicioPct: 0, grupo: "MANO_OBRA" });
const eq = (consumo: number, precio: number): AcuLineInput => ({ consumo, precio, desperdicioPct: 0, grupo: "EQUIPO" });

describe("computeAcu", () => {
  it("ítem 3.3 mampostería visto: ACU dentro de la oferta, margen 28 %", () => {
    const r = computeAcu({
      unitPrice: 228718,
      quantity: 51.7,
      coeficienteK: K,
      ivaPct: 10,
      lines: [mat(58, 1300), mat(0.12, 58000), mat(6, 1200), mat(0.035, 150000), mat(1, 5000), mo(1, 50000)],
    });
    expect(r.subtotales.MATERIAL).toBeCloseTo(99810, 6);
    expect(r.subtotales.MANO_OBRA).toBe(50000);
    expect(r.costoAcu).toBeCloseTo(149810, 6);
    expect(Math.round(r.costoOferta!)).toBe(170000);
    expect(Math.round(r.diferenciaOferta!)).toBe(-20190);
    expect(r.superaOferta).toBe(false);
    expect(Math.round(r.ventaSinIvaUnit)).toBe(207925);
    expect(r.margenPct!).toBeCloseTo(0.28, 2);
    expect(Math.round(r.costoMetaTotal!)).toBe(7745177);
    expect(r.fuente).toBe("ACU");
  });

  it("losa de HºAº: el ACU supera la oferta y el margen cae a 3,7 %", () => {
    const r = computeAcu({
      unitPrice: 3543781,
      quantity: 97.5,
      coeficienteK: K,
      ivaPct: 10,
      lines: [mat(1.05, 900000), mat(100, 9500), mat(1.5, 15000), eq(8, 35000), eq(1, 55000), mo(1, 850000)],
    });
    expect(r.subtotales).toEqual({ MATERIAL: 1917500, MANO_OBRA: 850000, EQUIPO: 335000 });
    expect(r.costoAcu).toBe(3102500);
    expect(r.superaOferta).toBe(true);
    expect(r.margenPct!).toBeCloseTo(0.037, 3);
  });

  it("sin componentes usa PU ÷ K", () => {
    const r = computeAcu({ unitPrice: 127090, quantity: 10, coeficienteK: K, ivaPct: 10, lines: [] });
    expect(r.fuente).toBe("K");
    expect(r.costoAcu).toBeNull();
    expect(Math.round(r.costoMetaUnit!)).toBe(94463);
    expect(r.superaOferta).toBe(false);
  });

  it("sin componentes ni K no hay costo meta", () => {
    const r = computeAcu({ unitPrice: 1000, quantity: 1, coeficienteK: null, ivaPct: 10, lines: [] });
    expect(r.fuente).toBeNull();
    expect(r.costoMetaTotal).toBeNull();
    expect(r.margenPct).toBeNull();
  });

  it("aplica el desperdicio y cuenta los insumos sin precio", () => {
    const r = computeAcu({
      unitPrice: 0,
      quantity: 1,
      coeficienteK: null,
      ivaPct: 10,
      lines: [
        { consumo: 60, desperdicioPct: 5, precio: 700, grupo: "MATERIAL" },
        { consumo: 1, desperdicioPct: 0, precio: null, grupo: "MANO_OBRA" },
      ],
    });
    expect(r.costoAcu).toBeCloseTo(44100, 6);
    expect(r.lineasSinPrecio).toBe(1);
  });
});

describe("paretoIds", () => {
  it("toma los ítems mayores hasta cruzar el 80 %", () => {
    const ids = paretoIds([
      { id: 1, amount: 500 },
      { id: 2, amount: 250 },
      { id: 3, amount: 150 },
      { id: 4, amount: 100 },
    ]);
    expect([...ids]).toEqual([1, 2, 3]);
  });

  it("si el primero ya llega al 80 % solo marca ese", () => {
    expect([...paretoIds([{ id: 1, amount: 90 }, { id: 2, amount: 10 }])]).toEqual([1]);
  });

  it("ignora montos nulos o negativos", () => {
    expect(paretoIds([{ id: 1, amount: 0 }]).size).toBe(0);
  });
});
