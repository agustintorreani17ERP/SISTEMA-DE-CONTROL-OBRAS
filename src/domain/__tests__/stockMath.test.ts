import { describe, expect, it } from "vitest";
import { deriveCountAdjustments, firstNegativeDay, stockAtDate } from "../stockMath";

const compras = [
  { fecha: "2026-03-01", quantity: 1000 },
  { fecha: "2026-03-10", quantity: 500 },
];

describe("stockAtDate", () => {
  it("suma los movimientos hasta el día inclusive", () => {
    expect(stockAtDate(compras, "2026-02-28")).toBe(0);
    expect(stockAtDate(compras, "2026-03-01")).toBe(1000);
    expect(stockAtDate(compras, "2026-03-31")).toBe(1500);
  });
});

describe("deriveCountAdjustments", () => {
  it("el ajuste es contado − teórico a la fecha del conteo", () => {
    const [a] = deriveCountAdjustments(compras, [{ id: 1, fecha: "2026-03-15", cantidad: 1200 }]);
    expect(a).toEqual({ countId: 1, fecha: "2026-03-15", teorico: 1500, diferencia: -300 });
  });

  it("encadena conteos: el segundo parte del primero", () => {
    const adj = deriveCountAdjustments(compras, [
      { id: 2, fecha: "2026-03-31", cantidad: 1000 },
      { id: 1, fecha: "2026-03-05", cantidad: 800 },
    ]);
    // 05/03: teórico 1000, contado 800 → −200. 31/03: 1000 + 500 − 200 = 1300, contado 1000 → −300
    expect(adj.map((a) => [a.countId, a.teorico, a.diferencia])).toEqual([
      [1, 1000, -200],
      [2, 1300, -300],
    ]);
  });

  it("una compra cargada tarde con fecha anterior cambia el ajuste del conteo, no el saldo contado", () => {
    const counts = [{ id: 1, fecha: "2026-03-15", cantidad: 1200 }];
    const antes = deriveCountAdjustments(compras, counts)[0];
    const despues = deriveCountAdjustments([...compras, { fecha: "2026-03-12", quantity: 200 }], counts)[0];
    expect(antes.diferencia).toBe(-300);
    expect(despues.diferencia).toBe(-500);
    // El saldo al día del conteo es siempre lo contado.
    expect(stockAtDate([...compras, { fecha: "2026-03-12", quantity: 200 }, { fecha: "2026-03-15", quantity: despues.diferencia }], "2026-03-15")).toBe(1200);
  });

  it("dos conteos el mismo día: el segundo corrige al primero", () => {
    const adj = deriveCountAdjustments(compras, [
      { id: 1, fecha: "2026-03-15", cantidad: 1400 },
      { id: 2, fecha: "2026-03-15", cantidad: 1450 },
    ]);
    expect(adj.map((a) => a.diferencia)).toEqual([-100, 50]);
  });

  it("conteo igual al teórico no genera ajuste", () => {
    expect(deriveCountAdjustments(compras, [{ id: 1, fecha: "2026-03-10", cantidad: 1500 }])[0].diferencia).toBe(0);
  });
});

describe("firstNegativeDay", () => {
  it("detecta el primer cierre de día negativo", () => {
    expect(firstNegativeDay([...compras, { fecha: "2026-03-05", quantity: -1200 }])).toEqual({ fecha: "2026-03-05", saldo: -200 });
  });

  it("dentro del mismo día no importa el orden", () => {
    expect(firstNegativeDay([{ fecha: "2026-03-01", quantity: -10 }, { fecha: "2026-03-01", quantity: 10 }])).toBeNull();
  });
});
