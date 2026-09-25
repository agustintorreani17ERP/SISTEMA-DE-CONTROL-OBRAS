import { budgetImportService } from "../budgets/engine/budgetImportService";
import { extractFromBuffer } from "../budgets/engine/matrixExtractor";
import { ParsedItemRow } from "../budgets/engine/types";

export interface LegacyImportWarning {
  sheet: string;
  row: number;
  field: string;
  message: string;
  item?: string;
}

export interface LegacyParsedBudgetRow {
  sheet: string;
  rowNumber: number;
  code: string;
  name: string;
  category: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  originalAmount: number;
  noCotiza: boolean;
  unitReview: boolean;
  unitSuggestion: string | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM" | "AGREGADO";
  hierarchyLevel: number;
  path: string;
  parentPath: string | null;
}

export interface LegacyParsedBudget {
  rows: LegacyParsedBudgetRow[];
  warnings: LegacyImportWarning[];
  mapping: Record<string, string[]>;
  sheets: string[];
  metadata: { projectName?: string; clientName?: string; contractNumber?: string };
}

/**
 * Adaptador de compatibilidad retrocompatible usando el nuevo motor determinístico
 */
export function parseBudgetWorkbook(buffer: Buffer): LegacyParsedBudget {
  const workbook = extractFromBuffer(buffer, "presupuesto.xlsx");
  const preview = budgetImportService.generatePreview(workbook);

  const rows: LegacyParsedBudgetRow[] = preview.detectedItems.map((item: ParsedItemRow) => ({
    sheet: item.sheet,
    rowNumber: item.rowNumber,
    code: item.code,
    name: item.description,
    category: item.sheet,
    unit: item.unit,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    originalAmount: item.totalPrice,
    noCotiza: item.noCotiza,
    unitReview: item.unitReview,
    unitSuggestion: item.unitSuggestion,
    nodeKind: item.nodeKind,
    hierarchyLevel: item.hierarchyLevel,
    path: item.path,
    parentPath: item.parentPath,
  }));

  const warnings: LegacyImportWarning[] = preview.warnings.map((w) => ({
    sheet: w.sheet,
    row: w.rowNumber,
    field: w.field || "general",
    message: w.message,
    item: w.code,
  }));

  const mapping: Record<string, string[]> = {};
  for (const sheet of preview.sheets) {
    mapping[sheet.sheetName] = sheet.columns
      .filter((c) => c.detectedRole !== "ignore")
      .map((c) => `${c.detectedRole}=${c.originalHeader}`);
  }

  return {
    rows,
    warnings,
    mapping,
    sheets: preview.sheets.map((s) => s.sheetName),
    metadata: {},
  };
}
