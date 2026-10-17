import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseMoList } from "../moImport";
import { laborRowsFromParsed, moInsumoCode, planInsumoPrice } from "../laborImport";

const csvPath = join(__dirname, "../../../../../docs/PRECIO_MANO_DE_OBRA.csv");

describe("importación de la lista de precios de MO de la obra", () => {
  const rows = laborRowsFromParsed(parseMoList({ buffer: readFileSync(csvPath), fileName: "PRECIO_MANO_DE_OBRA.csv" })!);
  const byCode = (code: string) => rows.find((r) => r.code === code)!;

  it("lee el catálogo completo sin pedir rubro del presupuesto", () => {
    expect(rows).toHaveLength(76);
    // Única fila que no entra: precio 0 (la lista exige precio > 0)
    expect(rows.filter((r) => r.errors.length).map((r) => [r.code, r.errors])).toEqual([["1.45", ["Precio 0"]]]);
    for (const r of rows) expect(r).not.toHaveProperty("budgetItemId");
  });

  it("conserva código, descripción, unidad, precio y sector", () => {
    expect(byCode("1.10")).toMatchObject({
      code: "1.10",
      description: "Envarillado de mampostería de 6mm a media altura",
      unit: "ml",
      unitPrice: 10000,
      sector: "PLANTA_BAJA",
    });
    expect(byCode("1.1")).toMatchObject({ unitPrice: 8000, sector: "PLANTA_BAJA" });
    expect(rows.filter((r) => r.sector === "PLANTA_BAJA")).toHaveLength(51);
    expect(rows.filter((r) => r.sector === "PLANTA_ALTA")).toHaveLength(25);
  });

  it("acepta celdas pegadas sin columna de rubro", () => {
    const pasted = ["ITEM\tDESCRIPCIÓN\tUNIDAD\tPRECIO", "\tPlanta alta\t\t", "1.1\tReplanteo\tm²\t8.000", "1.2\tExcavación\tm³\t0"].join("\n");
    const r = laborRowsFromParsed(parseMoList({ text: pasted })!);
    expect(r[0]).toMatchObject({ code: "1.1", unitPrice: 8000, sector: "PLANTA_ALTA", errors: [] });
    expect(r[1].errors).toEqual(["Precio 0"]);
  });
});

describe("insumo MO-<código> de la lista", () => {
  const hoy = new Date("2026-10-02T00:00:00Z");

  it("usa el prefijo del catálogo de insumos", () => {
    expect(moInsumoCode(" 1.10 ")).toBe("MO-1.10");
  });

  it("abre vigencia desde la fecha de importación solo si el precio cambia", () => {
    expect(planInsumoPrice([], 8000, hoy)).toBe("NUEVO_PRECIO");
    const prev = [{ validFrom: new Date("2026-01-01T00:00:00Z"), price: 8000 }];
    expect(planInsumoPrice(prev, 8000, hoy)).toBe("SIN_CAMBIO");
    expect(planInsumoPrice(prev, 9000, hoy)).toBe("NUEVO_PRECIO");
  });

  it("no pisa otro precio cargado con la misma fecha", () => {
    expect(planInsumoPrice([{ validFrom: hoy, price: 8000 }], 9000, hoy)).toBe("CONFLICTO_FECHA");
  });
});
