import { readFileSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseMoList } from "../moImport";

const csvPath = join(__dirname, "../../../../docs/PRECIO_MANO_DE_OBRA.csv");

describe("importador de lista de MO", () => {
  const result = parseMoList({ buffer: readFileSync(csvPath), fileName: "PRECIO_MANO_DE_OBRA.csv" })!;
  const byCode = (code: string) => result.rows.find((r) => r.sourceCode === code)!;

  it("lee las 76 filas del PDF sin errores", () => {
    expect(result.rows).toHaveLength(76);
    expect(result.rows.filter((r) => r.errors.length)).toEqual([]);
  });

  it("asigna el sector por las filas de sección", () => {
    expect(result.rows.filter((r) => r.sector === "PLANTA_BAJA")).toHaveLength(51);
    expect(result.rows.filter((r) => r.sector === "PLANTA_ALTA")).toHaveLength(25);
  });

  it("interpreta precios en formato paraguayo y conserva códigos como texto", () => {
    expect(byCode("1.1").price).toBe(8000);
    expect(byCode("2.2").price).toBe(3675);
    expect(byCode("1.29").price).toBe(850000);
    expect(byCode("1.10").code).toBe("MO-1.10");
    expect(byCode("1.10").description).toBe("Envarillado de mampostería de 6mm a media altura");
  });

  it("advierte el precio 0 sin marcarlo como error", () => {
    expect(byCode("1.45").price).toBe(0);
    expect(byCode("1.45").warnings).toContain("Precio 0");
  });

  it("une descripciones partidas en dos filas", () => {
    const text = [
      "ITEM\tDESCRIPCION\tunidad\tPRECIO",
      "\tPlanta baja\t\t",
      "1.8\tDoble Mampostería de elevación de 0,15 de ladrillo visto ambas caras\tm2\t100.000",
      "\t(0,30)\t\t",
      "1.9\tMampostería común\tm2\t31.000",
    ].join("\n");
    const rows = parseMoList({ text })!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe("Doble Mampostería de elevación de 0,15 de ladrillo visto ambas caras (0,30)");
  });

  it("lee xlsx con códigos y precios numéricos", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ITEM", "DESCRIPCION", "unidad", "PRECIO UNITARIO", "Sector"],
      ["1.10", "Envarillado", "ml", 10000, "Planta alta"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MO");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const [row] = parseMoList({ buffer, fileName: "mo.xlsx" })!.rows;
    expect(row).toMatchObject({ code: "MO-1.10", price: 10000, sector: "PLANTA_ALTA", errors: [] });
  });

  it("marca filas inválidas", () => {
    const rows = parseMoList({ text: "ITEM;DESCRIPCION;unidad;PRECIO\n3.1;Algo;;abc\n3.1;Otro;m2;5.000" })!.rows;
    expect(rows[0].errors).toEqual(["Sin unidad", "Precio no numérico"]);
    expect(rows[1].errors).toEqual(["Código repetido en la planilla"]);
  });
});
