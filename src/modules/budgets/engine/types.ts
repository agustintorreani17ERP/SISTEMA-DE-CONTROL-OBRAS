export type CanonicalColumnRole =
  | "code"
  | "description"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "totalPrice"
  | "ignore";

export type BudgetNodeKind = "RUBRO" | "SUBRUBRO" | "ITEM" | "AGREGADO";

export interface ColumnDetection {
  index: number;
  letter: string;
  originalHeader: string;
  detectedRole: CanonicalColumnRole;
  confidence: number;
  sampleValues: string[];
}

export interface SheetStructure {
  sheetName: string;
  totalRows: number;
  totalCols: number;
  headerRowIndex: number; // 0-indexed
  columns: ColumnDetection[];
  previewRows: Record<CanonicalColumnRole, string>[];
}

export interface ValidationIssue {
  id: string;
  type: "CRITICAL" | "WARNING" | "INFO";
  category: "ARITHMETIC" | "DUPLICATE_CODE" | "MISSING_FIELD" | "HIERARCHY" | "UNIT" | "FORMAT";
  sheet: string;
  rowNumber: number; // 1-indexed Excel row
  code?: string;
  itemDescription?: string;
  field?: string;
  message: string;
  suggestedAction?: "RECALCULATE_TOTAL" | "RECALCULATE_PU" | "KEEP_ORIGINAL" | "AUTO_CODE" | "REVIEW_UNIT";
  expectedValue?: string | number;
  foundValue?: string | number;
}

export interface ParsedItemRow {
  id: string;
  sheet: string;
  rowNumber: number;
  code: string;
  originalCode: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  calculatedTotal: number;
  arithmeticDiff: number;
  noCotiza: boolean;
  unitReview: boolean;
  unitSuggestion: string | null;
  nodeKind: BudgetNodeKind;
  hierarchyLevel: number;
  path: string;
  parentPath: string | null;
  isExcludedAggregate: boolean;
  hasArithmeticMismatch: boolean;
  issues: ValidationIssue[];
}

export interface BudgetImportPreview {
  sheets: SheetStructure[];
  activeSheetName: string;
  detectedItems: ParsedItemRow[];
  summary: {
    totalRowsRead: number;
    rubrosCount: number;
    subrubrosCount: number;
    itemsCount: number;
    aggregatesExcludedCount: number;
    totalAmount: number;
    criticalIssuesCount: number;
    warningIssuesCount: number;
    arithmeticMismatchCount: number;
    unitReviewCount: number;
  };
  warnings: ValidationIssue[];
  metadata: {
    fileName?: string;
    sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS" | "PASTED_TEXT";
    detectedAt: string;
  };
}

export interface CommitBudgetPayload {
  projectId: number;
  activeSheetName?: string;
  markupPercent?: number;
  resolutionStrategy?: "RECALCULATE_TOTAL" | "RECALCULATE_PU" | "KEEP_ORIGINAL";
  items: Array<{
    code: string;
    description: string;
    unit?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice?: number;
    nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
    hierarchyLevel: number;
    path: string;
    parentPath?: string | null;
    category?: string;
    noCotiza?: boolean;
    unitReview?: boolean;
    unitSuggestion?: string | null;
    sourceSheet?: string;
    sourceRow?: number;
  }>;
}

export interface CommitBudgetResult {
  success: boolean;
  projectId: number;
  importedItemsCount: number;
  rubrosCount: number;
  subrubrosCount: number;
  itemsCount: number;
  totalBudgetAmount: number;
  message: string;
}
