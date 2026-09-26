import { DomainError } from "../../../errors/domain";
import { analyzeSheetStructure } from "./columnAnalyzer";
import { buildBudgetTree, defaultSurchargeTreatment } from "./budgetTree";
import { detectNumberFormat, ExtractedWorkbook } from "./matrixExtractor";
import { classifySheetRows } from "./rowClassifier";
import {
  BudgetImportPreview,
  ImportRow,
  PreviewOptions,
  SheetStructure,
  SurchargeTreatment,
  ValidationIssue,
} from "./types";

/** Hoja principal por defecto: la que más ítems tiene, salvo resúmenes/carátulas. */
function defaultSheets(structures: SheetStructure[]): string[] {
  const candidates = structures.filter((s) => !s.likelySummary);
  const pool = candidates.length ? candidates : structures;
  const best = [...pool].sort((a, b) => b.detectedItemRows - a.detectedItemRows)[0];
  return best ? [best.sheetName] : [];
}

/** Lee la planilla, detecta columnas, clasifica filas y arma el árbol con su cuadre. No guarda nada. */
export function generatePreview(workbook: ExtractedWorkbook, options: PreviewOptions = {}): BudgetImportPreview {
  if (!workbook.sheets.length) {
    throw new DomainError("EMPTY_WORKBOOK", "El archivo no contiene hojas con datos legibles", 422);
  }

  const detectedNumberFormat = detectNumberFormat(workbook.sheets);
  const numberFormat = options.numberFormat ?? detectedNumberFormat;
  const includeHidden = options.includeHidden ?? false;

  const structures = workbook.sheets.map((sheet) =>
    analyzeSheetStructure(
      sheet,
      numberFormat,
      options.headerRows?.[sheet.sheetName],
      options.columnMappings?.[sheet.sheetName]
    )
  );

  const known = new Set(workbook.sheets.map((s) => s.sheetName));
  const requested = (options.selectedSheets ?? []).filter((s) => known.has(s));
  const selectedSheets = requested.length ? requested : defaultSheets(structures);
  const multiSheet = selectedSheets.length > 1;

  const rows: ImportRow[] = [];
  const readIssues: ValidationIssue[] = [];
  for (const sheet of workbook.sheets) {
    if (!selectedSheets.includes(sheet.sheetName)) continue;
    const structure = structures.find((s) => s.sheetName === sheet.sheetName)!;
    if (multiSheet) {
      // Con varias hojas, cada hoja es un rubro propio para que sus códigos no se pisen.
      rows.push({
        id: `${sheet.sheetName}!0`,
        sheet: sheet.sheetName,
        rowNumber: 0,
        hidden: false,
        kind: "RUBRO",
        level: 0,
        code: "",
        description: sheet.sheetName,
        unit: "",
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        noCotiza: false,
        unitReview: false,
        unitSuggestion: null,
        surchargePercent: null,
        isGrandTotal: false,
      });
    }
    const result = classifySheetRows(sheet, structure, numberFormat, {
      includeHidden,
      levelOffset: multiSheet ? 1 : 0,
    });
    rows.push(...result.rows);
    readIssues.push(...result.issues);
  }

  const surchargeTreatments: Record<string, SurchargeTreatment> = {};
  for (const row of rows) {
    if (row.kind === "RECARGO") surchargeTreatments[row.id] = defaultSurchargeTreatment(row.description);
  }

  const build = buildBudgetTree(rows, {
    surchargeTreatments,
    currencyDecimals: options.currencyDecimals ?? 0,
    contractAmount: options.contractAmount ?? null,
  });

  return {
    sheets: structures,
    selectedSheets,
    numberFormat,
    detectedNumberFormat,
    includeHidden,
    rows,
    build,
    surchargeTreatments,
    readIssues,
    metadata: {
      fileName: workbook.fileName,
      sourceType: workbook.sourceType,
      detectedAt: new Date().toISOString(),
    },
  };
}
