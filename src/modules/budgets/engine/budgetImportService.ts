import { PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { analyzeSheetStructure } from "./columnAnalyzer";
import { classifyHierarchy, isAggregateRow } from "./hierarchyClassifier";
import { cleanText, ExtractedWorkbook, parseFlexibleNumber } from "./matrixExtractor";
import {
  BudgetImportPreview,
  CanonicalColumnRole,
  CommitBudgetPayload,
  CommitBudgetResult,
  ParsedItemRow,
  SheetStructure,
  ValidationIssue,
} from "./types";
import { normalizeUnit } from "./unitNormalizer";
import { validateDuplicateCodes, validateRowArithmetic } from "./validationEngine";

export interface PreviewOptions {
  activeSheetName?: string;
  customHeaderRows?: Record<string, number>; // sheetName -> headerRow (0-indexed)
  customColumnMappings?: Record<string, Record<number, CanonicalColumnRole>>; // sheetName -> colIndex -> role
}

export class BudgetImportService {
  /**
   * Genera una previsualización completa y diagnóstica de la importación
   */
  public generatePreview(
    workbook: ExtractedWorkbook,
    options?: PreviewOptions
  ): BudgetImportPreview {
    if (!workbook.sheets.length) {
      throw new Error("El archivo no contiene hojas con datos legibles");
    }

    const sheetsSummary: SheetStructure[] = [];
    const allParsedItems: ParsedItemRow[] = [];
    const allWarnings: ValidationIssue[] = [];

    // Determinar hoja activa: la especificada o la primera con datos
    const activeSheetName =
      options?.activeSheetName ||
      workbook.sheets.find((s) => s.matrix.length > 2)?.sheetName ||
      workbook.sheets[0].sheetName;

    // Analizar estructura de cada hoja
    for (const sheet of workbook.sheets) {
      const preferredHeaderRow = options?.customHeaderRows?.[sheet.sheetName];
      const structure = analyzeSheetStructure(sheet.matrix, sheet.sheetName, preferredHeaderRow);

      // Si el usuario especificó roles manuales para esta hoja, sobreescribir
      if (options?.customColumnMappings?.[sheet.sheetName]) {
        const manualMap = options.customColumnMappings[sheet.sheetName];
        structure.columns = structure.columns.map((col) => ({
          ...col,
          detectedRole: manualMap[col.index] !== undefined ? manualMap[col.index] : col.detectedRole,
        }));
      }

      sheetsSummary.push(structure);

      // Procesar filas solo de la hoja activa (o de todas si se desea procesar el libro entero)
      if (sheet.sheetName === activeSheetName) {
        const parsed = this.parseSheetRows(sheet.matrix, structure);
        allParsedItems.push(...parsed);
      }
    }

    // Validar códigos duplicados entre los ítems detectados
    const duplicateIssues = validateDuplicateCodes(
      allParsedItems.filter((i) => !i.isExcludedAggregate).map((i) => ({
        code: i.code,
        sheet: i.sheet,
        rowNumber: i.rowNumber,
        description: i.description,
      }))
    );

    // Agregar problemas a los ítems correspondientes y a la lista general
    for (const item of allParsedItems) {
      const itemDupes = duplicateIssues.filter((d) => d.code === item.code && d.rowNumber === item.rowNumber);
      if (itemDupes.length > 0) {
        item.issues.push(...itemDupes);
      }
      allWarnings.push(...item.issues);
    }

    // Calcular métricas
    const validItems = allParsedItems.filter((i) => !i.isExcludedAggregate);
    const rubrosCount = validItems.filter((i) => i.nodeKind === "RUBRO").length;
    const subrubrosCount = validItems.filter((i) => i.nodeKind === "SUBRUBRO").length;
    const itemsCount = validItems.filter((i) => i.nodeKind === "ITEM").length;
    const aggregatesExcludedCount = allParsedItems.filter((i) => i.isExcludedAggregate).length;
    const totalAmount = validItems.reduce((acc, i) => acc + (i.totalPrice || 0), 0);

    const criticalIssuesCount = allWarnings.filter((w) => w.type === "CRITICAL").length;
    const warningIssuesCount = allWarnings.filter((w) => w.type === "WARNING").length;
    const arithmeticMismatchCount = validItems.filter((i) => i.hasArithmeticMismatch).length;
    const unitReviewCount = validItems.filter((i) => i.unitReview).length;

    return {
      sheets: sheetsSummary,
      activeSheetName,
      detectedItems: allParsedItems,
      summary: {
        totalRowsRead: allParsedItems.length,
        rubrosCount,
        subrubrosCount,
        itemsCount,
        aggregatesExcludedCount,
        totalAmount,
        criticalIssuesCount,
        warningIssuesCount,
        arithmeticMismatchCount,
        unitReviewCount,
      },
      warnings: allWarnings,
      metadata: {
        fileName: workbook.fileName,
        sourceType: workbook.sourceType,
        detectedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Parser de filas de una hoja específica
   */
  private parseSheetRows(matrix: any[][], structure: SheetStructure): ParsedItemRow[] {
    const parsedRows: ParsedItemRow[] = [];
    const colRoleMap = new Map<CanonicalColumnRole, number>();

    for (const col of structure.columns) {
      if (col.detectedRole !== "ignore") {
        colRoleMap.set(col.detectedRole, col.index);
      }
    }

    const codeCol = colRoleMap.get("code");
    const descCol = colRoleMap.get("description");
    const unitCol = colRoleMap.get("unit");
    const qtyCol = colRoleMap.get("quantity");
    const puCol = colRoleMap.get("unitPrice");
    const totalCol = colRoleMap.get("totalPrice");

    const startRow = structure.headerRowIndex + 1;
    const contextStack: { level: number; path: string }[] = [];

    // Inspeccionar primero para saber si una fila tiene hijos más adelante
    const rawRows = matrix.slice(startRow);
    const codesInSheet: string[] = [];
    for (const r of rawRows) {
      if (codeCol !== undefined && r?.[codeCol]) {
        codesInSheet.push(cleanText(r[codeCol]));
      }
    }

    for (let rIdx = startRow; rIdx < matrix.length; rIdx++) {
      const row = matrix[rIdx];
      if (!Array.isArray(row) || row.length === 0) continue;

      let rawCode = codeCol !== undefined ? cleanText(row[codeCol]) : "";
      let rawDesc = descCol !== undefined ? cleanText(row[descCol]) : "";
      const rawUnit = unitCol !== undefined ? row[unitCol] : "";
      const rawQty = qtyCol !== undefined ? row[qtyCol] : "";
      const rawPu = puCol !== undefined ? row[puCol] : "";
      const rawTotal = totalCol !== undefined ? row[totalCol] : "";

      // Si la fila está completamente vacía, omitir
      if (!rawCode && !rawDesc && !cleanText(rawQty) && !cleanText(rawPu) && !cleanText(rawTotal)) {
        continue;
      }

      // Si la descripción está vacía pero hay texto en otra celda, intentar rescatarlo
      if (!rawDesc) {
        for (let c = 0; c < row.length; c++) {
          if (c === codeCol || c === unitCol || c === qtyCol || c === puCol || c === totalCol) continue;
          const val = cleanText(row[c]);
          if (val.length > 2 && parseFlexibleNumber(val) === null) {
            rawDesc = val;
            break;
          }
        }
      }

      // Si aún no hay descripción pero hay código
      if (!rawDesc && rawCode) {
        rawDesc = `Rubro ${rawCode}`;
      } else if (!rawDesc) {
        // Fila decorativa o vacía
        continue;
      }

      const issues: ValidationIssue[] = [];

      // Detección de filas de agregado (subtotales, totales, resúmenes)
      const isAgg = isAggregateRow(rawDesc, rawCode);

      // Si no tiene código y no es agregado, generar código jerárquico determinístico
      if (!rawCode && !isAgg) {
        rawCode = `${structure.sheetName.replace(/\s+/g, "").slice(0, 3).toUpperCase()}.${parsedRows.length + 1}`;
      }

      const parsedQty = parseFlexibleNumber(rawQty);
      const parsedPu = parseFlexibleNumber(rawPu);
      const parsedTotal = parseFlexibleNumber(rawTotal);

      const noCotiza = [rawQty, rawPu, rawTotal].some((val) =>
        /^(no\s*cotiza|s\/?c|sin\s*cotizar|-)$/i.test(cleanText(val))
      );

      const quantity = Math.max(0, parsedQty ?? (noCotiza ? 0 : 1));
      const unitPrice = Math.max(0, parsedPu ?? 0);
      let totalPrice = Math.max(0, parsedTotal ?? Math.round(quantity * unitPrice));

      // Si precio total estaba vacío pero tenemos PU y Cantidad, calcular
      if (parsedTotal === null && quantity > 0 && unitPrice > 0) {
        totalPrice = Math.round(quantity * unitPrice);
      }

      // Si PU estaba en cero pero tenemos cantidad y total, deducir PU
      let deducedPu = unitPrice;
      if (unitPrice === 0 && totalPrice > 0 && quantity > 0) {
        deducedPu = Math.round(totalPrice / quantity);
      }

      const normalizedUnit = normalizeUnit(rawUnit);
      if (normalizedUnit.unitReview) {
        issues.push({
          id: `unit-review-${structure.sheetName}-${rIdx + 1}`,
          type: "INFO",
          category: "UNIT",
          sheet: structure.sheetName,
          rowNumber: rIdx + 1,
          code: rawCode,
          itemDescription: rawDesc,
          field: "unit",
          message: `Unidad no estándar "${cleanText(rawUnit)}". Se sugiere normalizar a "${normalizedUnit.unitSuggestion || "un"}".`,
          suggestedAction: "REVIEW_UNIT",
          expectedValue: normalizedUnit.unitSuggestion || "un",
          foundValue: cleanText(rawUnit),
        });
      }

      // Validación aritmética
      const arithmetic = validateRowArithmetic(
        structure.sheetName,
        rIdx + 1,
        rawCode,
        rawDesc,
        quantity,
        deducedPu,
        totalPrice
      );

      if (arithmetic.hasMismatch && arithmetic.issue) {
        issues.push(arithmetic.issue);
      }

      // Detección de hijos en el resto del archivo
      const hasChildItems = codesInSheet.some(
        (c) => c !== rawCode && (c.startsWith(rawCode + ".") || c.startsWith(rawCode + "-"))
      );

      const hasLeafMetrics = quantity > 0 && (deducedPu > 0 || totalPrice > 0);

      // Clasificación jerárquica
      const hierarchy = classifyHierarchy(
        rawCode,
        rawDesc,
        hasLeafMetrics,
        hasChildItems,
        contextStack
      );

      // Mantener stack de contexto jerárquico
      if (hierarchy.nodeKind !== "AGREGADO") {
        while (contextStack.length > 0 && contextStack[contextStack.length - 1].level >= hierarchy.hierarchyLevel) {
          contextStack.pop();
        }
        contextStack.push({ level: hierarchy.hierarchyLevel, path: hierarchy.path });
      }

      parsedRows.push({
        id: `row-${structure.sheetName}-${rIdx + 1}`,
        sheet: structure.sheetName,
        rowNumber: rIdx + 1,
        code: rawCode,
        originalCode: rawCode,
        description: rawDesc,
        unit: normalizedUnit.unit,
        quantity,
        unitPrice: deducedPu,
        totalPrice,
        calculatedTotal: arithmetic.computedTotal,
        arithmeticDiff: arithmetic.difference,
        noCotiza,
        unitReview: normalizedUnit.unitReview,
        unitSuggestion: normalizedUnit.unitSuggestion,
        nodeKind: isAgg ? "AGREGADO" : hierarchy.nodeKind,
        hierarchyLevel: hierarchy.hierarchyLevel,
        path: hierarchy.path,
        parentPath: hierarchy.parentPath,
        isExcludedAggregate: isAgg,
        hasArithmeticMismatch: arithmetic.hasMismatch,
        issues,
      });
    }

    return parsedRows;
  }

  /**
   * Persistencia Transaccional en Base de Datos:
   * NUNCA persiste filas de agregados / subtotales.
   */
  public async commitBudget(payload: CommitBudgetPayload): Promise<CommitBudgetResult> {
    const { projectId, items, markupPercent = 0, resolutionStrategy = "KEEP_ORIGINAL" } = payload;

    if (!projectId || projectId <= 0) {
      throw new Error("El ID de la obra es requerido y debe ser válido");
    }

    // FILTRO CRÍTICO DEL PRD: Nunca persistir filas de tipo AGREGADO
    const validItems = items.filter(
      (item) => item.nodeKind !== ("AGREGADO" as any) && !isAggregateRow(item.description, item.code)
    );

    if (validItems.length === 0) {
      throw new Error("No hay ítems válidos para importar. Todas las filas eran subtotales o estaban vacías.");
    }

    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new Error(`Obra con ID ${projectId} no encontrada.`);
      }

      let grandTotal = 0;
      let rubrosCount = 0;
      let subrubrosCount = 0;
      let itemsCount = 0;

      const factor = 1 + (markupPercent || 0) / 100;
      const budgetItemMap = new Map<string, number>();

      // Ordenar ítems para crear padres antes que hijos
      const sortedItems = [...validItems].sort((a, b) => a.hierarchyLevel - b.hierarchyLevel);

      for (const item of sortedItems) {
        let finalUnitPrice = Math.round((item.unitPrice || 0) * factor);
        let finalTotalPrice = Math.round((item.totalPrice || 0) * factor);

        // Aplicar estrategia de resolución aritmética si se indicó
        if (resolutionStrategy === "RECALCULATE_TOTAL" && item.quantity > 0 && finalUnitPrice > 0) {
          finalTotalPrice = Math.round(item.quantity * finalUnitPrice);
        } else if (resolutionStrategy === "RECALCULATE_PU" && item.quantity > 0 && finalTotalPrice > 0) {
          finalUnitPrice = Math.round(finalTotalPrice / item.quantity);
        }

        if (item.nodeKind === "RUBRO") rubrosCount++;
        else if (item.nodeKind === "SUBRUBRO") subrubrosCount++;
        else itemsCount++;

        grandTotal += finalTotalPrice;

        // Resolver parentId si tiene parentPath
        const parentId = item.parentPath ? budgetItemMap.get(item.parentPath) : undefined;

        const upserted = await tx.budgetItem.upsert({
          where: {
            projectId_code: {
              projectId,
              code: item.code.trim(),
            },
          },
          create: {
            projectId,
            code: item.code.trim(),
            name: item.description.trim(),
            category: item.category || item.sourceSheet || "GENERAL",
            unit: item.unit || "un",
            totalQuantity: item.quantity || 0,
            unitPrice: finalUnitPrice,
            originalAmount: finalTotalPrice,
            parentId,
            path: item.path || item.code.trim(),
            hierarchyLevel: item.hierarchyLevel || 0,
            nodeKind: item.nodeKind,
            noCotiza: Boolean(item.noCotiza),
            unitReview: Boolean(item.unitReview),
            unitSuggestion: item.unitSuggestion || null,
            sourceSheet: item.sourceSheet || null,
            sourceRow: item.sourceRow || null,
          },
          update: {
            name: item.description.trim(),
            category: item.category || item.sourceSheet || "GENERAL",
            unit: item.unit || "un",
            totalQuantity: item.quantity || 0,
            unitPrice: finalUnitPrice,
            originalAmount: finalTotalPrice,
            parentId,
            path: item.path || item.code.trim(),
            hierarchyLevel: item.hierarchyLevel || 0,
            nodeKind: item.nodeKind,
            noCotiza: Boolean(item.noCotiza),
            unitReview: Boolean(item.unitReview),
            unitSuggestion: item.unitSuggestion || null,
            sourceSheet: item.sourceSheet || null,
            sourceRow: item.sourceRow || null,
          },
        });

        budgetItemMap.set(item.path || item.code.trim(), upserted.id);
        budgetItemMap.set(item.code.trim(), upserted.id);
      }

      // Actualizar montos globales del proyecto
      await tx.project.update({
        where: { id: projectId },
        data: {
          globalBudget: grandTotal > 0 ? grandTotal : project.globalBudget,
          montoContractualManual: grandTotal > 0 ? grandTotal : project.montoContractualManual,
          montoRealActualizado: grandTotal > 0 ? grandTotal : project.montoRealActualizado,
        },
      });

      return {
        success: true,
        projectId,
        importedItemsCount: validItems.length,
        rubrosCount,
        subrubrosCount,
        itemsCount,
        totalBudgetAmount: grandTotal,
        message: `Importación exitosa: ${validItems.length} partidas sincronizadas (${rubrosCount} rubros, ${subrubrosCount} subrubros, ${itemsCount} ítems).`,
      };
    });
  }
}

export const budgetImportService = new BudgetImportService();
