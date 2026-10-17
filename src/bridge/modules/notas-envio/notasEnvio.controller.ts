import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { usuarioDe } from "../../../http/usuario";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { anularNota, crearNota, recibirNota } from "../../domain/notasEnvio";
import { SISTEMA_DE_DESTINO } from "../../domain/notasEnvioMath";

/**
 * Notas de envío. Las usan el ERP (oficina) y el ECMS (obra): el cliente indica con `sistema` desde
 * cuál actúa. Las del Taller llegan por /api/integracion.
 */
export const notasEnvioRouter = Router();

const sistemaSchema = z.enum(["ERP", "ECMS"]);
const lugarSchema = z.enum(["OFICINA", "OBRA", "TALLER"]);
const isoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const idOf = (raw: unknown) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_ID", "Identificador inválido");
  return id;
};
const optId = z.number().int().positive().nullish();

const lineaSchema = z.object({
  kind: z.enum(["PEDIDO", "OC", "RECEPCION", "SF", "CERTIFICADO", "FACTURA", "REMITO", "MATERIAL", "MANUAL"]),
  materialRequestId: optId,
  purchaseOrderId: optId,
  solicitudFondoId: optId,
  certificationId: optId,
  invoiceId: optId,
  materialId: optId,
  descripcion: z.string().nullish(),
  cantidad: z.number().nullish(),
  unidad: z.string().nullish(),
});

const crearSchema = z.object({
  sistema: sistemaSchema,
  fecha: isoSchema,
  origenTipo: lugarSchema,
  origenProjectId: optId,
  destinoTipo: lugarSchema,
  destinoProjectId: optId,
  contenido: z.enum(["DOCUMENTOS", "MATERIALES"]),
  chofer: z.string().nullish(),
  observaciones: z.string().nullish(),
  lineas: z.array(lineaSchema),
});

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const include = {
  lineas: { orderBy: { position: "asc" as const } },
  origenProject: { select: { id: true, code: true, name: true } },
  destinoProject: { select: { id: true, code: true, name: true } },
} satisfies Prisma.NotaEnvioInclude;

type NotaRow = Prisma.NotaEnvioGetPayload<{ include: typeof include }>;

function present(n: NotaRow) {
  return {
    ...n,
    fecha: isoDay(n.fecha),
    recibidoFecha: isoDay(n.recibidoFecha),
    etiqueta: `${n.numero}/${n.anio}`,
    /** Sistema que tiene que recibirla. */
    recibeSistema: SISTEMA_DE_DESTINO[n.destinoTipo],
    lineas: n.lineas.map((l) => ({ ...l, cantidad: l.cantidad == null ? null : Number(l.cantidad) })),
  };
}

/**
 * Lista de notas. `vista`:
 *  - emitidas: las que emitió `sistema`;
 *  - por-recibir: dirigidas a `sistema` y todavía ENVIADAS;
 *  - todas: ambas (default).
 * Con `projectId` solo las que salen o llegan a esa obra.
 */
notasEnvioRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        sistema: sistemaSchema,
        vista: z.enum(["emitidas", "por-recibir", "todas"]).default("todas"),
        projectId: z.coerce.number().int().positive().optional(),
        estado: z.enum(["ENVIADA", "RECIBIDA", "ANULADA"]).optional(),
      })
      .parse(req.query);

    const destinoLugar = q.sistema === "ERP" ? "OFICINA" : "OBRA";
    const emitidas: Prisma.NotaEnvioWhereInput = { sistemaOrigen: q.sistema };
    const porRecibir: Prisma.NotaEnvioWhereInput = { destinoTipo: destinoLugar, estado: "ENVIADA" };
    const where: Prisma.NotaEnvioWhereInput = {
      AND: [
        q.vista === "emitidas" ? emitidas : q.vista === "por-recibir" ? porRecibir : { OR: [emitidas, { destinoTipo: destinoLugar }] },
        q.projectId ? { OR: [{ origenProjectId: q.projectId }, { destinoProjectId: q.projectId }] } : {},
        q.estado ? { estado: q.estado } : {},
      ],
    };
    const rows = await prisma.notaEnvio.findMany({ where, include, orderBy: [{ fecha: "desc" }, { id: "desc" }], take: 500 });
    ok(res, rows.map(present));
  })
);

/** Documentos de la obra que se pueden adjuntar a una nota (los que no están ya en una nota vigente). */
notasEnvioRouter.get(
  "/documentos",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        kind: z.enum(["PEDIDO", "OC", "SF", "CERTIFICADO", "FACTURA"]),
        projectId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const proyecto = q.projectId ? { projectId: q.projectId } : {};

    let out: { id: number; label: string }[] = [];
    if (q.kind === "PEDIDO") {
      const rows = await prisma.materialRequest.findMany({ where: { ...proyecto, status: { not: "ANULADO" } }, orderBy: { id: "desc" }, take: 200 });
      out = rows.map((r) => ({ id: r.id, label: `Pedido ${r.number}` }));
    } else if (q.kind === "OC") {
      const rows = await prisma.purchaseOrder.findMany({ where: { ...proyecto, status: { not: "ANULADO" } }, include: { partner: true }, orderBy: { id: "desc" }, take: 200 });
      out = rows.map((r) => ({ id: r.id, label: `OC ${r.number} · ${r.partner.name}` }));
    } else if (q.kind === "SF") {
      const rows = await prisma.solicitudFondo.findMany({ where: { ...proyecto, estado: { not: "ANULADA" } }, include: { partner: true }, orderBy: { id: "desc" }, take: 200 });
      out = rows.map((r) => ({ id: r.id, label: `SF ${r.numero}/${r.anio} · ${r.partner.name}` }));
    } else if (q.kind === "CERTIFICADO") {
      const rows = await prisma.certification.findMany({ where: { ...proyecto, estado: "APROBADO" }, include: { partner: true }, orderBy: { id: "desc" }, take: 200 });
      out = rows.map((r) => ({ id: r.id, label: `Certificado N° ${r.numero}${r.partner ? ` · ${r.partner.name}` : " · cliente"}` }));
    } else {
      const rows = await prisma.invoice.findMany({ where: { ...proyecto, estado: { not: "ANULADA" } }, orderBy: { id: "desc" }, take: 200 });
      out = rows.map((r) => ({ id: r.id, label: `Factura ${r.numeroFactura}` }));
    }

    // Los que ya están en una nota vigente no se ofrecen
    const campo = { PEDIDO: "materialRequestId", OC: "purchaseOrderId", SF: "solicitudFondoId", CERTIFICADO: "certificationId", FACTURA: "invoiceId" }[q.kind];
    const usados = await prisma.notaEnvioLinea.findMany({ where: { vigente: true, [campo]: { in: out.map((o) => o.id) } }, select: { [campo]: true } });
    const ocupados = new Set(usados.map((u) => (u as Record<string, number | null>)[campo]));
    ok(res, out.filter((o) => !ocupados.has(o.id)));
  })
);

notasEnvioRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const nota = await prisma.notaEnvio.findUnique({ where: { id }, include });
    if (!nota) throw new NotFoundError("Nota de envío", id);
    ok(res, present(nota));
  })
);

notasEnvioRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { sistema, ...body } = crearSchema.parse(req.body);
    const nota = await prisma.$transaction((tx) => crearNota(tx, { ...body, sistemaOrigen: sistema }, usuarioDe(req)));
    const full = await prisma.notaEnvio.findUniqueOrThrow({ where: { id: nota.id }, include });
    ok(res, present(full), 201);
  })
);

notasEnvioRouter.post(
  "/:id/recibir",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const body = z.object({ sistema: sistemaSchema, recibidoPor: z.string().trim().min(1, "Falta quién recibió"), fecha: isoSchema.optional() }).parse(req.body);
    await prisma.$transaction((tx) => recibirNota(tx, id, body));
    ok(res, present(await prisma.notaEnvio.findUniqueOrThrow({ where: { id }, include })));
  })
);

notasEnvioRouter.post(
  "/:id/anular",
  asyncHandler(async (req, res) => {
    const id = idOf(req.params.id);
    const body = z.object({ sistema: sistemaSchema, motivo: z.string().trim().min(1, "Falta el motivo") }).parse(req.body);
    await prisma.$transaction((tx) => anularNota(tx, id, body));
    ok(res, present(await prisma.notaEnvio.findUniqueOrThrow({ where: { id }, include })));
  })
);
