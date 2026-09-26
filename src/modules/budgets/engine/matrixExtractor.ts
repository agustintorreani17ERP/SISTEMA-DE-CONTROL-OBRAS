import * as XLSX from "xlsx";
import type { NumberFormat } from "./types";

export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface ExtractedSheetMatrix {
  sheetName: string;
  matrix: any[][];
  maxRows: number;
  maxCols: number;
  merges: MergeRange[];
  hiddenRows: number[]; // 0-indexed
  hiddenCols: number[]; // 0-indexed
  formulasWithoutValue: number;
}

export interface ExtractedWorkbook {
  sheets: ExtractedSheetMatrix[];
  fileName?: string;
  sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS" | "PASTED_TEXT";
}

/**
 * Normaliza cualquier texto: Unicode NFKC, sin caracteres de control ni espacios duros,
 * con espacios colapsados.
 */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value)
    .normalize("NFKC")
    .replace(/ /g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‍﻿]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const NO_COTIZA = /^(no\s*cotiza|s\/?c|sin\s*cotizar|-{1,2})$/i;

export function isNoCotiza(value: unknown): boolean {
  return NO_COTIZA.test(cleanText(value));
}

/**
 * Convierte un valor de planilla a número respetando el formato numérico elegido.
 * Las celdas numéricas nativas de Excel se devuelven tal cual.
 * - Monedas (Gs., PYG, USD, US$, $, €) y porcentajes se limpian.
 * - Negativos entre paréntesis: (1.500) → -1500.
 */
export function parseFlexibleNumber(value: unknown, format: NumberFormat = "PY"): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = cleanText(value);
  if (!text || NO_COTIZA.test(text)) return null;

  const withoutCurrency = text.replace(/(?:Gs\.?|PYG|USD|US\$|\$|€|%)/gi, "");
  // Solo dígitos, separadores y signos: "12,5 m3", "Bloque 3" o "H-21" no son números.
  if (/[^\d\s.,()+-]/.test(withoutCurrency)) return null;

  const isNegative = /^\(.*\)$/.test(text) || /^-\s*\d/.test(text);
  let clean = withoutCurrency.replace(/[^\d,.]/g, "");
  if (!clean || !/\d/.test(clean)) return null;

  const commas = (clean.match(/,/g) || []).length;
  const dots = (clean.match(/\./g) || []).length;

  if (format === "PY") {
    if (commas > 1) {
      clean = clean.replace(/,/g, ""); // 1,500,000 escrito al revés: tratar como miles
    } else if (commas === 1) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else if (dots > 1) {
      clean = clean.replace(/\./g, "");
    } else if (dots === 1 && /^\d{1,3}\.\d{3}$/.test(clean)) {
      clean = clean.replace(".", ""); // 1.500 → 1500
    }
  } else {
    if (dots > 1) {
      clean = clean.replace(/\./g, "");
      if (commas === 1) clean = clean.replace(",", ".");
    } else if (commas >= 1 && dots === 1) {
      clean = clean.replace(/,/g, "");
    } else if (commas === 1 && /,\d{1,2}$/.test(clean)) {
      clean = clean.replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  }

  const num = Number(clean);
  if (!Number.isFinite(num)) return null;
  return isNegative ? -num : num;
}

/**
 * Detecta el formato numérico mirando los números escritos como texto.
 * Por defecto PY (Paraguay). Las celdas numéricas nativas no aportan evidencia.
 */
export function detectNumberFormat(sheets: ExtractedSheetMatrix[]): NumberFormat {
  let py = 0;
  let en = 0;
  for (const sheet of sheets) {
    for (const row of sheet.matrix) {
      for (const cell of row) {
        if (typeof cell !== "string") continue;
        const t = cleanText(cell).replace(/(?:Gs\.?|PYG|USD|US\$|\$|€)/gi, "").trim();
        if (!/^-?\(?[\d.,]+\)?$/.test(t)) continue;
        if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) py++;
        else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^\d+\.\d{1,2}$/.test(t)) en++;
      }
    }
  }
  return en > py ? "EN" : "PY";
}

/** Convierte un número de columna 0-indexed a letra de Excel (0 → A, 26 → AA). */
export function getColumnLetter(colIndex: number): string {
  let letter = "";
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Extrae todas las celdas de una hoja sin truncar por un !ref corrupto.
 * Las celdas combinadas verticalmente propagan su valor hacia abajo (en su columna de origen);
 * la propagación horizontal solo se aplica al encabezado (ver columnAnalyzer).
 */
export function worksheetToSheetMatrix(ws: XLSX.WorkSheet, sheetName: string): ExtractedSheetMatrix {
  let maxRow = -1;
  let maxCol = -1;
  let formulasWithoutValue = 0;

  for (const key in ws) {
    if (key.startsWith("!")) continue;
    try {
      const cell = XLSX.utils.decode_cell(key);
      if (cell.r > maxRow) maxRow = cell.r;
      if (cell.c > maxCol) maxCol = cell.c;
    } catch {}
  }
  if (ws["!ref"]) {
    try {
      const decoded = XLSX.utils.decode_range(ws["!ref"]);
      maxRow = Math.max(maxRow, decoded.e.r);
      maxCol = Math.max(maxCol, decoded.e.c);
    } catch {}
  }

  const matrix: any[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: any[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cellObj = ws[XLSX.utils.encode_cell({ r, c })];
      let val: any = "";
      if (cellObj) {
        if (cellObj.v !== undefined && cellObj.v !== null) {
          val = cellObj.v;
        } else if (cellObj.w !== undefined) {
          val = cellObj.w;
        } else if (cellObj.f) {
          formulasWithoutValue++;
        }
      }
      row.push(val);
    }
    matrix.push(row);
  }

  const merges: MergeRange[] = (ws["!merges"] || []).map((m) => ({ s: { ...m.s }, e: { ...m.e } }));
  for (const m of merges) {
    if (m.e.r <= m.s.r) continue;
    const origin = matrix[m.s.r]?.[m.s.c];
    if (origin === "" || origin === undefined) continue;
    for (let r = m.s.r + 1; r <= m.e.r && r < matrix.length; r++) {
      if (matrix[r][m.s.c] === "" || matrix[r][m.s.c] === undefined) matrix[r][m.s.c] = origin;
    }
  }

  const hiddenRows: number[] = [];
  (ws["!rows"] || []).forEach((info, idx) => {
    if (info?.hidden) hiddenRows.push(idx);
  });
  const hiddenCols: number[] = [];
  (ws["!cols"] || []).forEach((info, idx) => {
    if (info?.hidden) hiddenCols.push(idx);
  });

  return {
    sheetName,
    matrix,
    maxRows: matrix.length,
    maxCols: maxCol + 1,
    merges,
    hiddenRows,
    hiddenCols,
    formulasWithoutValue,
  };
}

/** Extrae un libro completo desde Buffer (XLSX, XLS, CSV). */
export function extractFromBuffer(buffer: Buffer, originalName?: string): ExtractedWorkbook {
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellStyles: true, // necesario para leer filas/columnas ocultas
    raw: false,
  });

  const sheets: ExtractedSheetMatrix[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const sheet = worksheetToSheetMatrix(ws, sheetName);
    if (sheet.matrix.length === 0) continue;
    sheets.push(sheet);
  }

  return {
    sheets,
    fileName: originalName || "presupuesto.xlsx",
    sourceType: originalName?.toLowerCase().endsWith(".csv") ? "CSV" : "EXCEL",
  };
}

/** Extrae una matriz desde texto pegado (TSV copiado de Excel/Google Sheets, o CSV). */
export function extractFromPastedText(text: string, sheetName: string = "Hoja Pegada"): ExtractedWorkbook {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("El texto pegado está vacío");
  }

  const firstLine = lines[0];
  let delimiter = "\t";
  if (!firstLine.includes("\t")) {
    if (firstLine.includes(";")) delimiter = ";";
    else if (firstLine.includes(",")) delimiter = ",";
  }

  const matrix = lines.map((line) => line.split(delimiter).map(cleanText));
  const maxCols = matrix.reduce((acc, row) => Math.max(acc, row.length), 0);
  for (const row of matrix) while (row.length < maxCols) row.push("");

  return {
    sheets: [
      {
        sheetName,
        matrix,
        maxRows: matrix.length,
        maxCols,
        merges: [],
        hiddenRows: [],
        hiddenCols: [],
        formulasWithoutValue: 0,
      },
    ],
    fileName: "Portapapeles_Pegado",
    sourceType: "PASTED_TEXT",
  };
}

/** Normaliza una URL de Google Sheets a su URL de exportación XLSX. */
export function buildGoogleSheetsExportUrl(rawUrl: string): { url: string; format: "xlsx" } {
  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match || !match[1]) {
    throw new Error(
      "URL de Google Sheets inválida. Debe tener el formato: https://docs.google.com/spreadsheets/d/{ID}/edit"
    );
  }
  const docId = match[1];
  return { url: `https://docs.google.com/spreadsheets/d/${docId}/export?format=xlsx&id=${docId}`, format: "xlsx" };
}
