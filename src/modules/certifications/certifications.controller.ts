import { CertificacionEstado, Prisma } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { parseBudgetWorkbook } from "./budgetImport";

export const certificationsRouter = Router();
const budgetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type ImportIssue = {
  row: number;
  item?: string;
  field: string;
  message: string;
};

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedHeader(value: unknown) {
  return normalizedText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Converts common Excel currency formats such as "$ 1.234,56" and "1,234.56". */
function normalizedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = normalizedText(value);
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text.replace(/[()]/g, "").replace(/[^\d,.-]/g, "").replace(/-/g, "");
  if (!text || !/[\d]/.test(text)) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? /\./g : /,/g;
    text = text.replace(thousandsSeparator, "").replace(decimalSeparator, ".");
  } else if (comma >= 0) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if ((text.match(/\./g) ?? []).length > 1) {
    const parts = text.split(".");
    const last = parts.pop() ?? "";
    text = parts.join("") + (last.length === 3 ? last : `.${last}`);
  } else if (dot >= 0 && text.split(".")[1]?.length === 3) {
    text = text.replace(".", "");
  } else if (dot >= 0 && text.endsWith(".")) {
    text = text.slice(0, -1);
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function firstField(fields: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = fields[normalizedHeader(name)];
    if (value !== undefined && normalizedText(value) !== "") return value;
  }
  return undefined;
}

function importIssue(row: number, field: string, message: string, item?: string): ImportIssue {
  return { row, field, message, ...(item ? { item } : {}) };
}

certificationsRouter.post(
  "/presupuesto/previsualizar",
  budgetUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new DomainError("FILE_REQUIRED", "Debés adjuntar un archivo Excel o CSV");
    try {
      ok(res, parseBudgetWorkbook(req.file.buffer));
    } catch (error) {
      throw new DomainError("INVALID_IMPORT_DATA", error instanceof Error ? error.message : "No se pudo interpretar el archivo", 422);
    }
  })
);

certificationsRouter.get(
  "/presupuesto/arbol",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de la obra no es válido");
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, code: true } });
    if (!project) throw new NotFoundError("Obra", projectId);
    const [costCenters, budgetItems] = await Promise.all([
      prisma.costCenter.findMany({ where: { projectId }, orderBy: [{ level: "asc" }, { code: "asc" }] }),
      prisma.budgetItem.findMany({ where: { projectId }, orderBy: { path: "asc" } }),
    ]);
    ok(res, { project, costCenters, budgetItems });
  })
);

certificationsRouter.post(
  "/presupuesto/importar",
  budgetUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new DomainError("FILE_REQUIRED", "Debés adjuntar un archivo Excel o CSV");
    const projectId = Number(req.body.projectId);
    const montoContractualManual = Number(req.body.montoContractualManual);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isFinite(montoContractualManual) || montoContractualManual <= 0) {
      throw new DomainError("INVALID_IMPORT_DATA", "La obra y el monto contractual son obligatorios");
    }
    let parsed;
    try {
      parsed = parseBudgetWorkbook(req.file.buffer);
    } catch (error) {
      throw new DomainError("INVALID_IMPORT_DATA", error instanceof Error ? error.message : "No se pudo interpretar el archivo", 422);
    }
    const duplicateCodes = parsed.warnings.filter((warning) => warning.message.startsWith("Código repetido"));
    if (duplicateCodes.length) {
      throw new DomainError("DUPLICATE_BUDGET_CODE", "Hay códigos de partida duplicados en el archivo", 422, duplicateCodes);
    }

    const imported = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new NotFoundError("Obra", projectId);
      const costCenters = new Map<string, number>();
      const budgetItems = new Map<string, number>();
      const centerNames = new Map(parsed.rows.map((row) => [row.path, row.name]));
      const ensureCostCenter = async (path: string, level: number): Promise<number> => {
        const existing = costCenters.get(path);
        if (existing) return existing;
        const parentPath = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : null;
        const parentId = parentPath ? await ensureCostCenter(parentPath, Math.max(level - 1, 0)) : undefined;
        const center = await tx.costCenter.upsert({
          where: { projectId_code: { projectId, code: path } },
          create: { projectId, parentId, code: path, name: centerNames.get(path) ?? path, level },
          update: { parentId, name: centerNames.get(path) ?? path, level },
        });
        costCenters.set(path, center.id);
        return center.id;
      };
      for (const row of parsed.rows) {
        const costCenterId = row.nodeKind === "AGREGADO" ? undefined : await ensureCostCenter(row.parentPath ?? row.path, row.parentPath ? row.hierarchyLevel - 1 : row.hierarchyLevel);
        const parentId = row.parentPath ? budgetItems.get(row.parentPath) : undefined;
        await tx.budgetItem.upsert({
          where: { projectId_code: { projectId, code: row.code } },
          create: {
            projectId, code: row.code, name: row.name, category: row.category, unit: row.unit,
            totalQuantity: row.quantity, unitPrice: row.unitPrice, originalAmount: row.originalAmount,
            parentId, path: row.path, hierarchyLevel: row.hierarchyLevel,
            nodeKind: row.nodeKind, noCotiza: row.noCotiza, unitReview: row.unitReview, unitSuggestion: row.unitSuggestion,
            sourceSheet: row.sheet, sourceRow: row.rowNumber, costCenterId,
          },
          update: {
            name: row.name, category: row.category, unit: row.unit, totalQuantity: row.quantity, unitPrice: row.unitPrice,
            originalAmount: row.originalAmount, path: row.path, hierarchyLevel: row.hierarchyLevel, nodeKind: row.nodeKind,
            noCotiza: row.noCotiza, unitReview: row.unitReview, unitSuggestion: row.unitSuggestion,
            sourceSheet: row.sheet, sourceRow: row.rowNumber, costCenterId,
          },
        });
        const saved = await tx.budgetItem.findUnique({ where: { projectId_code: { projectId, code: row.code } }, select: { id: true } });
        if (saved) budgetItems.set(row.path, saved.id);
      }
      await tx.project.update({ data: { montoContractualManual, globalBudget: montoContractualManual }, where: { id: projectId } });
      const totals = await recalculateProjectFinancials(tx, projectId);
      return { rows: parsed.rows.length, warnings: parsed.warnings, mapping: parsed.mapping, sheets: parsed.sheets, project: totals };
    });
    ok(res, imported, 201);
  })
);

const certificationSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  partnerId: z.coerce.number().int().positive().optional(),
  budgetItemId: z.coerce.number().int().positive().optional(),
  subcontratista: z.string().trim().min(1).max(160).optional(),
  rubro: z.string().trim().min(1).max(240),
  unidad: z.string().trim().min(1).max(40).optional(),
  cantidad_medida: z.coerce.number().finite().nonnegative(),
  monto_total: z.coerce.number().finite().nonnegative(),
  estado: z.nativeEnum(CertificacionEstado).optional(),
  evidencia: z.string().trim().max(500).optional(),
  esAdenda: z.coerce.boolean().optional(),
});

const certificationInclude = {
  project: true,
  partner: true,
  budgetItem: true,
} satisfies Prisma.CertificacionInclude;

certificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.certificacion.findMany({
        where: { projectId },
        include: certificationInclude,
        orderBy: { id: "desc" },
      })
    );
  })
);

certificationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = certificationSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      if (body.projectId) {
        const project = await tx.project.findUnique({ where: { id: body.projectId } });
        if (!project) throw new NotFoundError("Obra", body.projectId);
      }

      if (body.partnerId) {
        const partner = await tx.partner.findUnique({ where: { id: body.partnerId } });
        if (!partner) throw new NotFoundError("Subcontratista", body.partnerId);
        if (partner.kind === "SUPPLIER") {
          throw new DomainError("INVALID_PARTNER", "El partner debe ser subcontratista o mixto");
        }
      }

      if (body.budgetItemId) {
        const item = await tx.budgetItem.findUnique({ where: { id: body.budgetItemId } });
        if (!item) throw new NotFoundError("Rubro presupuestario", body.budgetItemId);
        if (body.projectId && item.projectId !== body.projectId) {
          throw new DomainError("BUDGET_ITEM_MISMATCH", "El rubro no pertenece a la obra seleccionada");
        }
      }

      const created = await tx.certificacion.create({
        data: {
          projectId: body.projectId,
          partnerId: body.partnerId,
          budgetItemId: body.budgetItemId,
          subcontratista: body.subcontratista,
          rubro: body.rubro,
          unidad: body.unidad,
          cantidad_medida: body.cantidad_medida,
          monto_total: body.monto_total,
          estado: body.estado ?? CertificacionEstado.EN_REVISION,
          evidencia: body.evidencia,
          esAdenda: body.esAdenda ?? false,
        },
        include: certificationInclude,
      });

      // Update budget item executed quantity and amount
      if (body.budgetItemId) {
        await tx.budgetItem.update({
          where: { id: body.budgetItemId },
          data: {
            executedAmount: { increment: body.monto_total },
            executedQuantity: { increment: body.cantidad_medida },
          },
        });
      }

      if (created.projectId) {
        await recalculateProjectFinancials(tx, created.projectId);
      }
      return created;
    });

    ok(res, created, 201);
  })
);

certificationsRouter.put(
  "/:id/estado",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { estado } = req.body;
    if (!estado) throw new DomainError("INVALID_STATUS", "El estado es requerido");

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.certificacion.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Certificación", id);

      const cert = await tx.certificacion.update({
        where: { id },
        data: { estado: estado as CertificacionEstado },
        include: certificationInclude,
      });

      if (cert.projectId) {
        await recalculateProjectFinancials(tx, cert.projectId);
      }

      return cert;
    });

    ok(res, updated);
  })
);

certificationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.certificacion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Certificación", id);

    await prisma.$transaction(async (tx) => {
      if (existing.budgetItemId) {
        await tx.budgetItem.update({
          where: { id: existing.budgetItemId },
          data: {
            executedAmount: { decrement: existing.monto_total },
            executedQuantity: { decrement: existing.cantidad_medida },
          },
        });
      }
      await tx.certificacion.delete({ where: { id } });
      if (existing.projectId) {
        await recalculateProjectFinancials(tx, existing.projectId);
      }
    });

    ok(res, { deleted: true, id });
  })
);

// Save approved budget items directly from the interactive importer preview
const approvedItemsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  markupPercent: z.coerce.number().default(0),
  items: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      category: z.string().optional().default("GENERAL"),
      unit: z.string().optional().default("un"),
      quantity: z.coerce.number().default(1),
      unitPrice: z.coerce.number().default(0),
      originalAmount: z.coerce.number().default(0),
    })
  ),
});

certificationsRouter.post(
  "/presupuesto/guardar-aprobado",
  asyncHandler(async (req, res) => {
    const body = approvedItemsSchema.parse(req.body);
    const { projectId, markupPercent, items } = body;

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new NotFoundError("Obra", projectId);

      let grandTotal = 0;
      const savedItems = [];

      for (const item of items) {
        const factor = 1 + (markupPercent || 0) / 100;
        const adjustedUnitPrice = Math.round(Number(item.unitPrice) * factor);
        const adjustedOriginal = Math.round(
          item.originalAmount ? Number(item.originalAmount) * factor : Number(item.quantity) * adjustedUnitPrice
        );
        grandTotal += adjustedOriginal;

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
            name: item.name.trim(),
            category: item.category || "GENERAL",
            unit: item.unit || "un",
            totalQuantity: item.quantity,
            unitPrice: adjustedUnitPrice,
            originalAmount: adjustedOriginal,
            committedAmount: 0,
            executedAmount: 0,
          },
          update: {
            name: item.name.trim(),
            category: item.category || "GENERAL",
            unit: item.unit || "un",
            totalQuantity: item.quantity,
            unitPrice: adjustedUnitPrice,
            originalAmount: adjustedOriginal,
          },
        });
        savedItems.push(upserted);
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          globalBudget: grandTotal > 0 ? grandTotal : project.globalBudget,
          montoContractualManual: grandTotal > 0 ? grandTotal : project.montoContractualManual,
          montoRealActualizado: grandTotal > 0 ? grandTotal : project.montoRealActualizado,
        },
      });

      return {
        count: savedItems.length,
        grandTotal,
        items: savedItems,
      };
    });

    ok(res, result, 201);
  })
);

certificationsRouter.post(
  "/import-budget",
  budgetUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new DomainError("FILE_REQUIRED", "Debés adjuntar un archivo Excel o CSV");
    const projectId = req.body.projectId ? Number(req.body.projectId) : 1;
    let parsed;
    try {
      parsed = parseBudgetWorkbook(req.file.buffer);
    } catch (error) {
      throw new DomainError("INVALID_IMPORT_DATA", error instanceof Error ? error.message : "Error al procesar", 422);
    }

    const saved = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const row of parsed.rows) {
        total += Number(row.originalAmount || 0);
        await tx.budgetItem.upsert({
          where: { projectId_code: { projectId, code: row.code } },
          create: {
            projectId,
            code: row.code,
            name: row.name,
            category: row.category || "GENERAL",
            unit: row.unit || "un",
            totalQuantity: row.quantity,
            unitPrice: row.unitPrice,
            originalAmount: row.originalAmount,
            committedAmount: 0,
            executedAmount: 0,
          },
          update: {
            name: row.name,
            category: row.category || "GENERAL",
            unit: row.unit || "un",
            totalQuantity: row.quantity,
            unitPrice: row.unitPrice,
            originalAmount: row.originalAmount,
          },
        });
      }
      return { rowsCount: parsed.rows.length, total };
    });

    ok(res, { success: true, ...saved, parsed });
  })
);
