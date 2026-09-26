export type CanonicalColumnRole =
  | "code"
  | "description"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "totalPrice"
  | "ignore";

/** PY = 1.234.567,89 (punto miles, coma decimal) · EN = 1,234,567.89 */
export type NumberFormat = "PY" | "EN";

/**
 * Clasificación de cada fila leída de la planilla:
 * - RUBRO / SUBRUBRO: títulos que agrupan (su monto se calcula sumando a sus hijos).
 * - ITEM: partida con unidad/cantidad/precio; es lo único que recibe imputaciones.
 * - SUBTOTAL: "Total", "Subtotal rubro", "Total general" — no se guarda, sirve para cuadrar.
 * - RECARGO: IVA, G.G. y beneficio, imprevistos, coeficiente de pase…
 * - IGNORAR: notas, firmas, filas fuera del presupuesto.
 */
export type RowKind = "RUBRO" | "SUBRUBRO" | "ITEM" | "SUBTOTAL" | "RECARGO" | "IGNORAR";

/** DISTRIBUTE = se prorratea en los PU · AS_ITEM = partida propia · IGNORE = no se carga */
export type SurchargeTreatment = "DISTRIBUTE" | "AS_ITEM" | "IGNORE";

export type ArithmeticStrategy = "KEEP_ORIGINAL" | "RECALCULATE_TOTAL" | "RECALCULATE_PU";

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
  headerRowIndex: number; // 0-indexed; última fila del encabezado
  headerRowCount: number; // 1 o 2 si el encabezado ocupa dos filas
  columns: ColumnDetection[];
  previewRows: Record<CanonicalColumnRole, string>[];
  hiddenRowsCount: number;
  formulasWithoutValue: number;
  likelySummary: boolean; // hoja de resumen/carátula: no se selecciona por defecto
  detectedItemRows: number;
}

export interface ValidationIssue {
  id: string;
  type: "CRITICAL" | "WARNING" | "INFO";
  category:
    | "ARITHMETIC"
    | "DUPLICATE_CODE"
    | "MISSING_FIELD"
    | "HIERARCHY"
    | "UNIT"
    | "FORMAT"
    | "RECONCILIATION";
  sheet?: string;
  rowNumber?: number; // 1-indexed (fila de Excel)
  rowId?: string;
  code?: string;
  itemDescription?: string;
  field?: string;
  message: string;
}

/** Fila leída de la planilla, ya clasificada. Es lo que el usuario corrige en el paso 3. */
export interface ImportRow {
  id: string;
  sheet: string;
  rowNumber: number;
  hidden: boolean;
  kind: RowKind;
  level: number;
  code: string;
  description: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  noCotiza: boolean;
  unitReview: boolean;
  unitSuggestion: string | null;
  /** RECARGO: porcentaje leído del texto ("IVA 10%") */
  surchargePercent: number | null;
  /** SUBTOTAL: true si es el total general de la planilla */
  isGrandTotal: boolean;
  /** true si el usuario la modificó en el paso 3 */
  edited?: boolean;
}

/** Nodo calculado del árbol (resultado de deriveTree). */
export interface TreeNode {
  rowId: string;
  kind: "RUBRO" | "SUBRUBRO" | "ITEM";
  level: number;
  code: string;
  name: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  amount: number; // ítems: cantidad × PU; rubros: suma de hijos
  path: string;
  parentPath: string | null;
  topRubroName: string;
  sheet: string;
  rowNumber: number;
  noCotiza: boolean;
  unitReview: boolean;
  unitSuggestion: string | null;
  sortOrder: number;
  fromSurcharge?: boolean;
}

export interface SurchargeLine {
  rowId: string;
  description: string;
  percent: number | null;
  amount: number;
  treatment: SurchargeTreatment;
}

export interface RubroCheck {
  path: string;
  code: string;
  name: string;
  declared: number;
  computed: number;
  difference: number;
}

export interface Reconciliation {
  itemsTotal: number; // suma de ítems tal como vienen en la planilla
  surcharges: SurchargeLine[];
  surchargesTotal: number; // todos los recargos (incluidos los ignorados)
  sheetComputedTotal: number; // ítems + todos los recargos: debería igualar el total de la planilla
  declaredGrandTotal: number | null;
  declaredDifference: number | null;
  budgetTotal: number; // lo que efectivamente se carga como presupuesto
  contractAmount: number | null;
  contractDifference: number | null;
  rubroChecks: RubroCheck[];
  tolerance: number;
  balanced: boolean;
}

export interface BuildOptions {
  surchargeTreatments?: Record<string, SurchargeTreatment>;
  arithmeticStrategy?: ArithmeticStrategy;
  currencyDecimals?: number;
  contractAmount?: number | null;
}

export interface BuildResult {
  nodes: TreeNode[];
  reconciliation: Reconciliation;
  issues: ValidationIssue[];
  counts: { rubros: number; subrubros: number; items: number; subtotals: number; surcharges: number; ignored: number };
}

export interface BudgetImportPreview {
  sheets: SheetStructure[];
  selectedSheets: string[];
  numberFormat: NumberFormat;
  detectedNumberFormat: NumberFormat;
  includeHidden: boolean;
  rows: ImportRow[];
  build: BuildResult;
  surchargeTreatments: Record<string, SurchargeTreatment>;
  readIssues: ValidationIssue[];
  metadata: {
    fileName?: string;
    sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS" | "PASTED_TEXT";
    detectedAt: string;
  };
}

export interface PreviewOptions {
  selectedSheets?: string[];
  headerRows?: Record<string, number>; // hoja -> fila de encabezado (0-indexed)
  columnMappings?: Record<string, Record<number, CanonicalColumnRole>>;
  numberFormat?: NumberFormat;
  includeHidden?: boolean;
  contractAmount?: number | null;
  currencyDecimals?: number;
}

export interface CommitBudgetPayload {
  projectId: number;
  rows: ImportRow[];
  surchargeTreatments: Record<string, SurchargeTreatment>;
  arithmeticStrategy: ArithmeticStrategy;
  acceptDifference: boolean;
  metadata: {
    fileName?: string;
    sourceType: string;
    sheets: string[];
    numberFormat: NumberFormat;
    columnMappings?: unknown;
  };
  createdBy?: string;
}

export interface CommitBudgetResult {
  success: boolean;
  projectId: number;
  budgetImportId: number;
  nodesCount: number;
  rubrosCount: number;
  subrubrosCount: number;
  itemsCount: number;
  totalBudgetAmount: number;
  reconciliation: Reconciliation;
  message: string;
}
