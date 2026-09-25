import { cleanText } from "./matrixExtractor";
import { BudgetNodeKind } from "./types";

const AGGREGATE_NAME_PATTERNS = [
  /^(sub-?\s*totales?)/i,
  /^(total(es)?(\s+(general|rubro|subrubro|parcial|de\s+obra|del\s+contrato|presupuestario|de\s+la\s+obra|items?|acumulado))?)$/i,
  /^(monto\s+total|suma\s+total|gran\s+total|importe\s+total)$/i,
  /^(resumen(\s+(general|de\s+rubros|presupuesto))?)$/i,
  /^(avance(\s+acumulado|\s+financiero|\s+fisico)?)$/i,
  /^(firma(s)?|autorizado\s+por|elaborado\s+por|revisado\s+por)$/i,
];

/**
 * Determina si una fila es un subtotal, total o pie de página que NO debe persistirse como ítem
 */
export function isAggregateRow(description: string, code?: string): boolean {
  const normDesc = cleanText(description).trim();
  const normCode = cleanText(code).trim();

  if (!normDesc && !normCode) return true;

  for (const pattern of AGGREGATE_NAME_PATTERNS) {
    if (pattern.test(normDesc) || (normCode && pattern.test(normCode))) {
      return true;
    }
  }

  // Fila que contiene palabras como "SUB-TOTAL" o "TOTAL" al principio
  if (/^total\b/i.test(normDesc) || /^sub-?total\b/i.test(normDesc)) {
    return true;
  }

  return false;
}

export interface HierarchyClassification {
  nodeKind: BudgetNodeKind;
  hierarchyLevel: number;
  parentPath: string | null;
  path: string;
  isExcludedAggregate: boolean;
}

/**
 * Calcula la profundidad y estructura jerárquica de un código de presupuesto
 */
export function classifyHierarchy(
  code: string,
  description: string,
  hasLeafMetrics: boolean, // cantidad > 0 y PU > 0
  hasChildItems: boolean,
  contextStack: { level: number; path: string }[]
): HierarchyClassification {
  const isAgg = isAggregateRow(description, code);
  if (isAgg) {
    return {
      nodeKind: "AGREGADO",
      hierarchyLevel: 0,
      parentPath: null,
      path: code || "AGREGADO",
      isExcludedAggregate: true,
    };
  }

  const cleanCode = cleanText(code);
  const path = cleanCode || `ITEM-${Math.random().toString(36).substring(2, 7)}`;

  // 1. Detección por código con puntos (ej. 1, 1.1, 1.1.1, 1.1.1.1) o guiones (1-1)
  const dotCount = (cleanCode.match(/\./g) || []).length;
  const dashCount = (cleanCode.match(/-/g) || []).length;

  let level = 0;
  let parentPath: string | null = null;

  if (dotCount > 0) {
    level = dotCount;
    const lastDotIdx = cleanCode.lastIndexOf(".");
    parentPath = cleanCode.slice(0, lastDotIdx);
  } else if (dashCount > 0 && /^[0-9a-z]+(-[0-9a-z]+)+$/i.test(cleanCode)) {
    level = dashCount;
    const lastDashIdx = cleanCode.lastIndexOf("-");
    parentPath = cleanCode.slice(0, lastDashIdx);
  } else {
    // 2. Códigos sin separadores (ej: "1", "01", "A", "ITEM 1", etc.)
    // Si no tiene puntos, determinar el nivel basándose en la longitud o contexto
    if (contextStack.length > 0) {
      // Si tiene métricas de hoja (cantidad y precio) se considera ítem en el contexto actual
      if (hasLeafMetrics && !hasChildItems) {
        level = Math.max(1, contextStack[contextStack.length - 1].level + 1);
        parentPath = contextStack[contextStack.length - 1].path;
      } else {
        level = 0;
        parentPath = null;
      }
    } else {
      level = 0;
      parentPath = null;
    }
  }

  // 3. Clasificación del tipo de nodo (RUBRO, SUBRUBRO, ITEM)
  let nodeKind: BudgetNodeKind;

  if (level === 0) {
    nodeKind = hasLeafMetrics && !hasChildItems ? "ITEM" : "RUBRO";
  } else if (hasChildItems) {
    nodeKind = "SUBRUBRO";
  } else if (hasLeafMetrics) {
    nodeKind = "ITEM";
  } else {
    // Si no tiene cómputos pero tiene nivel > 0 y no se sabe si tiene hijos aún
    nodeKind = level === 1 ? "SUBRUBRO" : "ITEM";
  }

  return {
    nodeKind,
    hierarchyLevel: level,
    parentPath,
    path,
    isExcludedAggregate: false,
  };
}
