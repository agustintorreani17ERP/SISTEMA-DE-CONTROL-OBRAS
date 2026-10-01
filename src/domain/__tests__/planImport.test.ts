import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
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

describe("parsePlanGrid — obras con bloques y códigos repetidos", () => {
  // Mismo código "2.1" en dos bloques (A1 y A2): solo la ruta los distingue.
  const items = [
    { id: 10, code: "2.1", contrato: 200, path: "A1/ESTRUCTURA/2/2.1" },
    { id: 20, code: "2.1", contrato: 50, path: "A2/ESTRUCTURA/2/2.1" },
    { id: 30, code: "1.1.4", contrato: 1, path: "A1/1.1/1.1.4" },
  ];

  it("un código repetido entre bloques es ambiguo: pide la ruta", () => {
    const r = parsePlanGrid("Ítem\toct-26\n2.1\t10", items);
    expect(r.filas).toEqual([
      { fila: 2, codigo: "2.1", budgetItemId: null, fecha: "2026-10-31", cantidad: 10, error: "Código repetido en varios bloques: usá la ruta del ítem (columna Ruta)" },
    ]);
  });

  it("la ruta resuelve cada bloque (sin importar mayúsculas) y la columna Ruta no es un período", () => {
    const r = parsePlanGrid("Ruta\toct-26\tnov-26\nA1/ESTRUCTURA/2/2.1\t10\t\na2/estructura/2/2.1\t\t5", items);
    expect(r.errores).toEqual([]);
    expect(r.periodos).toEqual(["2026-10-31", "2026-11-30"]);
    expect(r.filas.map((f) => [f.budgetItemId, f.fecha, f.cantidad, f.error])).toEqual([
      [10, "2026-10-31", 10, undefined],
      [20, "2026-11-30", 5, undefined],
    ]);
  });

  it("un código único sigue sirviendo sin ruta", () => {
    const r = parsePlanGrid("Ítem\toct-26\n1.1.4\t1", items);
    expect(r.filas[0]).toMatchObject({ budgetItemId: 30, cantidad: 1 });
    expect(r.filas[0].error).toBeUndefined();
  });

  it("% con coma decimal sobre la cantidad del contrato de cada bloque", () => {
    const r = parsePlanGrid("Ruta\toct-26\nA1/ESTRUCTURA/2/2.1\t4,2%\nA2/ESTRUCTURA/2/2.1\t50,0%", items);
    expect(r.filas.map((f) => f.cantidad)).toEqual([8.4, 25]);
  });

  it("cantidad 0 se lee como 0 (sirve para borrar ese período al COMBINAR) y la celda vacía se ignora", () => {
    const r = parsePlanGrid("Ruta\toct-26\tnov-26\tdic-26\nA1/1.1/1.1.4\t0\t\t0%", items);
    expect(r.filas.map((f) => [f.fecha, f.cantidad, f.error])).toEqual([
      ["2026-10-31", 0, undefined],
      ["2026-12-31", 0, undefined],
    ]);
  });

  it("marca valores no numéricos y negativos", () => {
    const r = parsePlanGrid("Ruta\toct-26\tnov-26\nA1/1.1/1.1.4\tabc\t-2", items);
    expect(r.filas.map((f) => f.error)).toEqual(['Valor "abc" no es un número', "Cantidad negativa"]);
  });

  it("acepta ; como separador y \r\n de Windows", () => {
    const r = parsePlanGrid("Ruta;oct-26\r\nA1/1.1/1.1.4;1\r\n", items);
    expect(r.filas).toEqual([{ fila: 2, codigo: "A1/1.1/1.1.4", budgetItemId: 30, fecha: "2026-10-31", cantidad: 1 }]);
  });
});

describe("parsePlanGrid — docs/cronograma_ficticio_24_meses.txt", () => {
  it("lee 24 períodos y 5087 valores sin errores", () => {
    const texto = fs.readFileSync(path.resolve(__dirname, "../../../docs/cronograma_ficticio_24_meses.txt"), "utf8");
    const rutas = texto.split("\n").slice(1).map((l) => l.split("\t")[0].trim()).filter(Boolean);
    const items = rutas.map((p, i) => ({ id: i + 1, code: p.split("/").pop()!, contrato: 100, path: p }));
    const r = parsePlanGrid(texto, items);
    expect(r.periodos).toHaveLength(24);
    expect(r.periodos[0]).toBe("2026-10-31");
    expect(r.periodos[23]).toBe("2028-09-30");
    expect(r.errores).toEqual([]);
    expect(r.filas.filter((f) => f.error)).toEqual([]);
    expect(r.filas).toHaveLength(5087);
  });
});
