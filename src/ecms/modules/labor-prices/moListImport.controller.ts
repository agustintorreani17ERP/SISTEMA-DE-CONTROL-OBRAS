import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { InsumoCategoria, InsumoTipo } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError } from "../../../errors/domain";
import { moneyNumber } from "../../../lib/money";
import { addPrice, precioVigente, toDay, today } from "../../../core/domain/prices";
import { MO_CATEGORY_LABEL, parseMoList } from "./moImport";

/** Importación de la lista de MO de contratistas: crea insumos de mano de obra y sus precios. */
export const moListImportRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);


type ImportStatus = "NUEVO" | "CAMBIA_PRECIO" | "ACTUALIZA_DATOS" | "SIN_CAMBIOS" | "ERROR";

moListImportRouter.post(
  "/insumos/import-mo/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const vigenteDesde = toDay(dateSchema.optional().parse(req.body.vigenteDesde || undefined) ?? today());
    const parsed = req.file
      ? parseMoList({ buffer: req.file.buffer, fileName: req.file.originalname })
      : req.body.pastedText
      ? parseMoList({ text: String(req.body.pastedText) })
      : null;
    if (!parsed) {
      throw new DomainError(
        "MO_HEADER_NOT_FOUND",
        "No encontré las columnas ITEM / DESCRIPCIÓN / UNIDAD / PRECIO en la planilla",
        400
      );
    }

    const existing = await prisma.material.findMany({
      where: { code: { in: parsed.rows.map((r) => r.code).filter(Boolean) } },
      include: { prices: true },
    });
    const byCode = new Map(existing.map((m) => [m.code, m]));

    const rows = parsed.rows.map((row) => {
      const errors = [...row.errors];
      const m = byCode.get(row.code);
      let status: ImportStatus = "NUEVO";
      let precioActual: number | null = null;
      if (m) {
        if (m.categoria !== "MANO_OBRA") errors.push("El código ya existe como insumo de otra categoría");
        const vig = precioVigente(m.prices, vigenteDesde);
        precioActual = vig ? moneyNumber(vig.price) : null;
        const priceChanges = row.price !== null && precioActual !== row.price;
        if (priceChanges && m.prices.some((p) => p.validFrom.getTime() === vigenteDesde.getTime())) {
          errors.push("Ya hay otro precio cargado con esa fecha de vigencia");
        }
        const dataChanges =
          m.description !== row.description || m.unit !== row.unit || (m.sector ?? null) !== row.sector || !m.active;
        status = priceChanges ? "CAMBIA_PRECIO" : dataChanges ? "ACTUALIZA_DATOS" : "SIN_CAMBIOS";
      }
      if (errors.length) status = "ERROR";
      return { ...row, errors, status, precioActual, insumoId: m?.id ?? null };
    });

    const count = (s: ImportStatus) => rows.filter((r) => r.status === s).length;
    ok(res, {
      sheetName: parsed.sheetName,
      vigenteDesde: isoDay(vigenteDesde),
      rows,
      summary: {
        total: rows.length,
        nuevos: count("NUEVO"),
        cambiaPrecio: count("CAMBIA_PRECIO"),
        actualizaDatos: count("ACTUALIZA_DATOS"),
        sinCambios: count("SIN_CAMBIOS"),
        errores: count("ERROR"),
      },
    });
  })
);

const commitSchema = z.object({
  vigenteDesde: dateSchema,
  fileName: z.string().optional(),
  rows: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        description: z.string().trim().min(1),
        unit: z.string().trim().min(1),
        price: z.number().min(0),
        sector: z.string().nullable(),
      })
    )
    .min(1),
});

moListImportRouter.post(
  "/insumos/import-mo/commit",
  asyncHandler(async (req, res) => {
    const body = commitSchema.parse(req.body);
    const validFrom = toDay(body.vigenteDesde);
    const source = `IMPORT:${body.fileName || "lista MO"}`;

    const result = await prisma.$transaction(
      async (tx) => {
        let creados = 0;
        let preciosNuevos = 0;
        let actualizados = 0;
        for (const row of body.rows) {
          const data = {
            description: row.description,
            unit: row.unit,
            sector: row.sector,
            tipo: InsumoTipo.DIRECTO,
            categoria: InsumoCategoria.MANO_OBRA,
            active: true,
          };
          const existing = await tx.material.findUnique({ where: { code: row.code }, include: { prices: true } });
          if (existing && existing.categoria !== "MANO_OBRA") {
            throw new DomainError("CODE_TAKEN", `${row.code} ya existe como insumo de otra categoría`, 409);
          }
          const m = existing
            ? await tx.material.update({ where: { id: existing.id }, data })
            : await tx.material.create({ data: { ...data, code: row.code, category: MO_CATEGORY_LABEL } });
          if (existing) actualizados++;
          else creados++;

          const vig = existing ? precioVigente(existing.prices, validFrom) : null;
          if (!vig || moneyNumber(vig.price) !== row.price) {
            await addPrice(tx, { materialId: m.id, price: row.price, validFrom, source });
            preciosNuevos++;
          }
        }
        return { creados, actualizados, preciosNuevos };
      },
      { timeout: 60_000 }
    );
    ok(res, result);
  })
);
