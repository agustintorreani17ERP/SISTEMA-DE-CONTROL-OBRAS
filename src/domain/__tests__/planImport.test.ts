import { describe, expect, it } from "vitest";
import { parsePeriod, parsePlanGrid, parsePlanValue } from "../planImport";

describe("parsePeriod", () => {
  it.each([
    ["2026-03", "2026-03-31"],
    ["03/2026", "2026-03-31"],
    ["mar-26", "2026-03-31"],
    ["Febrero 2028", "2028-02-29"],
    ["31/03/2026", "2026-03-31"],
    ["2026-03-15", "2026-03-15"],
    ["dic 26", "2026-12-31"],
  ])("%s → %s", (raw, expected) => expect(parsePeriod(raw)).toBe(expected));

  it("devuelve null si no es un período", () => expect(parsePeriod("Total")).toBeNull());
});

describe("parsePlanValue", () => {
  it("lee números en formato PY y porcentajes del contrato", () => {
    expect(parsePlanValue("1.234,5", 0)).toBe(1234.5);
    expect(parsePlanValue("48,75", 0)).toBe(48.75);
    expect(parsePlanValue("50%", 97.5)).toBe(48.75);
    expect(parsePlanValue("", 1)).toBeNull();
    expect(parsePlanValue("abc", 1)).toBeNaN();
  });
});

describe("parsePlanGrid", () => {
  const items = [
    { id: 1, code: "3.3", contrato: 51.7 },
    { id: 2, code: "3.2", contrato: 97.5 },
  ];
  it("arma una fila por ítem y período (hoja 5: plan del mes 3)", () => {
    const text = "Ítem\tfeb-26\tmar-26\tTotal\n3.3\t10\t20\t30\n3.2\t\t50%\t\n9.9\t1\t\t";
    const r = parsePlanGrid(text, items);
    expect(r.periodos).toEqual(["2026-02-28", "2026-03-31"]);
    expect(r.errores).toEqual(['Encabezado "Total" no es un período: se ignora esa columna']);
    expect(r.filas).toEqual([
      { fila: 2, codigo: "3.3", budgetItemId: 1, fecha: "2026-02-28", cantidad: 10 },
      { fila: 2, codigo: "3.3", budgetItemId: 1, fecha: "2026-03-31", cantidad: 20 },
      { fila: 3, codigo: "3.2", budgetItemId: 2, fecha: "2026-03-31", cantidad: 48.75 },
      { fila: 4, codigo: "9.9", budgetItemId: null, fecha: "2026-02-28", cantidad: 1, error: "Ítem inexistente en el presupuesto" },
    ]);
  });
});
