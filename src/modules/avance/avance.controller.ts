import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { audit } from "../../domain/audit";
import { today, toDay } from "../../domain/prices";
import { assertOpenPeriod, cerradoHasta, closePeriod, closingPreview, progressReport, reopenLastClosing } from "../../domain/progress";
import { invalidateCostCache } from "../../domain/costCache";
import { requireRole } from "../../middleware/requireRole";
import { usuarioDe } from "../../http/usuario";
import { costEngine } from "../../domain/costEngine";
import { parsePlanGrid } from "../../domain/planImport";
import { guardarPlan } from "../../domain/planSave";
import { clientInvoicePreview, createClientInvoice } from "../../domain/clientBilling";

/** Avance fechado por ítem (partes diarios y medición oficial), cronograma y cierres oficiales. */
export const avanceRouter = Router();

const intId = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function assertItems(projectId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  const items = await prisma.budgetItem.findMany({ where: { id: { in: unique }, projectId, nodeKind: "ITEM", isSystem: false }, select: { id: true } });
  if (items.length !== unique.length) throw new DomainError("INVALID_ITEM", "Hay ítems que no son del presupuesto de esta obra", 422);
}

/** Rango por defecto: desde el día siguiente al último cierre hasta hoy. */
async function defaultRange(projectId: number) {
  const last = await prisma.cierrePeriodo.findFirst({ where: { projectId }, orderBy: { hasta: "desc" } });
  const hasta = iso(today());
  if (!last) return { desde: `${hasta.slice(0, 8)}01`, hasta, ultimoCierre: null };
  const next = new Date(last.hasta);
  next.setUTCDate(next.getUTCDate() + 1);
  return { desde: iso(next) > hasta ? hasta : iso(next), hasta, ultimoCierre: { id: last.id, desde: iso(last.desde), hasta: iso(last.hasta) } };
}

avanceRouter.get(
  "/projects/:id/avance",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema.optional(), hasta: dateSchema.optional(), oficial: z.enum(["true", "false"]).optional() }).parse(req.query);
    const def = await defaultRange(projectId);
    const desde = q.desde ?? def.desde;
    const hasta = q.hasta ?? def.hasta;
    if (desde > hasta) throw new DomainError("INVALID_RANGE", "La fecha desde es posterior a la fecha hasta", 400);
    ok(res, { ...(await progressReport(prisma, projectId, desde, hasta, q.oficial === "true")), ultimoCierre: def.ultimoCierre });
  })
);

avanceRouter.get(
  "/projects/:id/avance/hechos",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ desde: dateSchema, hasta: dateSchema, budgetItemId: intId.optional() }).parse(req.query);
    const rows = await prisma.avanceItem.findMany({
      where: { projectId, budgetItemId: q.budgetItemId, fecha: { gte: toDay(q.desde), lte: toDay(q.hasta) } },
      include: { budgetItem: { select: { code: true, name: true, unit: true } } },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 500,
    });
    ok(res, rows.map((r) => ({ ...r, fecha: iso(r.fecha), cantidad: moneyNumber(r.cantidad) })));
  })
);

const partesSchema = z.object({
  fecha: dateSchema,
  lineas: z
    .array(z.object({ budgetItemId: intId, cantidad: z.number().refine((n) => n !== 0, "La cantidad no puede ser 0"), nota: z.string().max(300).nullish() }))
    .min(1)
    .max(500),
  createdBy: z.string().max(120).nullish(),
});

/** Parte diario: avance provisorio. La medición oficial viene del certificado al cliente. */
avanceRouter.post(
  "/projects/:id/avance/partes",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = partesSchema.parse(req.body);
    if (toDay(body.fecha) > today()) throw new DomainError("FUTURE_DATE", "El parte no puede tener fecha futura", 400);
    await assertItems(projectId, body.lineas.map((l) => l.budgetItemId));
    const created = await prisma.$transaction(async (tx) => {
      await assertOpenPeriod(tx, projectId, body.fecha, "El parte diario");
      const r = await tx.avanceItem.createMany({
        data: body.lineas.map((l) => ({
          projectId,
          budgetItemId: l.budgetItemId,
          fecha: toDay(body.fecha),
          cantidad: l.cantidad,
          origen: "PARTE_DIARIO" as const,
          nota: l.nota || null,
          createdBy: body.createdBy || null,
        })),
      });
      await audit(tx, { entity: "AvanceItem", entityId: projectId, action: "PARTE_DIARIO", payload: { fecha: body.fecha, lineas: body.lineas.length } });
      return r.count;
    });
    ok(res, { creados: created }, 201);
  })
);

avanceRouter.delete(
  "/avance/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const a = await tx.avanceItem.findUnique({ where: { id } });
      if (!a) throw new NotFoundError("Avance", id);
      if (a.origen !== "PARTE_DIARIO") {
        throw new DomainError("OFFICIAL_MEASUREMENT", "La medición oficial se corrige desde su certificado al cliente", 409);
      }
      await assertOpenPeriod(tx, a.projectId, a.fecha, "El parte diario");
      await tx.avanceItem.delete({ where: { id } });
      await audit(tx, { entity: "AvanceItem", entityId: id, action: "DELETE" });
    });
    ok(res, { deleted: true, id });
  })
);

// ─── Cronograma (avance planificado) ──────────────────────────────────────

avanceRouter.get(
  "/projects/:id/plan",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const rows = await prisma.avancePlanificado.findMany({ where: { projectId }, orderBy: [{ fecha: "asc" }] });
    ok(res, rows.map((r) => ({ id: r.id, budgetItemId: r.budgetItemId, fecha: iso(r.fecha), cantidad: moneyNumber(r.cantidad) })));
  })
);

avanceRouter.post(
  "/projects/:id/plan/preview",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const { texto } = z.object({ texto: z.string().min(1) }).parse(req.body);
    const items = await prisma.budgetItem.findMany({
      where: { projectId, nodeKind: "ITEM", isSystem: false },
      select: { id: true, code: true, path: true, totalQuantity: true },
    });
    ok(res, parsePlanGrid(texto, items.map((i) => ({ id: i.id, code: i.code, path: i.path, contrato: moneyNumber(i.totalQuantity) }))));
  })
);

const planSchema = z.object({
  /** REEMPLAZAR borra el cronograma anterior de la obra; COMBINAR solo pisa ítem+período cargados. */
  modo: z.enum(["REEMPLAZAR", "COMBINAR"]).default("COMBINAR"),
  lineas: z.array(z.object({ budgetItemId: intId, fecha: dateSchema, cantidad: z.number().min(0) })).max(20_000),
});

avanceRouter.put(
  "/projects/:id/plan",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = planSchema.parse(req.body);
    await assertItems(projectId, body.lineas.map((l) => l.budgetItemId));
    const n = await prisma.$transaction(
      async (tx) => {
        const guardados = await guardarPlan(tx, projectId, body.modo, body.lineas);
        await audit(tx, { entity: "AvancePlanificado", entityId: projectId, action: body.modo, payload: { lineas: guardados } });
        return guardados;
      },
      { timeout: 120_000 }
    );
    ok(res, { guardados: n });
  })
);

// ─── Cierres oficiales ────────────────────────────────────────────────────

avanceRouter.get(
  "/projects/:id/cierres",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const cierres = await prisma.cierrePeriodo.findMany({
      where: { projectId },
      orderBy: { hasta: "desc" },
      include: { factura: { select: { id: true, numeroFactura: true, total: true } } },
    });
    ok(
      res,
      cierres.map((c) => {
        const snap = c.snapshot as any;
        return {
          id: c.id,
          desde: iso(c.desde),
          hasta: iso(c.hasta),
          notas: c.notas,
          createdBy: c.createdBy,
          createdAt: c.createdAt,
          totales: snap?.avance?.totales ?? null,
          avisos: snap?.avisos ?? [],
          factura: c.factura ? { id: c.factura.id, numeroFactura: c.factura.numeroFactura, total: moneyNumber(c.factura.total) } : null,
        };
      })
    );
  })
);

avanceRouter.get(
  "/cierres/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    const c = await prisma.cierrePeriodo.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("Cierre", id);
    ok(res, { ...c, desde: iso(c.desde), hasta: iso(c.hasta) });
  })
);

// ─── Factura al cliente desde el cierre (medición oficial congelada) ──────

avanceRouter.get(
  "/cierres/:id/factura",
  asyncHandler(async (req, res) => {
    ok(res, await clientInvoicePreview(prisma, intId.parse(req.params.id)));
  })
);

const facturaSchema = z.object({
  numeroFactura: z.string().trim().max(30).nullish(),
  timbrado: z.string().trim().max(30).nullish(),
  fechaEmision: dateSchema.optional(),
  diasVencimiento: z.number().int().min(0).max(365).optional(),
});

avanceRouter.post(
  "/cierres/:id/factura",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    const body = facturaSchema.parse(req.body ?? {});
    const inv = await prisma.$transaction(async (tx) => {
      const created = await createClientInvoice(tx, id, { ...body, fechaEmision: body.fechaEmision ? toDay(body.fechaEmision) : undefined });
      await audit(tx, { entity: "INVOICE", entityId: created.id, action: "CREATE_FROM_CLOSING", payload: { cierreId: id, total: Number(created.total) } });
      return created;
    });
    ok(res, inv, 201);
  })
);

const cierreSchema = z.object({ desde: dateSchema, hasta: dateSchema, notas: z.string().max(1000).nullish(), createdBy: z.string().max(120).nullish() });

avanceRouter.post(
  "/projects/:id/cierres/preview",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = cierreSchema.parse(req.body);
    ok(res, await closingPreview(prisma, projectId, body.desde, body.hasta));
  })
);

avanceRouter.post(
  "/projects/:id/cierres",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = cierreSchema.parse(req.body);
    const cierre = await prisma.$transaction(
      async (tx) => {
        const costos = await costEngine(tx, projectId, body.desde, body.hasta, { soloOficial: true, sinCache: true });
        const c = await closePeriod(tx, { projectId, ...body }, { ...costos, origen: "snapshot" });
        await audit(tx, { entity: "CierrePeriodo", entityId: c.id, action: "CLOSE", payload: { desde: body.desde, hasta: body.hasta } });
        return c;
      },
      { timeout: 120_000 }
    );
    ok(res, { id: cierre.id, desde: iso(cierre.desde), hasta: iso(cierre.hasta) }, 201);
  })
);

/** Hasta qué fecha está cerrada la obra (banner "Cerrado hasta dd/mm/aaaa"). */
avanceRouter.get(
  "/projects/:id/cerrado-hasta",
  asyncHandler(async (req, res) => {
    const hasta = await cerradoHasta(prisma, intId.parse(req.params.id));
    ok(res, { hasta: hasta ? iso(hasta) : null });
  })
);

/** Reabre el último cierre oficial (solo administrador, con motivo). Los anteriores no se reabren. */
avanceRouter.post(
  "/cierres/:id/reabrir",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    const { motivo } = z.object({ motivo: z.string().trim().min(10, "Escribí el motivo de la reapertura (al menos 10 caracteres)").max(1000) }).parse(req.body ?? {});
    const usuario = usuarioDe(req) || null;
    const r = await prisma.$transaction(async (tx) => {
      const out = await reopenLastClosing(tx, id, { motivo, usuario });
      await audit(tx, {
        entity: "CierrePeriodo",
        entityId: id,
        action: "REOPEN",
        payload: { motivo, usuario, desde: out.cierre.desde, hasta: out.cierre.hasta, reaperturaId: out.archivo.id, facturaId: out.factura?.id ?? null },
      });
      return out;
    });
    invalidateCostCache();
    ok(res, {
      reaperturaId: r.archivo.id,
      cierre: r.cierre,
      avisos: r.factura ? [`La factura ${r.factura.numeroFactura} del cierre sigue vigente: al volver a cerrar se factura solo la diferencia.`] : [],
    });
  })
);
