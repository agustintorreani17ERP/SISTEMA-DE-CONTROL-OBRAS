import { Router } from "express";
import { z } from "zod";
import { InsumoCategoria, InsumoTipo, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { moneyNumber } from "../../../lib/money";
import { addPrice, precioVigente, toDay, today } from "../../../core/domain/prices";

/**
 * Catálogo de insumos (tabla Material) con historial de precios por vigencia. Se edita en el ERP;
 * el ECMS solo lo usa. La importación de la lista de MO de contratistas es del ECMS
 * (ecms/modules/labor-prices/moListImport.controller.ts).
 */
export const insumosRouter = Router();

const tipoSchema = z.nativeEnum(InsumoTipo);
const categoriaSchema = z.nativeEnum(InsumoCategoria);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const idOf = (raw: unknown) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_ID", "Identificador inválido");
  return id;
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type MaterialWithPrices = Prisma.MaterialGetPayload<{ include: { prices: true } }>;

function present(m: MaterialWithPrices, fecha: Date) {
  const { prices, ...rest } = m;
  const vigente = precioVigente(prices, fecha);
  const proximo = prices
    .filter((p) => p.validFrom.getTime() > fecha.getTime())
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())[0];
  return {
    ...rest,
    estimatedCost: moneyNumber(m.estimatedCost),
    toleranciaPct: moneyNumber(m.toleranciaPct),
    consumoLh: m.consumoLh === null ? null : moneyNumber(m.consumoLh),
    precio: vigente ? moneyNumber(vigente.price) : null,
    vigenteDesde: vigente ? isoDay(vigente.validFrom) : null,
    proximoPrecio: proximo ? { precio: moneyNumber(proximo.price), desde: isoDay(proximo.validFrom) } : null,
    cantidadPrecios: prices.length,
  };
}

insumosRouter.get(
  "/insumos",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        tipo: tipoSchema.optional(),
        categoria: categoriaSchema.optional(),
        q: z.string().optional(),
        fecha: dateSchema.optional(),
        inactivos: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    const fecha = q.fecha ? toDay(q.fecha) : today();
    const text = q.q?.trim();
    const items = await prisma.material.findMany({
      where: {
        tipo: q.tipo,
        categoria: q.categoria,
        active: q.inactivos === "true" ? undefined : true,
        OR: text
          ? [
              { code: { contains: text, mode: "insensitive" } },
              { description: { contains: text, mode: "insensitive" } },
              { category: { contains: text, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: { prices: true },
      orderBy: { code: "asc" },
    });
    ok(res, items.map((m) => present(m, fecha)));
  })
);

const createSchema = z.object({
  code: z.string().trim().min(1),
  description: z.string().trim().min(2),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  tipo: tipoSchema,
  categoria: categoriaSchema,
  sector: z.string().trim().nullable().optional(),
  toleranciaPct: z.number().min(0).max(1000).default(0),
  consumoLh: z.number().positive().max(10_000).nullable().optional(),
  precio: z.number().min(0),
  vigenteDesde: dateSchema.optional(),
});

insumosRouter.post(
  "/insumos",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (await prisma.material.findUnique({ where: { code: body.code } })) {
      throw new DomainError("CODE_TAKEN", `Ya existe un insumo con código ${body.code}`, 409);
    }
    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.material.create({
        data: {
          code: body.code,
          description: body.description,
          unit: body.unit,
          category: body.category || "GENERAL",
          tipo: body.tipo,
          categoria: body.categoria,
          sector: body.sector || null,
          toleranciaPct: body.toleranciaPct,
          consumoLh: body.consumoLh ?? null,
        },
      });
      await addPrice(tx, { materialId: m.id, price: body.precio, validFrom: body.vigenteDesde ?? today(), source: "MANUAL" });
      return tx.material.findUniqueOrThrow({ where: { id: m.id }, include: { prices: true } });
    });
    ok(res, present(created, today()), 201);
  })
);

const patchSchema = z
  .object({
    code: z.string().trim().min(1),
    description: z.string().trim().min(2),
    unit: z.string().trim().min(1),
    category: z.string().trim().min(1),
    tipo: tipoSchema,
    categoria: categoriaSchema,
    sector: z.string().trim().nullable(),
    toleranciaPct: z.number().min(0).max(1000),
    consumoLh: z.number().positive().max(10_000).nullable(),
    active: z.boolean(),
  })
  .partial()
  .strict();

insumosRouter.patch(
  "/insumos/:id",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const body = patchSchema.parse(req.body);
    const existing = await prisma.material.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Insumo", id);
    if (body.code && body.code !== existing.code && (await prisma.material.findUnique({ where: { code: body.code } }))) {
      throw new DomainError("CODE_TAKEN", `Ya existe un insumo con código ${body.code}`, 409);
    }
    const updated = await prisma.material.update({
      where: { id },
      data: { ...body, sector: body.sector === "" ? null : body.sector },
      include: { prices: true },
    });
    ok(res, present(updated, today()));
  })
);

insumosRouter.get(
  "/insumos/:id/precios",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const prices = await prisma.materialPrice.findMany({ where: { materialId: id }, orderBy: { validFrom: "desc" } });
    ok(
      res,
      prices.map((p) => ({ ...p, price: moneyNumber(p.price), validFrom: isoDay(p.validFrom) }))
    );
  })
);

insumosRouter.post(
  "/insumos/:id/precios",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const body = z.object({ precio: z.number().min(0), vigenteDesde: dateSchema }).parse(req.body);
    if (!(await prisma.material.findUnique({ where: { id } }))) throw new NotFoundError("Insumo", id);
    const created = await prisma.$transaction((tx) =>
      addPrice(tx, { materialId: id, price: body.precio, validFrom: body.vigenteDesde, source: "MANUAL" })
    );
    ok(res, { ...created, price: moneyNumber(created.price), validFrom: isoDay(created.validFrom) }, 201);
  })
);
