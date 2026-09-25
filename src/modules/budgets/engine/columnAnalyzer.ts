import { cleanText, getColumnLetter, parseFlexibleNumber } from "./matrixExtractor";
import { CanonicalColumnRole, ColumnDetection, SheetStructure } from "./types";

const ROLE_KEYWORDS: Record<CanonicalColumnRole, string[]> = {
  code: [
    "item",
    "ítem",
    "items",
    "ítems",
    "n",
    "n°",
    "nro",
    "nro.",
    "numero",
    "número",
    "cod",
    "cod.",
    "codigo",
    "código",
    "pos",
    "pos.",
    "posicion",
    "posic",
    "partida",
    "clave",
    "subitem",
    "cve",
    "id",
  ],
  description: [
    "descripcion",
    "descripción",
    "detalle",
    "concepto",
    "rubro",
    "designacion",
    "designación",
    "trabajos",
    "designacion de los trabajos",
    "especificacion",
    "especificaciones",
    "objeto",
    "tarea",
    "actividad",
    "denominacion",
    "denominación",
    "item descripcion",
    "nombre",
  ],
  unit: [
    "unidad",
    "unid",
    "unid.",
    "und",
    "und.",
    "um",
    "u.m.",
    "u m",
    "ud",
    "ud.",
    "un",
    "un.",
    "u",
    "medida",
    "u.med.",
    "u.medida",
  ],
  quantity: [
    "cantidad",
    "cant",
    "cant.",
    "metrado",
    "metrados",
    "computo",
    "cómputo",
    "computo metrico",
    "cómputo métrico",
    "volumen",
    "vol.",
    "cant. contratada",
    "cant contratada",
  ],
  unitPrice: [
    "precio unitario",
    "p.u.",
    "pu",
    "p.unitario",
    "p unitario",
    "p.unit",
    "p unit",
    "costo unitario",
    "precio unit",
    "p.u. (gs.)",
    "pu gs",
    "p.u. ($)",
    "pu usd",
    "precio",
    "tarifa",
    "valor unitario",
  ],
  totalPrice: [
    "precio total",
    "monto total",
    "costo total",
    "importe total",
    "total",
    "importe",
    "total (gs.)",
    "total gs",
    "total (usd)",
    "subtotal",
    "parcial",
    "monto",
    "valor total",
  ],
  ignore: [],
};

/**
 * Normaliza un texto de encabezado para comparación con diccionario de sinónimos
 */
function normalizeHeaderString(str: unknown): string {
  return cleanText(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.:°№#()\[\]/\\_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcula afinidad de una celda con un rol canónico
 */
function matchRoleKeyword(headerText: string, role: CanonicalColumnRole): number {
  if (role === "ignore") return 0;
  const keywords = ROLE_KEYWORDS[role];

  for (const kw of keywords) {
    const normKw = normalizeHeaderString(kw);
    if (headerText === normKw) return 1.0;
    if (headerText.startsWith(normKw + " ") || headerText.endsWith(" " + normKw)) return 0.9;
    if (headerText.includes(normKw)) return 0.75;
  }
  return 0;
}

/**
 * Inspecciona una muestra de filas de datos para verificar compatibilidad de tipo
 */
function inspectColumnSample(matrix: any[][], headerRowIndex: number, colIndex: number): {
  numericRatio: number;
  avgTextLength: number;
  sampleValues: string[];
} {
  let numericCount = 0;
  let textLengthSum = 0;
  let populatedCount = 0;
  const sampleValues: string[] = [];

  const maxScan = Math.min(matrix.length, headerRowIndex + 25);
  for (let r = headerRowIndex + 1; r < maxScan; r++) {
    const val = matrix[r]?.[colIndex];
    const text = cleanText(val);
    if (!text) continue;

    populatedCount++;
    textLengthSum += text.length;
    if (sampleValues.length < 5) sampleValues.push(text);

    const num = parseFlexibleNumber(val);
    if (num !== null) numericCount++;
  }

  return {
    numericRatio: populatedCount > 0 ? numericCount / populatedCount : 0,
    avgTextLength: populatedCount > 0 ? textLengthSum / populatedCount : 0,
    sampleValues,
  };
}

/**
 * Encuentra la mejor fila de encabezados evaluando las primeras 50 filas
 */
export function detectHeaderRow(matrix: any[][]): number {
  let bestRowIndex = 0;
  let bestScore = -1;

  const scanLimit = Math.min(50, matrix.length);
  for (let r = 0; r < scanLimit; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    let rowScore = 0;
    let textCellsCount = 0;
    let recognizedRolesCount = 0;
    const recognizedRoles = new Set<CanonicalColumnRole>();

    for (const cell of row) {
      const headerText = normalizeHeaderString(cell);
      if (!headerText || headerText.length < 2) continue;
      textCellsCount++;

      for (const role of ["code", "description", "unit", "quantity", "unitPrice", "totalPrice"] as CanonicalColumnRole[]) {
        const match = matchRoleKeyword(headerText, role);
        if (match > 0.5) {
          recognizedRoles.add(role);
          recognizedRolesCount++;
          rowScore += match * (role === "description" ? 3.0 : 2.0);
          break;
        }
      }
    }

    // Un encabezado válido típicamente tiene "description" o "code" o "quantity"
    if (recognizedRoles.has("description")) rowScore += 4;
    if (recognizedRoles.has("code")) rowScore += 2;
    if (recognizedRoles.has("quantity")) rowScore += 2;
    if (recognizedRoles.has("unitPrice") || recognizedRoles.has("totalPrice")) rowScore += 2;

    // Verificar que la siguiente fila contenga datos (no otro título idéntico)
    if (matrix[r + 1] && Array.isArray(matrix[r + 1])) {
      const nextRow = matrix[r + 1];
      const hasAnyNumeric = nextRow.some((c) => parseFlexibleNumber(c) !== null);
      if (hasAnyNumeric) rowScore += 2;
    }

    if (rowScore > bestScore && recognizedRolesCount >= 2) {
      bestScore = rowScore;
      bestRowIndex = r;
    }
  }

  return bestRowIndex;
}

/**
 * Analiza todas las columnas de una hoja y genera el mapeo canónico
 */
export function analyzeSheetStructure(
  matrix: any[][],
  sheetName: string,
  preferredHeaderRow?: number
): SheetStructure {
  const headerRowIndex = preferredHeaderRow !== undefined ? preferredHeaderRow : detectHeaderRow(matrix);
  const headerRow = matrix[headerRowIndex] || [];
  const maxCols = matrix.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);

  const columns: ColumnDetection[] = [];
  const roleAssignments = new Map<CanonicalColumnRole, number>();

  // Primer paso: Calcular scores de afinidad para cada columna
  const candidates: Array<{
    colIdx: number;
    letter: string;
    originalHeader: string;
    scores: Record<CanonicalColumnRole, number>;
    sampleValues: string[];
    numericRatio: number;
    avgTextLength: number;
  }> = [];

  for (let c = 0; c < maxCols; c++) {
    const rawHeader = cleanText(headerRow[c]);
    const normalized = normalizeHeaderString(rawHeader);
    const { numericRatio, avgTextLength, sampleValues } = inspectColumnSample(matrix, headerRowIndex, c);

    const scores: Record<CanonicalColumnRole, number> = {
      code: matchRoleKeyword(normalized, "code"),
      description: matchRoleKeyword(normalized, "description"),
      unit: matchRoleKeyword(normalized, "unit"),
      quantity: matchRoleKeyword(normalized, "quantity"),
      unitPrice: matchRoleKeyword(normalized, "unitPrice"),
      totalPrice: matchRoleKeyword(normalized, "totalPrice"),
      ignore: 0,
    };

    // Refuerzos y penalizaciones estadísticas
    // Si tiene alta densidad de texto largo y casi ningún número -> probable descripción
    if (avgTextLength > 12 && numericRatio < 0.2) {
      scores.description += 0.8;
      scores.quantity -= 1.0;
      scores.unitPrice -= 1.0;
      scores.totalPrice -= 1.0;
    }

    // Si tiene alta densidad numérica -> candidata para cantidad, PU o total
    if (numericRatio > 0.6) {
      scores.description -= 1.0;
      if (scores.quantity > 0) scores.quantity += 0.4;
      if (scores.unitPrice > 0) scores.unitPrice += 0.4;
      if (scores.totalPrice > 0) scores.totalPrice += 0.4;
    }

    // Columna de código: típicamente strings cortos (longitud < 10) o con puntos/números
    if (avgTextLength > 0 && avgTextLength <= 8 && numericRatio < 0.9) {
      if (scores.code > 0) scores.code += 0.5;
    }

    candidates.push({
      colIdx: c,
      letter: getColumnLetter(c),
      originalHeader: rawHeader || `Columna ${getColumnLetter(c)}`,
      scores,
      sampleValues,
      numericRatio,
      avgTextLength,
    });
  }

  // Segundo paso: Asignación determinística de roles únicos
  const availableRoles: CanonicalColumnRole[] = [
    "description",
    "quantity",
    "unitPrice",
    "totalPrice",
    "unit",
    "code",
  ];

  for (const role of availableRoles) {
    let bestColIdx = -1;
    let highestScore = 0.45; // Umbral mínimo de confianza

    for (const cand of candidates) {
      if ([...roleAssignments.values()].includes(cand.colIdx)) continue;
      const score = cand.scores[role];
      if (score > highestScore) {
        highestScore = score;
        bestColIdx = cand.colIdx;
      }
    }

    if (bestColIdx !== -1) {
      roleAssignments.set(role, bestColIdx);
    }
  }

  // Fallbacks inteligentes si faltó algún rol fundamental
  // Si no hay description: buscar la columna con mayor longitud de texto promedio
  if (!roleAssignments.has("description")) {
    let maxTextLen = 0;
    let bestTextCol = -1;
    for (const cand of candidates) {
      if ([...roleAssignments.values()].includes(cand.colIdx)) continue;
      if (cand.avgTextLength > maxTextLen && cand.numericRatio < 0.4) {
        maxTextLen = cand.avgTextLength;
        bestTextCol = cand.colIdx;
      }
    }
    if (bestTextCol !== -1) roleAssignments.set("description", bestTextCol);
  }

  // Si no hay código: si la primera columna está libre, sugerirla como código
  if (!roleAssignments.has("code")) {
    if (candidates[0] && ![...roleAssignments.values()].includes(0)) {
      roleAssignments.set("code", 0);
    }
  }

  // Construir array final de ColumnDetection
  for (const cand of candidates) {
    let detectedRole: CanonicalColumnRole = "ignore";
    let confidence = 0;

    for (const [role, colIdx] of roleAssignments.entries()) {
      if (colIdx === cand.colIdx) {
        detectedRole = role;
        confidence = Math.min(1.0, Math.max(0.5, cand.scores[role]));
        break;
      }
    }

    columns.push({
      index: cand.colIdx,
      letter: cand.letter,
      originalHeader: cand.originalHeader,
      detectedRole,
      confidence: Math.round(confidence * 100) / 100,
      sampleValues: cand.sampleValues,
    });
  }

  // Generar muestra de filas para preview
  const previewRows: Record<CanonicalColumnRole, string>[] = [];
  const previewLimit = Math.min(matrix.length, headerRowIndex + 6);
  for (let r = headerRowIndex + 1; r < previewLimit; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const entry: Record<CanonicalColumnRole, string> = {
      code: "",
      description: "",
      unit: "",
      quantity: "",
      unitPrice: "",
      totalPrice: "",
      ignore: "",
    };

    for (const [role, colIdx] of roleAssignments.entries()) {
      entry[role] = cleanText(row[colIdx]);
    }
    previewRows.push(entry);
  }

  return {
    sheetName,
    totalRows: matrix.length,
    totalCols: maxCols,
    headerRowIndex,
    columns,
    previewRows,
  };
}
