import * as XLSX from "xlsx";
import { cleanText, extractFromPastedText, parseFlexibleNumber } from "../budgets/engine/matrixExtractor";

/**
 * Lectura de listas de precios de mano de obra de contratistas (código, descripción, unidad,
 * precio y sector planta baja / alta). Se importan como insumos DIRECTO de mano de obra.
 */

export const MO_CODE_PREFIX = "MO-";
export const MO_CATEGORY_LABEL = "Mano de obra contratista";

/** `text` es lo que ve el usuario; `value` es el valor crudo (número nativo en xlsx). */
export interface MoCell {
  text: string;
  value: unknown;
}

export interface MoParsedRow {
  rowNumber: number;
  sourceCode: string;
  code: string;
  description: string;
  unit: string;
  price: number | null;
  sector: string | null;
  errors: string[];
  warnings: string[];
}

export interface MoParseResult {
  sheetName: string;
  rows: MoParsedRow[];
}

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Planilla → celdas. Los CSV se leen como texto para no perder "1.10" ni "8.000". */
export function readMoSheets(input: { buffer?: Buffer; fileName?: string; text?: string }): { name: string; cells: MoCell[][] }[] {
  const asText = (text: string, name: string) => {
    const wb = extractFromPastedText(text.replace(/^﻿/, ""), name);
    return wb.sheets.map((s) => ({ name: s.sheetName, cells: s.matrix.map((row) => row.map((v) => ({ text: String(v ?? ""), value: v }))) }));
  };

  if (input.text != null) return asText(input.text, "Texto pegado");
  if (!input.buffer) return [];
  const name = input.fileName || "lista.xlsx";
  if (/\.(csv|txt|tsv)$/i.test(name)) return asText(input.buffer.toString("utf8"), name);

  const wb = XLSX.read(input.buffer, { type: "buffer" });
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const ref = ws?.["!ref"];
    if (!ref) return { name: sheetName, cells: [] };
    const range = XLSX.utils.decode_range(ref);
    const cells: MoCell[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: MoCell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const value = cell?.v ?? "";
        row.push({ text: cleanText(cell?.w ?? value), value });
      }
      cells.push(row);
    }
    return { name: sheetName, cells };
  });
}

interface Columns {
  header: number;
  code: number;
  description: number;
  unit: number;
  price: number;
  sector: number | null;
}

function findColumns(cells: MoCell[][]): Columns | null {
  for (let r = 0; r < Math.min(cells.length, 40); r++) {
    const labels = cells[r].map((c) => norm(c.text));
    const at = (re: RegExp) => labels.findIndex((l) => re.test(l));
    const code = at(/^(item|codigo|cod\.?)$/);
    const description = at(/^descri/);
    const unit = at(/^(unidad|un\.?|und\.?|u\.?m\.?)$/);
    const price = at(/precio|^p\.?\s?u\.?$/);
    if (code >= 0 && description >= 0 && unit >= 0 && price >= 0) {
      const sector = at(/^(sector|planta|nivel)$/);
      return { header: r, code, description, unit, price, sector: sector >= 0 ? sector : null };
    }
  }
  return null;
}

export function normalizeSector(raw: string): string | null {
  const t = norm(raw);
  if (!t) return null;
  if (/planta\s*baja|^pb$/.test(t)) return "PLANTA_BAJA";
  if (/planta\s*alta|^pa$/.test(t)) return "PLANTA_ALTA";
  return t.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const SECTION_TITLE = /^(planta|nivel|sector|subsuelo|piso\s+\d|azotea)/;

function priceOf(cell: MoCell): number | null {
  if (typeof cell.value === "number") return Number.isFinite(cell.value) ? cell.value : null;
  return parseFlexibleNumber(cell.text, "PY");
}

export function parseMoSheet(name: string, cells: MoCell[][]): MoParseResult | null {
  const cols = findColumns(cells);
  if (!cols) return null;

  const rows: MoParsedRow[] = [];
  const seen = new Set<string>();
  let sector: string | null = null;
  let pendingDescription = "";

  for (let r = cols.header + 1; r < cells.length; r++) {
    const row = cells[r];
    const get = (i: number) => row[i] ?? { text: "", value: "" };
    const sourceCode = get(cols.code).text.trim();
    const description = get(cols.description).text.trim();
    const unit = get(cols.unit).text.trim();
    const priceText = get(cols.price).text.trim();
    if (!sourceCode && !description && !unit && !priceText) continue;

    if (!sourceCode && !unit && !priceText) {
      if (SECTION_TITLE.test(norm(description))) {
        sector = normalizeSector(description);
        pendingDescription = "";
      } else if (rows.length && rows[rows.length - 1].rowNumber === r) {
        // Texto partido en la fila siguiente al ítem (celda sin combinar al exportar).
        rows[rows.length - 1].description = `${rows[rows.length - 1].description} ${description}`.trim();
      } else {
        pendingDescription = `${pendingDescription} ${description}`.trim();
      }
      continue;
    }

    const price = priceOf(get(cols.price));
    const parsed: MoParsedRow = {
      rowNumber: r + 1,
      sourceCode,
      code: sourceCode ? `${MO_CODE_PREFIX}${sourceCode}` : "",
      description: `${pendingDescription} ${description}`.trim(),
      unit,
      price,
      sector: cols.sector !== null ? normalizeSector(get(cols.sector).text) ?? sector : sector,
      errors: [],
      warnings: [],
    };
    pendingDescription = "";

    if (!sourceCode) parsed.errors.push("Sin código");
    else if (seen.has(parsed.code)) parsed.errors.push("Código repetido en la planilla");
    if (!parsed.description) parsed.errors.push("Sin descripción");
    if (!unit) parsed.errors.push("Sin unidad");
    if (price === null) parsed.errors.push("Precio no numérico");
    else if (price < 0) parsed.errors.push("Precio negativo");
    else if (price === 0) parsed.warnings.push("Precio 0");
    if (!parsed.sector) parsed.warnings.push("Sin sector");

    if (sourceCode) seen.add(parsed.code);
    rows.push(parsed);
  }

  return { sheetName: name, rows };
}

/** Primera hoja que tenga encabezado reconocible. */
export function parseMoList(input: { buffer?: Buffer; fileName?: string; text?: string }): MoParseResult | null {
  for (const sheet of readMoSheets(input)) {
    const result = parseMoSheet(sheet.name, sheet.cells);
    if (result && result.rows.length) return result;
  }
  return null;
}
