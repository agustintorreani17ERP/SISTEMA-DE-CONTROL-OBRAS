import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { analyzeSheetStructure, roleColumns } from "../budgets/engine/columnAnalyzer";
import {
  cleanText,
  detectNumberFormat,
  extractFromBuffer,
  extractFromPastedText,
  parseFlexibleNumber,
} from "../budgets/engine/matrixExtractor";
import { LaborRowInput, matchLaborRows, normalizeText } from "./matcher";

/**
 * Lista de precios de mano de obra por obra: lo que la empresa paga al subcontratista por
 * unidad de cada rubro. Las mediciones de subcontratistas toman el precio de acá.
 */
export const laborPricesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function projectIdOf(raw: unknown) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
  return id;
}

async function budgetLeaves(projectId: number) {
  return prisma.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM", isSystem: false },
    select: { id: true, code: true, name: true, unit: true, unitPrice: true },
    orderBy: { sortOrder: "asc" },
  });
}

laborPricesRouter.get(
  "/projects/:id/labor-prices",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const prices = await prisma.laborPrice.findMany({
      where: { projectId },
      include: { budgetItem: { select: { id: true, code: true, name: true, unit: true, unitPrice: true } } },
      orderBy: { code: "asc" },
    });
    ok(
      res,
      prices.map((p) => {
        const sale = p.budgetItem ? moneyNumber(p.budgetItem.unitPrice) : null;
        const labor = moneyNumber(p.unitPrice);
        return {
          ...p,
          unitPrice: labor,
          salePrice: sale,
          margin: sale && sale > 0 ? (sale - labor) / sale : null,
        };
      })
    );
  })
);

/** Vista previa de una planilla de precios: lee filas y las asocia a los rubros del presupuesto. */
laborPricesRouter.post(
  "/projects/:id/labor-prices/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const workbook = req.file
      ? extractFromBuffer(req.file.buffer, req.file.originalname)
      : req.body.pastedText
      ? extractFromPastedText(String(req.body.pastedText))
      : null;
    if (!workbook || !workbook.sheets.length) {
      throw new DomainError("FILE_OR_INPUT_REQUIRED", "Subí la planilla de precios o pegá las celdas", 400);
    }
    const format = detectNumberFormat(workbook.sheets);
    const structures = workbook.sheets.map((sheet) => ({ sheet, structure: analyzeSheetStructure(sheet, format) }));
    const { sheet, structure } =
      structures.find((s) => s.sheet.sheetName === req.body.sheetName) ??
      [...structures].sort((a, b) => b.structure.detectedItemRows - a.structure.detectedItemRows)[0];
    const cols = roleColumns(structure);
    if (cols.description === undefined || (cols.unitPrice === undefined && cols.totalPrice === undefined)) {
      throw new DomainError(
        "LABOR_COLUMNS_NOT_FOUND",
        "No encontré las columnas de descripción y precio. La planilla necesita al menos: Descripción y Precio.",
        422
      );
    }

    const rows: LaborRowInput[] = [];
    for (let r = structure.headerRowIndex + 1; r < sheet.matrix.length; r++) {
      const raw = sheet.matrix[r] ?? [];
      const description = cleanText(raw[cols.description]);
      const price = parseFlexibleNumber(raw[cols.unitPrice ?? cols.totalPrice!], format);
      if (!description || price === null || price <= 0) continue; // títulos y filas vacías
      rows.push({
        code: cols.code !== undefined ? cleanText(raw[cols.code]) : "",
        description,
        unit: cols.unit !== undefined ? cleanText(raw[cols.unit]) : "",
        unitPrice: price,
      });
    }
    const matched = matchLaborRows(rows, await budgetLeaves(projectId));
    ok(res, {
      sheetName: sheet.sheetName,
      sheets: workbook.sheets.map((s) => s.sheetName),
      rows: matched,
      summary: {
        total: matched.length,
        matched: matched.filter((m) => m.budgetItemId).length,
      },
    });
  })
);

const rowSchema = z.object({
  code: z.string().max(200).default(""),
  description: z.string().min(1).max(10000),
  unit: z.string().max(100).default(""),
  unitPrice: z.coerce.number().positive(),
  budgetItemId: z.coerce.number().int().positive().nullable().optional(),
});

/** Guarda la lista (reemplaza precios con el mismo código; conserva los demás). */
laborPricesRouter.post(
  "/projects/:id/labor-prices/commit",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const { rows } = z.object({ rows: z.array(rowSchema).min(1, "No hay precios para guardar") }).parse(req.body);
    let saved = 0;
    await prisma.$transaction(
      async (tx) => {
        for (const row of rows) {
          const code = row.code.trim() || normalizeText(row.description).slice(0, 60).toUpperCase();
          await tx.laborPrice.upsert({
            where: { projectId_code: { projectId, code } },
            create: {
              projectId,
              code,
              description: row.description,
              unit: row.unit || null,
              unitPrice: row.unitPrice,
              budgetItemId: row.budgetItemId ?? null,
            },
            update: {
              description: row.description,
              unit: row.unit || null,
              unitPrice: row.unitPrice,
              budgetItemId: row.budgetItemId ?? null,
            },
          });
          saved++;
        }
      },
      { timeout: 60_000 }
    );
    ok(res, { saved }, 201);
  })
);

/** Alta o actualización de un precio suelto (ej. desde la medición cuando falta el precio). */
laborPricesRouter.post(
  "/projects/:id/labor-prices",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const body = rowSchema.parse(req.body);
    const code = body.code.trim() || normalizeText(body.description).slice(0, 60).toUpperCase();
    ok(
      res,
      await prisma.laborPrice.upsert({
        where: { projectId_code: { projectId, code } },
        create: { projectId, code, description: body.description, unit: body.unit || null, unitPrice: body.unitPrice, budgetItemId: body.budgetItemId ?? null },
        update: { description: body.description, unit: body.unit || null, unitPrice: body.unitPrice, budgetItemId: body.budgetItemId ?? null },
      }),
      201
    );
  })
);

laborPricesRouter.put(
  "/labor-prices/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.laborPrice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Precio de mano de obra", id);
    const body = rowSchema.partial().parse(req.body);
    ok(res, await prisma.laborPrice.update({ where: { id }, data: body }));
  })
);

laborPricesRouter.delete(
  "/labor-prices/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.laborPrice.delete({ where: { id } });
    ok(res, { deleted: true, id });
  })
);
