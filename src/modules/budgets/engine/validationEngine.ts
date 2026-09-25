import { ValidationIssue } from "./types";

export interface ArithmeticValidationResult {
  hasMismatch: boolean;
  computedTotal: number;
  difference: number;
  issue?: ValidationIssue;
}

/**
 * Valida la consistencia aritmética de una fila: Cantidad × Precio Unitario = Precio Total
 */
export function validateRowArithmetic(
  sheet: string,
  rowNumber: number,
  code: string,
  description: string,
  quantity: number,
  unitPrice: number,
  providedTotal: number
): ArithmeticValidationResult {
  const computedTotal = Math.round(quantity * unitPrice);

  // Si no se proveyó total explícito, no hay discrepancia
  if (providedTotal === 0 && (quantity === 0 || unitPrice === 0)) {
    return { hasMismatch: false, computedTotal, difference: 0 };
  }

  const diff = Math.abs(computedTotal - providedTotal);

  // Tolerancia: 1 unidad o menos del 0.2%
  const tolerance = Math.max(1, Math.round(computedTotal * 0.002));
  const hasMismatch = diff > tolerance && quantity > 0 && unitPrice > 0 && providedTotal > 0;

  let issue: ValidationIssue | undefined;
  if (hasMismatch) {
    issue = {
      id: `arithmetic-${sheet}-${rowNumber}`,
      type: "WARNING",
      category: "ARITHMETIC",
      sheet,
      rowNumber,
      code,
      itemDescription: description,
      field: "totalPrice",
      message: `Discrepancia aritmética: Cantidad (${quantity}) × P.U. (${unitPrice.toLocaleString()}) = ${computedTotal.toLocaleString()}, pero la planilla indica ${providedTotal.toLocaleString()} (Dif: ${diff.toLocaleString()}).`,
      suggestedAction: "RECALCULATE_TOTAL",
      expectedValue: computedTotal,
      foundValue: providedTotal,
    };
  }

  return {
    hasMismatch,
    computedTotal,
    difference: diff,
    issue,
  };
}

/**
 * Comprueba códigos duplicados en el conjunto de ítems procesados
 */
export function validateDuplicateCodes(
  items: Array<{ code: string; sheet: string; rowNumber: number; description: string }>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenCodes = new Map<string, { sheet: string; rowNumber: number }>();

  for (const item of items) {
    if (!item.code) continue;
    const existing = seenCodes.get(item.code);
    if (existing) {
      issues.push({
        id: `duplicate-code-${item.code}-${item.rowNumber}`,
        type: "CRITICAL",
        category: "DUPLICATE_CODE",
        sheet: item.sheet,
        rowNumber: item.rowNumber,
        code: item.code,
        itemDescription: item.description,
        field: "code",
        message: `Código duplicado "${item.code}". Ya fue definido en la hoja "${existing.sheet}" fila ${existing.rowNumber}.`,
        suggestedAction: "AUTO_CODE",
      });
    } else {
      seenCodes.set(item.code, { sheet: item.sheet, rowNumber: item.rowNumber });
    }
  }

  return issues;
}
