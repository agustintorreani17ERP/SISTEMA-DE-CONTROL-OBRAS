import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { InsumoCategoria, InsumoTipo, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { addPrice, today } from "../../domain/prices";
import { MO_CATEGORY_LABEL, parseMoList } from "../insumos/moImport";
import { laborRowsFromParsed, moInsumoCode, planInsumoPrice } from "./laborImport";

/**
 * Lista de precios de mano de obra por obra: catálogo de lo que la empresa paga al subcontratista
 * por unidad (código, descripción, unidad, precio y sector). El rubro del presupuesto se asigna en
 * cada medición de subcontratista. Cada precio se refleja en el insumo MO-<código> para el libro mayor.
 */
export const laborPricesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function projectIdOf(raw: unknown) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
  return id;
}

interface CatalogRow {
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  sector: string | null;
}

/**
 * Crea o actualiza el insumo MO-<código> (MANO_OBRA) y abre vigencia de precio desde `validFrom`
 * si cambió. Devuelve si cargó un precio nuevo o si había otro precio con esa fecha.
 */
async function syncMoInsumo(tx: Prisma.TransactionClient, row: CatalogRow, validFrom: Date, source: string) {
  const code = moInsumoCode(row.code);
  const existing = await tx.material.findUnique({ where: { code }, include: { prices: true } });
  if (existing && existing.categoria !== "MANO_OBRA") {
    throw new DomainError("CODE_TAKEN", `${code} ya existe como insumo de otra categoría`, 409);
  }
  const data = {
    description: row.description,
    unit: row.unit || existing?.unit || "un",
    sector: row.sector,
    tipo: InsumoTipo.DIRECTO,
    categoria: InsumoCategoria.MANO_OBRA,
    active: true,
  };
  const m = existing
    ? await tx.material.update({ where: { id: existing.id }, data })
    : await tx.material.create({ data: { ...data, code, category: MO_CATEGORY_LABEL } });
  const plan = planInsumoPrice(existing?.prices ?? [], row.unitPrice, validFrom);
  if (plan === "NUEVO_PRECIO") await addPrice(tx, { materialId: m.id, price: row.unitPrice, validFrom, source });
  return plan;
}

laborPricesRouter.get(
  "/projects/:id/labor-prices",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const prices = await prisma.laborPrice.findMany({ where: { projectId }, orderBy: { code: "asc" } });
    ok(
      res,
      prices.map(({ budgetItemId: _legacy, ...p }) => ({ ...p, unitPrice: moneyNumber(p.unitPrice) }))
    );
  })
);

/** Vista previa de una planilla de precios: código, descripción, unidad, precio y sector. */
laborPricesRouter.post(
  "/projects/:id/labor-prices/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    projectIdOf(req.params.id);
    if (!req.file && !req.body.pastedText) {
      throw new DomainError("FILE_OR_INPUT_REQUIRED", "Subí la planilla de precios o pegá las celdas", 400);
    }
    const parsed = req.file
      ? parseMoList({ buffer: req.file.buffer, fileName: req.file.originalname })
      : parseMoList({ text: String(req.body.pastedText) });
    if (!parsed) {
      throw new DomainError(
        "LABOR_COLUMNS_NOT_FOUND",
        "No encontré las columnas ITEM / DESCRIPCIÓN / UNIDAD / PRECIO en la planilla",
        422
      );
    }
    const rows = laborRowsFromParsed(parsed);
    ok(res, {
      sheetName: parsed.sheetName,
      rows,
      summary: { total: rows.length, errores: rows.filter((r) => r.errors.length).length },
    });
  })
);

const rowSchema = z.object({
  code: z.string().trim().min(1, "Falta el código").max(200),
  description: z.string().trim().min(1).max(10000),
  unit: z.string().trim().max(100).default(""),
  unitPrice: z.coerce.number().positive(),
  sector: z.string().trim().max(60).nullable().optional(),
});

/**
 * Guarda la lista (reemplaza precios con el mismo código; conserva los demás) y crea o actualiza
 * los insumos MO-<código> con precio vigente desde hoy.
 */
laborPricesRouter.post(
  "/projects/:id/labor-prices/commit",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const body = z
      .object({ rows: z.array(rowSchema).min(1, "No hay precios para guardar"), fileName: z.string().optional() })
      .parse(req.body);
    const validFrom = today();
    const source = `LISTA_MO:${projectId}:${body.fileName || "planilla"}`;
    const result = await prisma.$transaction(
      async (tx) => {
        let saved = 0;
        let preciosInsumo = 0;
        const conflictos: string[] = [];
        for (const row of body.rows) {
          const data = { description: row.description, unit: row.unit || null, unitPrice: row.unitPrice, sector: row.sector ?? null };
          await tx.laborPrice.upsert({
            where: { projectId_code: { projectId, code: row.code } },
            create: { projectId, code: row.code, ...data },
            update: data,
          });
          saved++;
          const plan = await syncMoInsumo(tx, { ...row, sector: row.sector ?? null }, validFrom, source);
          if (plan === "NUEVO_PRECIO") preciosInsumo++;
          if (plan === "CONFLICTO_FECHA") conflictos.push(moInsumoCode(row.code));
        }
        return { saved, preciosInsumo, conflictos };
      },
      { timeout: 60_000 }
    );
    ok(res, result, 201);
  })
);

/** Alta o actualización de un precio suelto. */
laborPricesRouter.post(
  "/projects/:id/labor-prices",
  asyncHandler(async (req, res) => {
    const projectId = projectIdOf(req.params.id);
    const row = rowSchema.parse(req.body);
    const data = { description: row.description, unit: row.unit || null, unitPrice: row.unitPrice, sector: row.sector ?? null };
    const saved = await prisma.$transaction(async (tx) => {
      const p = await tx.laborPrice.upsert({
        where: { projectId_code: { projectId, code: row.code } },
        create: { projectId, code: row.code, ...data },
        update: data,
      });
      await syncMoInsumo(tx, { ...row, sector: data.sector }, today(), `LISTA_MO:${projectId}`);
      return p;
    });
    ok(res, saved, 201);
  })
);

laborPricesRouter.put(
  "/labor-prices/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.laborPrice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Precio de mano de obra", id);
    const body = rowSchema.omit({ code: true }).partial().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.laborPrice.update({ where: { id }, data: body });
      await syncMoInsumo(
        tx,
        { code: p.code, description: p.description, unit: p.unit ?? "", unitPrice: moneyNumber(p.unitPrice), sector: p.sector },
        today(),
        `LISTA_MO:${p.projectId}`
      );
      return p;
    });
    ok(res, updated);
  })
);

laborPricesRouter.delete(
  "/labor-prices/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const lineas = await prisma.subPlanillaLinea.count({ where: { laborPriceId: id } });
    if (lineas) throw new DomainError("LABOR_PRICE_IN_USE", `El rubro de MO está en ${lineas} línea(s) de planillas de subcontratistas: no se puede borrar`, 409);
    await prisma.laborPrice.delete({ where: { id } });
    ok(res, { deleted: true, id });
  })
);
