import { cleanText, ExtractedSheetMatrix, getColumnLetter, parseFlexibleNumber } from "./matrixExtractor";
import { CanonicalColumnRole, ColumnDetection, NumberFormat, SheetStructure } from "./types";

type Role = Exclude<CanonicalColumnRole, "ignore">;
const ROLES: Role[] = ["code", "description", "unit", "quantity", "unitPrice", "totalPrice"];

const ROLE_KEYWORDS: Record<Role, string[]> = {
  code: ["item", "ítem", "items", "ítems", "n", "n°", "nro", "numero", "número", "cod", "codigo", "código",
    "pos", "posicion", "partida", "clave", "subitem", "cve", "id", "orden"],
  description: ["descripcion", "descripción", "detalle", "concepto", "rubro", "rubros", "designacion",
    "designación", "designacion de los trabajos", "trabajos", "especificacion", "especificaciones", "objeto",
    "tarea", "actividad", "denominacion", "denominación", "nombre", "descripcion de los trabajos"],
  unit: ["unidad", "unid", "und", "um", "u m", "ud", "un", "u", "medida", "u med", "u medida", "unidad de medida"],
  quantity: ["cantidad", "cant", "metrado", "metrados", "computo", "cómputo", "computo metrico", "cómputo métrico",
    "volumen", "vol", "cant contratada", "cantidad contratada", "cantidad total"],
  unitPrice: ["precio unitario", "p u", "pu", "p unitario", "p unit", "costo unitario", "precio unit",
    "p u gs", "pu gs", "p u usd", "pu usd", "precio", "tarifa", "valor unitario", "unitario"],
  totalPrice: ["precio total", "monto total", "costo total", "importe total", "total", "importe", "total gs",
    "total usd", "subtotal", "parcial", "monto", "valor total", "precio parcial"],
};

const SUMMARY_SHEET = /resumen|summary|car[aá]tula|portada|indice|índice|planilla\s+resumen/i;

function normalizeHeader(str: unknown): string {
  return cleanText(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.:°º№#()\[\]/\\_\-$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_KEYWORDS: Record<Role, string[]> = Object.fromEntries(
  ROLES.map((role) => [role, ROLE_KEYWORDS[role].map(normalizeHeader)])
) as Record<Role, string[]>;

/** Afinidad 0..1 de un texto de encabezado con un rol (coincidencia por palabra completa). */
export function matchRoleKeyword(header: string, role: Role): number {
  if (!header) return 0;
  let best = 0;
  for (const kw of NORMALIZED_KEYWORDS[role]) {
    if (!kw) continue;
    if (header === kw) return 1;
    if (header.startsWith(kw + " ")) best = Math.max(best, 0.9);
    else if (header.endsWith(" " + kw)) best = Math.max(best, 0.7);
    else if ((" " + header + " ").includes(" " + kw + " ")) best = Math.max(best, 0.6);
  }
  return best;
}

function rowHeaderScore(row: any[] | undefined): { score: number; roles: Set<Role> } {
  const roles = new Set<Role>();
  let score = 0;
  if (!Array.isArray(row)) return { score, roles };
  for (const cell of row) {
    const h = normalizeHeader(cell);
    if (!h || h.length > 60) continue;
    let bestRole: Role | null = null;
    let bestScore = 0;
    for (const role of ROLES) {
      const s = matchRoleKeyword(h, role);
      if (s > bestScore) {
        bestScore = s;
        bestRole = role;
      }
    }
    if (bestRole && bestScore >= 0.6 && !roles.has(bestRole)) {
      roles.add(bestRole);
      score += bestScore * (bestRole === "description" ? 3 : 2);
    }
  }
  return { score, roles };
}

function rowHasNumbers(row: any[] | undefined, format: NumberFormat) {
  if (!Array.isArray(row)) return false;
  return row.filter((c) => parseFlexibleNumber(c, format) !== null).length >= 2;
}

/** Encuentra la fila de encabezados evaluando las primeras 60 filas. */
export function detectHeaderRow(matrix: any[][], format: NumberFormat = "PY"): number {
  let bestRow = 0;
  let bestScore = -1;
  const limit = Math.min(60, matrix.length);
  for (let r = 0; r < limit; r++) {
    const { score, roles } = rowHeaderScore(matrix[r]);
    if (roles.size < 2) continue;
    let total = score;
    if (roles.has("description")) total += 4;
    if (roles.has("quantity") || roles.has("unitPrice") || roles.has("totalPrice")) total += 2;
    for (let k = 1; k <= 3; k++) {
      if (rowHasNumbers(matrix[r + k], format)) {
        total += 2;
        break;
      }
    }
    if (total > bestScore) {
      bestScore = total;
      bestRow = r;
    }
  }
  return bestRow;
}

/** Texto de encabezado por columna, con celdas combinadas propagadas en horizontal. */
function headerTexts(sheet: ExtractedSheetMatrix, rowIdx: number): string[] {
  const row = sheet.matrix[rowIdx] || [];
  const texts = Array.from({ length: sheet.maxCols }, (_, c) => cleanText(row[c]));
  for (const m of sheet.merges) {
    if (rowIdx < m.s.r || rowIdx > m.e.r) continue;
    const origin = cleanText(sheet.matrix[m.s.r]?.[m.s.c]);
    if (!origin) continue;
    for (let c = m.s.c; c <= m.e.c && c < texts.length; c++) {
      if (!texts[c]) texts[c] = origin;
    }
  }
  return texts;
}

function inspectColumn(matrix: any[][], startRow: number, col: number, format: NumberFormat) {
  let numeric = 0;
  let populated = 0;
  let textLen = 0;
  const samples: string[] = [];
  const end = Math.min(matrix.length, startRow + 40);
  for (let r = startRow; r < end; r++) {
    const val = matrix[r]?.[col];
    const text = cleanText(val);
    if (!text) continue;
    populated++;
    textLen += text.length;
    if (samples.length < 5) samples.push(text);
    if (parseFlexibleNumber(val, format) !== null) numeric++;
  }
  return {
    numericRatio: populated ? numeric / populated : 0,
    avgTextLength: populated ? textLen / populated : 0,
    fillRatio: end > startRow ? populated / (end - startRow) : 0,
    samples,
  };
}

/** Analiza una hoja y genera el mapeo de columnas a roles. */
export function analyzeSheetStructure(
  sheet: ExtractedSheetMatrix,
  format: NumberFormat,
  preferredHeaderRow?: number,
  manualMapping?: Record<number, CanonicalColumnRole>
): SheetStructure {
  const matrix = sheet.matrix;
  let headerRowIndex = preferredHeaderRow ?? detectHeaderRow(matrix, format);
  let headerRowCount = 1;

  // Encabezado en dos filas: "PRECIO" arriba y "UNITARIO | TOTAL" abajo (o al revés).
  const current = rowHeaderScore(matrix[headerRowIndex]);
  const below = rowHeaderScore(matrix[headerRowIndex + 1]);
  const above = headerRowIndex > 0 ? rowHeaderScore(matrix[headerRowIndex - 1]) : { score: 0, roles: new Set() };
  let texts = headerTexts(sheet, headerRowIndex);
  // Una sola coincidencia abajo solo cuenta si hay un título combinado en horizontal
  // (ej. "PRECIO" sobre dos columnas); así un rubro como "TRABAJOS PRELIMINARES" no se toma
  // por segunda fila de encabezado.
  const spansColumns = (r: number) => sheet.merges.some((m) => m.s.r <= r && m.e.r >= r && m.e.c > m.s.c);
  const isSecondHeader = (info: { roles: Set<unknown> }, mergedRow: number) =>
    info.roles.size >= 2 || (info.roles.size >= 1 && spansColumns(mergedRow));
  if (isSecondHeader(below, headerRowIndex) && !rowHasNumbers(matrix[headerRowIndex + 1], format)) {
    const lower = headerTexts(sheet, headerRowIndex + 1);
    texts = texts.map((t, c) => cleanText(`${t} ${lower[c] ?? ""}`));
    headerRowIndex += 1;
    headerRowCount = 2;
  } else if (
    preferredHeaderRow === undefined &&
    current.roles.size >= 1 &&
    isSecondHeader(above, headerRowIndex - 1)
  ) {
    const upper = headerTexts(sheet, headerRowIndex - 1);
    texts = texts.map((t, c) => cleanText(`${upper[c] ?? ""} ${t}`));
    headerRowCount = 2;
  }

  const dataStart = headerRowIndex + 1;
  const hiddenCols = new Set(sheet.hiddenCols);

  const candidates = texts.map((raw, c) => {
    const normalized = normalizeHeader(raw);
    const stats = inspectColumn(matrix, dataStart, c, format);
    const scores = Object.fromEntries(ROLES.map((role) => [role, matchRoleKeyword(normalized, role)])) as Record<
      Role,
      number
    >;

    if (stats.avgTextLength > 15 && stats.numericRatio < 0.2) {
      scores.description += 0.5;
      scores.quantity -= 1;
      scores.unitPrice -= 1;
      scores.totalPrice -= 1;
    }
    if (stats.numericRatio > 0.6) {
      scores.description -= 1;
      scores.unit -= 0.5;
    }
    if (stats.fillRatio === 0) {
      for (const role of ROLES) scores[role] -= 0.5;
    }
    if (hiddenCols.has(c)) {
      for (const role of ROLES) scores[role] -= 0.5;
    }
    return { c, raw, scores, stats };
  });

  // Asignación: pares (rol, columna) de mayor puntaje primero, sin repetir rol ni columna.
  const assignments = new Map<Role, number>();
  const usedCols = new Set<number>();
  const pairs = candidates
    .flatMap((cand) => ROLES.map((role) => ({ role, c: cand.c, score: cand.scores[role] })))
    .filter((p) => p.score >= 0.55)
    .sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (assignments.has(p.role) || usedCols.has(p.c)) continue;
    assignments.set(p.role, p.c);
    usedCols.add(p.c);
  }

  if (!assignments.has("description")) {
    const best = candidates
      .filter((cand) => !usedCols.has(cand.c) && cand.stats.numericRatio < 0.4)
      .sort((a, b) => b.stats.avgTextLength - a.stats.avgTextLength)[0];
    if (best && best.stats.avgTextLength > 0) {
      assignments.set("description", best.c);
      usedCols.add(best.c);
    }
  }

  if (manualMapping) {
    for (const [colStr, role] of Object.entries(manualMapping)) {
      const col = Number(colStr);
      for (const [r, c] of [...assignments.entries()]) {
        if (c === col || r === role) assignments.delete(r);
      }
      if (role !== "ignore") assignments.set(role as Role, col);
    }
  }

  const columns: ColumnDetection[] = candidates.map((cand) => {
    const role = ([...assignments.entries()].find(([, c]) => c === cand.c)?.[0] ?? "ignore") as CanonicalColumnRole;
    const confidence = role === "ignore" ? 0 : Math.min(1, Math.max(0.5, cand.scores[role as Role]));
    return {
      index: cand.c,
      letter: getColumnLetter(cand.c),
      originalHeader: cand.raw || `Columna ${getColumnLetter(cand.c)}`,
      detectedRole: role,
      confidence: Math.round(confidence * 100) / 100,
      sampleValues: cand.stats.samples,
    };
  });

  const previewRows: Record<CanonicalColumnRole, string>[] = [];
  for (let r = dataStart; r < Math.min(matrix.length, dataStart + 6); r++) {
    const entry = { code: "", description: "", unit: "", quantity: "", unitPrice: "", totalPrice: "", ignore: "" };
    for (const [role, c] of assignments) entry[role] = cleanText(matrix[r]?.[c]);
    previewRows.push(entry);
  }

  // Cantidad aproximada de filas que parecen ítems (para elegir la hoja principal).
  const qtyCol = assignments.get("quantity");
  const descCol = assignments.get("description");
  let detectedItemRows = 0;
  if (descCol !== undefined) {
    for (let r = dataStart; r < matrix.length; r++) {
      const hasDesc = cleanText(matrix[r]?.[descCol]).length > 2;
      const hasQty = qtyCol !== undefined && parseFlexibleNumber(matrix[r]?.[qtyCol], format) !== null;
      if (hasDesc && hasQty) detectedItemRows++;
    }
  }

  return {
    sheetName: sheet.sheetName,
    totalRows: matrix.length,
    totalCols: sheet.maxCols,
    headerRowIndex,
    headerRowCount,
    columns,
    previewRows,
    hiddenRowsCount: sheet.hiddenRows.length,
    formulasWithoutValue: sheet.formulasWithoutValue,
    likelySummary: SUMMARY_SHEET.test(sheet.sheetName),
    detectedItemRows,
  };
}

/** Rol → índice de columna a partir de la estructura analizada. */
export function roleColumns(structure: SheetStructure): Partial<Record<Role, number>> {
  const map: Partial<Record<Role, number>> = {};
  for (const col of structure.columns) {
    if (col.detectedRole !== "ignore") map[col.detectedRole] = col.index;
  }
  return map;
}
