import { roleColumns } from "./columnAnalyzer";
import { cleanText, ExtractedSheetMatrix, isNoCotiza, parseFlexibleNumber } from "./matrixExtractor";
import { ImportRow, NumberFormat, RowKind, SheetStructure, ValidationIssue } from "./types";
import { normalizeUnit } from "./unitNormalizer";
import { AREA_PATTERN } from "./budgetTree";

/** Filas de total/subtotal: no se guardan, se usan para cuadrar. */
const SUBTOTAL_PATTERNS = [
  /^sub\s*-?\s*totales?\b/i,
  /^total(es)?\b/i,
  /^(monto|suma|gran|importe|costo)\s+total\b/i,
  /^(total|resumen)\s+(general|de\s+rubros?|del?\s+presupuesto)/i,
];
const GRAND_TOTAL =
  /(total\s+(general|de\s+(la\s+)?obra|del\s+presupuesto|del\s+contrato|final|a\s+pagar|con\s+iva|obra)|gran\s+total|^total(es)?$|^monto\s+total$|^importe\s+total$)/i;

/** Recargos que se aplican sobre la suma de ítems. */
const SURCHARGE =
  /^(i\.?\s?v\.?\s?a\.?\b|impuesto|gastos\s+generales|g\.?\s?g\.?\s*(y|&)|beneficio|utilidad|imprevistos|coeficiente|coef\.?\s+de\s+pase|honorarios|costo\s+financiero|seguros?\s+y\s+fianzas)/i;

/** Notas y pies de página que no son parte del presupuesto. */
const NOTE =
  /^(nota|notas|obs|observaci[oó]n|observaciones|firma|firmas|son:?|son\s+guaran|elaborado|revisado|aprobado|autorizado|lugar\s+y\s+fecha|validez|plazo|condiciones|forma\s+de\s+pago)\b/i;

const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/i;

export function isSubtotalText(description: string): boolean {
  const d = cleanText(description);
  return SUBTOTAL_PATTERNS.some((p) => p.test(d));
}

function codeSegments(code: string): string[] {
  const c = cleanText(code).replace(/\.$/, "");
  if (!c || !/^[A-Za-z0-9]+([.\-][A-Za-z0-9]+)*$/.test(c)) return [];
  return c.split(/[.\-]/);
}

function codeType(seg: string): "num" | "roman" | "alpha" {
  if (/^\d+$/.test(seg)) return "num";
  if (ROMAN.test(seg)) return "roman";
  return "alpha";
}

function normCode(code: string) {
  return codeSegments(code)
    .map((s) => s.replace(/^0+(?=\d)/, "").toUpperCase())
    .join(".");
}

function percentFrom(description: string, cells: unknown[], format: NumberFormat): number | null {
  const m = cleanText(description).match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (m) return Number(m[1].replace(",", "."));
  for (const cell of cells) {
    const text = cleanText(cell);
    if (text.endsWith("%")) {
      const n = parseFlexibleNumber(text, format);
      if (n !== null) return n;
    }
    if (typeof cell === "number" && cell > 0 && cell < 1) return Math.round(cell * 10000) / 100;
  }
  return null;
}

/**
 * Tipos de título en la pila de contexto:
 * - AREA: "Área: 3) BLOQUE 11…" — nivel 0, reinicia todo.
 * - BLOCK: título sin código numérico ("ESTRUCTURA DE HORMIGÓN ARMADO", "Rociadores").
 *   Define el alcance: la numeración de capítulos se busca solo dentro del bloque.
 * - CHAPTER: título con código (1, 2.1, A, II…).
 * - LABEL: etiqueta con punto bajo un capítulo ("B.N." = bloques nuevos, "B.E.").
 * - SUBTITLE: título sin código dentro de un capítulo o etiqueta ("PUERTAS", "VENTANAS").
 */
type HeadingType = "AREA" | "BLOCK" | "CHAPTER" | "LABEL" | "SUBTITLE";

interface StackEntry {
  level: number;
  code: string;
  segs: string[];
  type: HeadingType;
}

/** "B.N.", "B.E.", "B.N.2": etiquetas de agrupación, no numeración jerárquica. */
const LABEL_CODE = /^[A-Za-z]{1,3}(\.[A-Za-z0-9]+)+\.?$|^[A-Za-z]{1,3}\.$/;

function isLabelCode(code: string) {
  return LABEL_CODE.test(code) && /[A-Za-z]\./.test(code);
}

/** Texto en la columna de código que en realidad es un título ("PLANTA DE CONJUNTO", "Rociadores"). */
function looksLikeTitle(code: string) {
  if (!code || isLabelCode(code) || ROMAN.test(code)) return false;
  // Una palabra de 4+ letras ("Rociadores") o varias palabras ("PLANTA DE CONJUNTO")
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(code) || /\s/.test(code);
}

/**
 * Lee las filas de datos de una hoja y asigna tipo (rubro, ítem, subtotal, recargo…) y nivel.
 * El nivel define el árbol: el padre de una fila es el título anterior más cercano con nivel − 1.
 */
export function classifySheetRows(
  sheet: ExtractedSheetMatrix,
  structure: SheetStructure,
  format: NumberFormat,
  options: { includeHidden: boolean; levelOffset?: number }
): { rows: ImportRow[]; issues: ValidationIssue[] } {
  const cols = roleColumns(structure);
  const rows: ImportRow[] = [];
  const issues: ValidationIssue[] = [];
  const hidden = new Set(sheet.hiddenRows);
  const offset = options.levelOffset ?? 0;
  const roleCols = new Set(Object.values(cols));

  const stack: StackEntry[] = [];
  let lastWasHeading = false;
  let lastHeading: StackEntry | undefined;
  const knownBlocks = new Set<string>();
  let afterGrandTotal = false;

  /** Índice del área o bloque más profundo abierto: los capítulos se buscan después de él. */
  const scopeIndex = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === "AREA" || stack[i].type === "BLOCK") return i;
    }
    return -1;
  };
  const inScope = () => stack.slice(scopeIndex() + 1);
  const anchor = () => (scopeIndex() >= 0 ? stack[scopeIndex()] : undefined);

  for (let r = structure.headerRowIndex + 1; r < sheet.matrix.length; r++) {
    const raw = sheet.matrix[r];
    if (!Array.isArray(raw)) continue;
    const cell = (c?: number) => (c === undefined ? "" : raw[c]);

    let code = cleanText(cell(cols.code));
    let description = cleanText(cell(cols.description));
    const unitRaw = cleanText(cell(cols.unit));
    const qtyCell = cell(cols.quantity);
    const puCell = cell(cols.unitPrice);
    const totalCell = cell(cols.totalPrice);
    const quantity = parseFlexibleNumber(qtyCell, format);
    const unitPrice = parseFlexibleNumber(puCell, format);
    const totalPrice = parseFlexibleNumber(totalCell, format);
    const noCotiza = [qtyCell, puCell, totalCell].some(isNoCotiza);

    if (!code && !description && !unitRaw && quantity === null && unitPrice === null && !totalPrice) {
      continue; // fila vacía (incluye las que solo tienen una fórmula que da 0)
    }

    // Título escrito en la columna de código con la descripción vacía. En estas planillas
    // así se escriben las áreas y bloques ("PLANTA DE CONJUNTO", "Rociadores").
    const titleInCodeColumn = !description && looksLikeTitle(code);
    if (titleInCodeColumn) {
      description = code;
      code = "";
    }
    // Descripción en otra columna (ej. celdas combinadas desplazadas)
    if (!description) {
      for (let c = 0; c < raw.length; c++) {
        if (roleCols.has(c)) continue;
        const text = cleanText(raw[c]);
        if (text.length > 2 && parseFlexibleNumber(text, format) === null) {
          description = text;
          break;
        }
      }
    }
    const unitInfo = unitRaw ? normalizeUnit(unitRaw) : null;
    let kind: RowKind;
    let surchargePercent: number | null = null;
    let isGrandTotal = false;

    if (!description && !code) {
      kind = "SUBTOTAL"; // solo números: subtotal sin rótulo (el total no es 0, ver arriba)
    } else if (isSubtotalText(description) || (!unitRaw && isSubtotalText(code))) {
      kind = "SUBTOTAL";
      isGrandTotal = GRAND_TOTAL.test(description);
    } else if (SURCHARGE.test(description) && !unitRaw && quantity === null) {
      kind = "RECARGO";
      surchargePercent = percentFrom(description, [qtyCell, puCell], format);
    } else if (NOTE.test(description) || (!code && description.length > 160)) {
      kind = "IGNORAR";
    } else if (unitRaw || noCotiza || quantity !== null || unitPrice !== null) {
      // Con cantidad o PU es ítem (aunque el PU sea 0); sin ninguno de los dos es título.
      kind = "ITEM";
    } else if (afterGrandTotal) {
      kind = "IGNORAR";
    } else {
      kind = "RUBRO";
    }
    if (kind === "SUBTOTAL" && isGrandTotal) afterGrandTotal = true;

    let level = 0;
    if (kind === "RUBRO" || kind === "ITEM") {
      const segs = codeSegments(code);
      const numbered = segs.length > 0 && !isLabelCode(code);
      const scope = inScope();
      const byCode = (target: string) => [...scope].reverse().find((e) => e.type === "CHAPTER" && normCode(e.code) === target);
      let parent: StackEntry | undefined;
      let type: HeadingType = "CHAPTER";

      if (kind === "RUBRO" && AREA_PATTERN.test(description || code)) {
        type = "AREA";
        parent = undefined;
      } else if (kind === "RUBRO" && isLabelCode(code)) {
        type = "LABEL";
        parent = [...scope].reverse().find((e) => e.type === "CHAPTER") ?? anchor();
      } else if (kind === "RUBRO" && !numbered) {
        const top = stack[stack.length - 1];
        const area = stack.find((e) => e.type === "AREA");
        if (area && (titleInCodeColumn || knownBlocks.has(description.toUpperCase()))) {
          // Un nombre que ya apareció como bloque en otra área ("ESTRUCTURA DE HORMIGÓN
          // ARMADO") es un bloque aunque venga después de un capítulo.
          parent = area;
          type = "BLOCK";
        } else if (lastWasHeading && top) {
          // Justo después de otro título: bajo un área es un bloque; bajo un capítulo o
          // etiqueta es un subtítulo ("6 ABERTURAS › B.N. › PUERTAS").
          parent = top;
          type = top.type === "AREA" ? "BLOCK" : "SUBTITLE";
        } else if (lastHeading?.type === "SUBTITLE" && stack.includes(lastHeading)) {
          // Después de los ítems de un subtítulo: el siguiente subtítulo ("VENTANAS").
          parent = stack.find((e) => e.level === lastHeading!.level - 1);
          type = "SUBTITLE";
        } else {
          // Después de ítems de un capítulo: nuevo bloque del área ("PLANTA NIVEL 1").
          type = "BLOCK";
          const sibling = [...stack].reverse().find((e) => e.type === "BLOCK" || e.type === "SUBTITLE");
          parent = area ?? (sibling ? stack.find((e) => e.level === sibling.level - 1) : undefined);
        }
      } else if (kind === "RUBRO") {
        if (segs.length >= 2) {
          parent =
            byCode(normCode(segs.slice(0, -1).join("."))) ??
            [...scope].reverse().find((e) => e.type === "CHAPTER" && e.segs.length === segs.length - 1) ??
            anchor();
        } else {
          const sibling = [...scope].reverse().find(
            (e) => e.type === "CHAPTER" && e.segs.length === 1 && codeType(e.segs[0]) === codeType(segs[0])
          );
          parent = sibling ? stack.find((e) => e.level === sibling.level - 1) : lastWasHeading ? stack[stack.length - 1] : anchor();
        }
      } else if (numbered && segs.length >= 2) {
        // Ítem numerado: capítulo por código dentro del alcance; si ese capítulo tiene
        // etiquetas o subtítulos abiertos (4 REVOQUES › B.N. › 4.1, 6 › B.N. › PUERTAS › 6.1),
        // va bajo el más profundo de ellos.
        const chapter =
          byCode(normCode(segs.slice(0, -1).join("."))) ??
          [...scope].reverse().find((e) => e.type === "CHAPTER" && e.segs.length === segs.length - 1);
        if (chapter) {
          parent = chapter;
          for (const e of stack.slice(stack.indexOf(chapter) + 1)) {
            if (e.type !== "LABEL" && e.type !== "SUBTITLE") break;
            parent = e;
          }
        } else {
          parent = stack[stack.length - 1];
        }
      } else {
        parent = stack[stack.length - 1];
      }
      level = parent ? parent.level + 1 : 0;

      if (kind === "RUBRO") {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        lastHeading = { level, code, segs, type };
        stack.push(lastHeading);
        if (type === "BLOCK" && parent?.type === "AREA") knownBlocks.add(description.toUpperCase());
        if (level > 0) kind = "SUBRUBRO";
      } else {
        // Un ítem que vuelve a un nivel superior cierra los títulos más profundos.
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      }
      lastWasHeading = kind !== "ITEM";
    }

    const isHidden = hidden.has(r);
    if (isHidden && !options.includeHidden && kind !== "IGNORAR") {
      issues.push({
        id: `hidden-${sheet.sheetName}-${r + 1}`,
        type: "INFO",
        category: "FORMAT",
        sheet: sheet.sheetName,
        rowNumber: r + 1,
        code,
        itemDescription: description,
        message: `Fila ${r + 1} oculta en Excel: se excluye (podés incluirla cambiando su tipo)`,
      });
      kind = "IGNORAR";
    }

    rows.push({
      id: `${sheet.sheetName}!${r + 1}`,
      sheet: sheet.sheetName,
      rowNumber: r + 1,
      hidden: isHidden,
      kind,
      level: level + (kind === "RUBRO" || kind === "SUBRUBRO" || kind === "ITEM" ? offset : 0),
      code,
      description,
      unit: unitInfo ? unitInfo.unit : "",
      quantity,
      unitPrice,
      totalPrice,
      noCotiza,
      unitReview: unitInfo?.unitReview ?? false,
      unitSuggestion: unitInfo?.unitSuggestion ?? null,
      surchargePercent,
      isGrandTotal,
    });
  }

  if (structure.formulasWithoutValue > 0) {
    issues.push({
      id: `formulas-${sheet.sheetName}`,
      type: "WARNING",
      category: "FORMAT",
      sheet: sheet.sheetName,
      message: `La hoja "${sheet.sheetName}" tiene ${structure.formulasWithoutValue} fórmulas sin valor calculado. Abrí el archivo en Excel, guardalo y volvé a subirlo.`,
    });
  }

  return { rows, issues };
}
