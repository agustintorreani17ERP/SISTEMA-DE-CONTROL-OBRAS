import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DomainError, NotFoundError } from "../../errors/domain";
import { ok } from "../../http/respond";
import { asyncHandler } from "../../middleware/asyncHandler";
import { budgetImportService } from "./engine/budgetImportService";
import {
  buildGoogleSheetsExportUrl,
  extractFromBuffer,
  extractFromPastedText,
  ExtractedWorkbook,
} from "./engine/matrixExtractor";

export const budgetImportRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB para planillas de miles de filas
});

/**
 * 1. Endpoint de Previsualización y Detección
 * POST /api/projects/:id/budget-import/preview
 */
budgetImportRouter.post(
  "/projects/:id/budget-import/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de la obra no es válido");
    }

    let workbook: ExtractedWorkbook;

    if (req.file) {
      workbook = extractFromBuffer(req.file.buffer, req.file.originalname);
    } else if (req.body.pastedText) {
      workbook = extractFromPastedText(String(req.body.pastedText));
    } else if (req.body.googleSheetsUrl) {
      const urlInfo = buildGoogleSheetsExportUrl(String(req.body.googleSheetsUrl));
      try {
        const response = await fetch(urlInfo.url);
        if (!response.ok) {
          throw new Error(`Google Sheets respondió con status ${response.status}. Verificá que el archivo sea público.`);
        }
        const arrayBuf = await response.arrayBuffer();
        workbook = extractFromBuffer(Buffer.from(arrayBuf), "GoogleSheets_Export.xlsx");
        workbook.sourceType = "GOOGLE_SHEETS";
      } catch (err: any) {
        throw new DomainError(
          "GOOGLE_SHEETS_ERROR",
          `No se pudo descargar la planilla de Google Sheets: ${err.message || ""}. Asegurate de que tenga acceso compartido con enlace.`,
          422
        );
      }
    } else {
      throw new DomainError(
        "FILE_OR_INPUT_REQUIRED",
        "Debés enviar un archivo Excel (.xlsx/.xls/.csv), texto pegado o enlace de Google Sheets",
        400
      );
    }

    // Opciones de configuración manual si vienen del paso 2
    let customHeaderRows: Record<string, number> | undefined;
    let customColumnMappings: Record<string, any> | undefined;

    if (req.body.customHeaderRows) {
      try {
        customHeaderRows =
          typeof req.body.customHeaderRows === "string"
            ? JSON.parse(req.body.customHeaderRows)
            : req.body.customHeaderRows;
      } catch {}
    }

    if (req.body.customColumnMappings) {
      try {
        customColumnMappings =
          typeof req.body.customColumnMappings === "string"
            ? JSON.parse(req.body.customColumnMappings)
            : req.body.customColumnMappings;
      } catch {}
    }

    const preview = budgetImportService.generatePreview(workbook, {
      activeSheetName: req.body.activeSheetName,
      customHeaderRows,
      customColumnMappings,
    });

    ok(res, preview);
  })
);

/**
 * 2. Endpoint de Confirmación y Persistencia Transaccional
 * POST /api/projects/:id/budget-import/commit
 */
const commitSchema = z.object({
  activeSheetName: z.string().optional(),
  markupPercent: z.coerce.number().default(0),
  resolutionStrategy: z.enum(["RECALCULATE_TOTAL", "RECALCULATE_PU", "KEEP_ORIGINAL"]).default("KEEP_ORIGINAL"),
  items: z.array(
    z.object({
      code: z.string().trim().min(1, "El código de partida es requerido"),
      description: z.string().trim().min(1, "La descripción es requerida"),
      unit: z.string().nullable().optional(),
      quantity: z.coerce.number().nonnegative().default(0),
      unitPrice: z.coerce.number().nonnegative().default(0),
      totalPrice: z.coerce.number().nonnegative().default(0),
      nodeKind: z.enum(["RUBRO", "SUBRUBRO", "ITEM"]),
      hierarchyLevel: z.coerce.number().int().nonnegative().default(0),
      path: z.string(),
      parentPath: z.string().nullable().optional(),
      category: z.string().optional(),
      noCotiza: z.boolean().optional(),
      unitReview: z.boolean().optional(),
      unitSuggestion: z.string().nullable().optional(),
      sourceSheet: z.string().optional(),
      sourceRow: z.number().optional(),
    })
  ).min(1, "Debe incluir al menos un ítem de presupuesto"),
});

budgetImportRouter.post(
  "/projects/:id/budget-import/commit",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de la obra no es válido");
    }

    const payload = commitSchema.parse(req.body);

    const result = await budgetImportService.commitBudget({
      projectId,
      ...payload,
    });

    ok(res, result, 201);
  })
);

/**
 * 3. Endpoint retrocompatible para compatibilidad con llamadas existentes de carga de archivos:
 * POST /api/certificaciones/import-budget
 */
budgetImportRouter.post(
  "/certificaciones/import-budget",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new DomainError("FILE_REQUIRED", "Debés adjuntar un archivo");
    const projectId = req.body.projectId ? Number(req.body.projectId) : 1;
    const workbook = extractFromBuffer(req.file.buffer, req.file.originalname);
    const preview = budgetImportService.generatePreview(workbook);

    // Auto-commit si es la ruta directa
    const validItems = preview.detectedItems.filter((i) => !i.isExcludedAggregate);
    const result = await budgetImportService.commitBudget({
      projectId,
      items: validItems.map((i) => ({
        code: i.code,
        description: i.description,
        unit: i.unit,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        nodeKind: i.nodeKind === "AGREGADO" ? "ITEM" : i.nodeKind,
        hierarchyLevel: i.hierarchyLevel,
        path: i.path,
        parentPath: i.parentPath,
        sourceSheet: i.sheet,
        sourceRow: i.rowNumber,
        noCotiza: i.noCotiza,
      })),
    });

    ok(res, { preview, result });
  })
);
