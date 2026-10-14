import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { moneyNumber } from "../../../lib/money";
import { usuarioDe } from "../../../http/usuario";
import {
  actualizarAdendaBorrador,
  anularAdenda,
  aprobarAdenda,
  congelarPresupuesto,
  crearAdenda,
  eliminarAdendaBorrador,
  presupuestoCongelado,
} from "../../domain/adendas";
import { previstoEjecutado } from "../../domain/previstoEjecutado";

/** Presupuesto original congelado, adendas (cambian cantidades) y planilla Previsto vs Ejecutado. */
export const adendasRouter = Router();

const intId = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

const lineaSchema = z.object({
  tipo: z.enum(["VARIACION", "EXTRA"]).default("VARIACION"),
  budgetItemId: intId.nullish(),
  deltaQuantity: z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, "La cantidad no puede ser 0"),
  nota: z.string().max(300).nullish(),
  codigo: z.string().trim().max(60).nullish(),
  nombre: z.string().trim().max(500).nullish(),
  unidad: z.string().trim().max(40).nullish(),
  parentId: intId.nullish(),
  precioUnitario: z.coerce.number().nonnegative().nullish(),
});

const adendaSchema = z.object({
  titulo: z.string().trim().min(3, "Poné un título para la adenda").max(200),
  motivo: z.string().trim().max(2000).nullish(),
  resolucion: z.string().trim().max(200).nullish(),
  fecha: dateSchema,
  lineas: z.array(lineaSchema).min(1, "La adenda necesita al menos una línea").max(500),
});

const lineaInclude = { budgetItem: { select: { id: true, code: true, name: true, unit: true } } };

/** Congela el presupuesto actual como contrato original (cantidad y monto por ítem). */
adendasRouter.post(
  "/projects/:id/presupuesto/congelar",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    ok(res, await prisma.$transaction((tx) => congelarPresupuesto(tx, projectId)));
  })
);

adendasRouter.get(
  "/projects/:id/adendas",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new NotFoundError("Obra", projectId);
    const [congelado, adendas] = await Promise.all([
      presupuestoCongelado(prisma, projectId),
      prisma.adenda.findMany({ where: { projectId }, orderBy: { numero: "desc" } }),
    ]);
    const lineas = adendas.length
      ? await prisma.adendaLinea.findMany({ where: { adendaId: { in: adendas.map((a) => a.id) } }, include: lineaInclude, orderBy: { id: "asc" } })
      : [];
    ok(res, {
      congelado,
      adendas: adendas.map((a) => ({
        ...a,
        fecha: a.fecha.toISOString().slice(0, 10),
        lineas: lineas
          .filter((l) => l.adendaId === a.id)
          .map((l) => ({ ...l, deltaQuantity: moneyNumber(l.deltaQuantity), precioUnitario: l.precioUnitario === null ? null : moneyNumber(l.precioUnitario) })),
      })),
    });
  })
);

adendasRouter.post(
  "/projects/:id/adendas",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const body = adendaSchema.parse(req.body);
    const usuario = usuarioDe(req);
    const created = await prisma.$transaction((tx) => crearAdenda(tx, projectId, { ...body, createdBy: usuario || null }));
    ok(res, created, 201);
  })
);

adendasRouter.put(
  "/adendas/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    const body = adendaSchema.parse(req.body);
    ok(res, await prisma.$transaction((tx) => actualizarAdendaBorrador(tx, id, body)));
  })
);

adendasRouter.delete(
  "/adendas/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    await prisma.$transaction((tx) => eliminarAdendaBorrador(tx, id));
    ok(res, { deleted: true, id });
  })
);

adendasRouter.post(
  "/adendas/:id/aprobar",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    ok(res, await prisma.$transaction((tx) => aprobarAdenda(tx, id, { usuario: usuarioDe(req) || undefined })));
  })
);

adendasRouter.post(
  "/adendas/:id/anular",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    ok(res, await prisma.$transaction((tx) => anularAdenda(tx, id, { usuario: usuarioDe(req) || undefined })));
  })
);

/** Planilla general: contractual, adendas, real y ejecutada por ítem, a la fecha `al` (por defecto hoy). */
adendasRouter.get(
  "/projects/:id/previsto-ejecutado",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = z.object({ al: dateSchema.optional() }).parse(req.query);
    if (q.al && Number.isNaN(new Date(`${q.al}T00:00:00Z`).getTime())) throw new DomainError("INVALID_DATE", "Fecha inválida", 400);
    ok(res, await previstoEjecutado(prisma, projectId, q.al));
  })
);
