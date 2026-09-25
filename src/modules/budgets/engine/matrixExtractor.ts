import * as XLSX from "xlsx";

export interface ExtractedSheetMatrix {
  sheetName: string;
  matrix: any[][];
  maxRows: number;
  maxCols: number;
}

export interface ExtractedWorkbook {
  sheets: ExtractedSheetMatrix[];
  fileName?: string;
  sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS" | "PASTED_TEXT";
}

/**
 * Normaliza cualquier texto:
 * - Unicode NFKC
 * - Quita caracteres de control invisibles, non-breaking spaces (\u00a0), byte order marks
 * - Colapsa espacios redundantes
 */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Analiza y convierte de forma tolerante cualquier valor numérico en planillas de construcción:
 * - Monedas: Gs., PYG, USD, US$, $, €
 * - Números negativos entre paréntesis: (1.500) -> -1500
 * - Detección automática de separadores de miles y decimales
 */
export function parseFlexibleNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = cleanText(value);
  if (!text) return null;

  // Comprobar si explícitamente es "No cotiza" o guion
  if (/^(no\s*cotiza|s\/?c|sin\s*cotizar|-|--)$/i.test(text)) {
    return null;
  }

  const isNegative = /^\(.*\)$/.test(text) || /^-/.test(text);
  // Remover signos de moneda, letras, paréntesis y guiones
  let clean = text
    .replace(/[()]/g, "")
    .replace(/(?:Gs\.?|PYG|USD|US\$|\$|€)/gi, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/-/g, "")
    .trim();

  if (!clean || !/\d/.test(clean)) return null;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    // Tiene tanto coma como punto. El que esté más a la derecha es el separador decimal
    if (lastComma > lastDot) {
      // 1.500.000,50 -> miles punto, decimal coma
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,500,000.50 -> miles coma, decimal punto
      clean = clean.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const parts = clean.split(",");
    if (parts.length > 2) {
      // Múltiples comas -> separador de miles: 1,500,000
      clean = clean.replace(/,/g, "");
    } else if (parts[1]?.length === 3 && parts[0]?.length <= 3 && !clean.includes(".")) {
      // Exactamente 3 dígitos después de la coma y número chico antes: 1,500 -> 1500
      clean = clean.replace(/,/g, "");
    } else {
      // Decimal con coma: 150,50 -> 150.50
      clean = clean.replace(",", ".");
    }
  } else if (lastDot >= 0) {
    const parts = clean.split(".");
    if (parts.length > 2) {
      // Múltiples puntos -> separador de miles: 1.500.000
      clean = clean.replace(/\./g, "");
    } else if (parts[1]?.length === 3 && Number(parts[0]) > 0) {
      // Punto seguido de 3 dígitos (típico en guaraníes o miles latinos): 1.500 -> 1500
      clean = clean.replace(/\./g, "");
    }
  }

  const num = Number(clean);
  if (!Number.isFinite(num)) return null;
  return isNegative ? -num : num;
}

/**
 * Convierte un número de columna 0-indexed a letra de Excel (0 -> A, 1 -> B, 26 -> AA)
 */
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
 * Extrae todas las celdas de un Worksheet sin truncar por !ref corrupto
 */
export function worksheetToFullMatrix(ws: XLSX.WorkSheet): any[][] {
  let maxRow = 0;
  let maxCol = 0;

  // Primero escanear todas las llaves de celda para encontrar los verdaderos límites
  for (const key in ws) {
    if (key.startsWith("!")) continue;
    try {
      const cell = XLSX.utils.decode_cell(key);
      if (cell.r > maxRow) maxRow = cell.r;
      if (cell.c > maxCol) maxCol = cell.c;
    } catch {}
  }

  // Si !ref existe, tomar el mayor
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
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      const cellObj = ws[cellAddress];
      let val: any = "";
      if (cellObj) {
        // Si la celda es resultado de fórmula, preferir .v evaluado
        if (cellObj.v !== undefined && cellObj.v !== null) {
          val = cellObj.v;
        } else if (cellObj.w !== undefined) {
          val = cellObj.w;
        }
      }
      row.push(val);
    }
    matrix.push(row);
  }

  return matrix;
}

/**
 * Extrae un libro completo desde Buffer (XLSX, XLS, CSV)
 */
export function extractFromBuffer(buffer: Buffer, originalName?: string): ExtractedWorkbook {
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const sheets: ExtractedSheetMatrix[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = worksheetToFullMatrix(ws);
    if (matrix.length === 0) continue;

    const maxCols = matrix.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);

    sheets.push({
      sheetName,
      matrix,
      maxRows: matrix.length,
      maxCols,
    });
  }

  return {
    sheets,
    fileName: originalName || "presupuesto.xlsx",
    sourceType: originalName?.endsWith(".csv") ? "CSV" : "EXCEL",
  };
}

/**
 * Extrae matriz desde texto pegado (TSV de Excel o Google Sheets, o CSV)
 */
export function extractFromPastedText(text: string, sheetName: string = "Hoja Pegada"): ExtractedWorkbook {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error("El texto pegado está vacío");
  }

  // Detectar delimitador común: Tab (Excel/GSheets copy) o Coma o Punto y coma
  const firstLine = lines[0];
  let delimiter = "\t";
  if (firstLine.includes("\t")) {
    delimiter = "\t";
  } else if (firstLine.includes(";")) {
    delimiter = ";";
  } else if (firstLine.includes(",")) {
    delimiter = ",";
  }

  const matrix = lines.map((line) => line.split(delimiter).map(cleanText));
  const maxCols = matrix.reduce((acc, row) => Math.max(acc, row.length), 0);

  return {
    sheets: [
      {
        sheetName,
        matrix,
        maxRows: matrix.length,
        maxCols,
      },
    ],
    fileName: "Portapapeles_Pegado",
    sourceType: "PASTED_TEXT",
  };
}

/**
 * Normaliza una URL de Google Sheets a su URL de exportación XLSX o CSV
 */
export function buildGoogleSheetsExportUrl(rawUrl: string): { url: string; format: "xlsx" | "csv" } {
  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match || !match[1]) {
    throw new Error("URL de Google Sheets inválida. Debe tener el formato: https://docs.google.com/spreadsheets/d/{ID}/edit");
  }

  const docId = match[1];
  const gidMatch = rawUrl.match(/[#&?]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  // Intentar descargar formato XLSX para conservar nombres de hojas y múltiples hojas
  const exportUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=xlsx&id=${docId}`;
  return { url: exportUrl, format: "xlsx" };
}
