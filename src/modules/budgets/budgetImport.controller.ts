import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DomainError, NotFoundError } from "../../errors/domain";
import { ok } from "../../http/respond";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { budgetImportService, currencyDecimals } from "./engine/budgetImportService";
import {
  buildGoogleSheetsExportUrl,
  extractFromBuffer,
  extractFromPastedText,
  ExtractedWorkbook,
} from "./engine/matrixExtractor";

export const budgetImportRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function parseProjectId(raw: string) {
  const projectId = Number(raw);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new DomainError("INVALID_PROJECT", "El identificador de la obra no es válido");
  }
  return projectId;
}

function jsonField<T>(value: unknown): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new DomainError("INVALID_IMPORT_OPTIONS", "Opciones de importación mal formadas", 400);
  }
}

async function readWorkbook(req: any): Promise<ExtractedWorkbook> {
  if (req.file) return extractFromBuffer(req.file.buffer, req.file.originalname);
  if (req.body.pastedText) return extractFromPastedText(String(req.body.pastedText));
  if (req.body.googleSheetsUrl) {
    const urlInfo = buildGoogleSheetsExportUrl(String(req.body.googleSheetsUrl));
    try {
      const response = await fetch(urlInfo.url);
      if (!response.ok) {
        throw new Error(`Google Sheets respondió ${response.status}`);
      }
      const workbook = extractFromBuffer(Buffer.from(await response.arrayBuffer()), "GoogleSheets.xlsx");
      workbook.sourceType = "GOOGLE_SHEETS";
      return workbook;
    } catch (err: any) {
      throw new DomainError(
        "GOOGLE_SHEETS_ERROR",
        `No se pudo descargar la planilla de Google Sheets (${err.message || "error"}). Verificá que esté compartida con enlace.`,
        422
      );
    }
  }
  throw new DomainError(
    "FILE_OR_INPUT_REQUIRED",
    "Enviá un archivo Excel (.xlsx/.xls/.csv), texto pegado o un enlace de Google Sheets",
    400
  );
}

/**
 * POST /api/projects/:id/budget-import/preview
 * Lee la planilla, detecta columnas, clasifica filas y devuelve el árbol con el cuadre.
 * No guarda nada.
 */
budgetImportRouter.post(
  "/projects/:id/budget-import/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const projectId = parseProjectId(String(req.params.id));
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundError("Obra", projectId);

    const workbook = await readWorkbook(req);
    const numberFormat = req.body.numberFormat === "EN" ? "EN" : req.body.numberFormat === "PY" ? "PY" : undefined;

    const preview = budgetImportService.generatePreview(workbook, {
      selectedSheets: jsonField<string[]>(req.body.selectedSheets),
      headerRows: jsonField<Record<string, number>>(req.body.headerRows),
      columnMappings: jsonField(req.body.columnMappings),
      numberFormat,
      includeHidden: req.body.includeHidden === "true" || req.body.includeHidden === true,
      contractAmount: null, // el contrato se fija con esta importación
      currencyDecimals: currencyDecimals(project.currency),
    });

    const hasMovements = (await prisma.budgetMovement.count({ where: { projectId } })) > 0;
    ok(res, { ...preview, projectLocked: hasMovements });
  })
);

const rowSchema = z.object({
  id: z.string(),
  sheet: z.string(),
  rowNumber: z.number().int(),
  hidden: z.boolean(),
  kind: z.enum(["RUBRO", "SUBRUBRO", "ITEM", "SUBTOTAL", "RECARGO", "IGNORAR"]),
  level: z.number().int().min(0).max(20),
  code: z.string().max(200),
  description: z.string().max(10000),
  unit: z.string().max(100),
  quantity: z.number().finite().nullable(),
  unitPrice: z.number().finite().nullable(),
  totalPrice: z.number().finite().nullable(),
  noCotiza: z.boolean(),
  unitReview: z.boolean(),
  unitSuggestion: z.string().nullable(),
  surchargePercent: z.number().finite().nullable(),
  isGrandTotal: z.boolean(),
  edited: z.boolean().optional(),
});

const commitSchema = z.object({
  rows: z.array(rowSchema).min(1, "No hay filas para importar"),
  surchargeTreatments: z.record(z.enum(["DISTRIBUTE", "AS_ITEM", "IGNORE"])).default({}),
  arithmeticStrategy: z.enum(["KEEP_ORIGINAL", "RECALCULATE_TOTAL", "RECALCULATE_PU"]).default("KEEP_ORIGINAL"),
  acceptDifference: z.boolean().default(false),
  metadata: z.object({
    fileName: z.string().optional(),
    sourceType: z.string(),
    sheets: z.array(z.string()),
    numberFormat: z.enum(["PY", "EN"]),
    columnMappings: z.unknown().optional(),
  }),
});

/**
 * POST /api/projects/:id/budget-import/commit
 * Recibe las filas (con las correcciones del usuario), vuelve a validar y guarda el árbol.
 */
budgetImportRouter.post(
  "/projects/:id/budget-import/commit",
  asyncHandler(async (req, res) => {
    const projectId = parseProjectId(String(req.params.id));
    const payload = commitSchema.parse(req.body);
    const result = await budgetImportService.commitBudget({ projectId, ...payload });
    ok(res, result, 201);
  })
);

/** GET /api/projects/:id/budget-imports — historial de importaciones de la obra. */
budgetImportRouter.get(
  "/projects/:id/budget-imports",
  asyncHandler(async (req, res) => {
    const projectId = parseProjectId(String(req.params.id));
    ok(
      res,
      await prisma.budgetImport.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      })
    );
  })
);
