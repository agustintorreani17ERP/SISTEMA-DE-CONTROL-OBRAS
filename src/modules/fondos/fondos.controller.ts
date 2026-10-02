import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { usuarioDe } from "../../http/usuario";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { localIso } from "../../domain/localDate";
import {
  anularAnticipo,
  aprobarSolicitud,
  crearAnticipo,
  pagarLote,
  pagarSolicitud,
  programarSolicitud,
  rechazarSolicitud,
} from "../../domain/fondos";
import {
  ESTADOS_SIN_PAGAR,
  ESTADOS_SOLICITUD,
  ORIGENES_SOLICITUD,
  saldoSolicitud,
  solicitadoSinPagar,
  totalesPorEstado,
  type EstadoSolicitud,
} from "../../domain/fondosMath";

/**
 * Solicitudes de fondos (tesorería) y anticipos otorgados.
 * Las solicitudes se generan solas desde el documento origen; acá se listan y se aprueban,
 * rechazan, programan y pagan (de a una o en lote).
 */
export const fondosRouter = Router();

const lista = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((x) => String(x).split(",")).map((s) => s.trim()).filter(Boolean);

const filtrosSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  estado: z.array(z.enum(ESTADOS_SOLICITUD)).default([]),
  origen: z.enum(ORIGENES_SOLICITUD).optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  /** Rango sobre la fecha de vencimiento (AAAA-MM-DD). */
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vencidas: z.enum(["1", "true", "0", "false"]).optional(),
  montoMin: z.coerce.number().optional(),
  montoMax: z.coerce.number().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
});

const include = {
  project: { select: { id: true, code: true, name: true } },
  partner: { select: { id: true, name: true, taxId: true } },
  invoice: { select: { id: true, numeroFactura: true, estado: true } },
  cuentaFinanciera: { select: { id: true, nombre: true } },
} satisfies Prisma.SolicitudFondoInclude;

type Row = Prisma.SolicitudFondoGetPayload<{ include: typeof include }>;

function serialize(s: Row, hoyIso: string) {
  const montoNeto = moneyNumber(s.montoNeto);
  const montoPagado = moneyNumber(s.montoPagado);
  const fechaVencimiento = s.fechaVencimiento.toISOString().slice(0, 10);
  return {
    ...s,
    montoBruto: moneyNumber(s.montoBruto),
    descuentoReparo: moneyNumber(s.descuentoReparo),
    descuentoRetenciones: moneyNumber(s.descuentoRetenciones),
    descuentoAnticipo: moneyNumber(s.descuentoAnticipo),
    montoNeto,
    montoPagado,
    saldo: saldoSolicitud({ montoNeto, montoPagado }),
    fechaVencimiento,
    fechaProgramada: s.fechaProgramada ? s.fechaProgramada.toISOString().slice(0, 10) : null,
    vencida: ESTADOS_SIN_PAGAR.includes(s.estado as EstadoSolicitud) && fechaVencimiento < hoyIso,
  };
}

fondosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const f = filtrosSchema.parse({ ...req.query, estado: lista(req.query.estado) });
    const hoyIso = localIso();
    const hoy = new Date(`${hoyIso}T00:00:00.000Z`);

    // Base sin filtro de estado: los totales por estado se calculan sobre esta.
    const base: Prisma.SolicitudFondoWhereInput = {
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.origen ? { origen: f.origen } : {}),
      ...(f.partnerId ? { partnerId: f.partnerId } : {}),
      ...(f.desde || f.hasta
        ? { fechaVencimiento: { ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00.000Z`) } : {}), ...(f.hasta ? { lte: new Date(`${f.hasta}T00:00:00.000Z`) } : {}) } }
        : {}),
      ...(f.montoMin !== undefined || f.montoMax !== undefined
        ? { montoNeto: { ...(f.montoMin !== undefined ? { gte: f.montoMin } : {}), ...(f.montoMax !== undefined ? { lte: f.montoMax } : {}) } }
        : {}),
    };
    const vencidas = f.vencidas === "1" || f.vencidas === "true";
    const where: Prisma.SolicitudFondoWhereInput = {
      AND: [
        base,
        f.estado.length ? { estado: { in: f.estado } } : {},
        vencidas ? { estado: { in: ESTADOS_SIN_PAGAR }, fechaVencimiento: { lt: hoy } } : {},
      ],
    };

    const [total, rows, paraTotales] = await Promise.all([
      prisma.solicitudFondo.count({ where }),
      prisma.solicitudFondo.findMany({
        where,
        include,
        orderBy: [{ fechaVencimiento: "asc" }, { id: "asc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      prisma.solicitudFondo.findMany({ where: base, select: { estado: true, montoNeto: true, montoPagado: true } }),
    ]);
    const numericos = paraTotales.map((r) => ({
      estado: r.estado as EstadoSolicitud,
      montoNeto: moneyNumber(r.montoNeto),
      montoPagado: moneyNumber(r.montoPagado),
    }));

    ok(res, {
      rows: rows.map((r) => serialize(r, hoyIso)),
      total,
      page: f.page,
      pageSize: f.pageSize,
      totales: totalesPorEstado(numericos),
      solicitadoSinPagar: solicitadoSinPagar(numericos),
    });
  })
);

async function devolver(id: number) {
  const s = await prisma.solicitudFondo.findUniqueOrThrow({ where: { id }, include });
  return serialize(s, localIso());
}

fondosRouter.post(
  "/:id/aprobar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction((tx) => aprobarSolicitud(tx, id, usuarioDe(req)));
    ok(res, await devolver(id));
  })
);

const rechazarSchema = z.object({ motivo: z.string().trim().min(1, "Indicá el motivo del rechazo") });

fondosRouter.post(
  "/:id/rechazar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { motivo } = rechazarSchema.parse(req.body);
    await prisma.$transaction((tx) => rechazarSolicitud(tx, id, usuarioDe(req), motivo));
    ok(res, await devolver(id));
  })
);

const programarSchema = z.object({
  fechaProgramada: z.coerce.date(),
  cuentaFinancieraId: z.coerce.number().int().positive().nullish(),
});

fondosRouter.post(
  "/:id/programar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = programarSchema.parse(req.body);
    await prisma.$transaction((tx) => programarSolicitud(tx, id, body));
    ok(res, await devolver(id));
  })
);

const pagoBase = {
  cuentaFinancieraId: z.coerce.number().int().positive().nullish(),
  fecha: z.coerce.date().optional(),
  metodo: z.enum(["TRANSFERENCIA", "EFECTIVO"]).default("TRANSFERENCIA"),
  referencia: z.string().trim().min(1, "La referencia bancaria o N° de recibo es obligatoria"),
};
const pagarSchema = z.object({ ...pagoBase, monto: z.coerce.number().positive().nullish() });

fondosRouter.post(
  "/:id/pagar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = pagarSchema.parse(req.body);
    const result = await prisma.$transaction((tx) => pagarSolicitud(tx, id, { ...body, usuario: usuarioDe(req) }), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    ok(res, { solicitud: await devolver(id), pagoId: result.pago.id }, 201);
  })
);

const loteSchema = z.object({
  ...pagoBase,
  items: z
    .array(z.object({ solicitudId: z.coerce.number().int().positive(), monto: z.coerce.number().positive().nullish() }))
    .min(1, "Elegí al menos una solicitud"),
});

fondosRouter.post(
  "/pagos-lote",
  asyncHandler(async (req, res) => {
    const body = loteSchema.parse(req.body);
    const result = await prisma.$transaction((tx) => pagarLote(tx, { ...body, usuario: usuarioDe(req) }), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });
    ok(res, { grupoPagoId: result.grupoPagoId, total: result.total, cantidad: result.pagos.length }, 201);
  })
);

// ----------------------------------------------------
// Anticipos otorgados (pantalla mínima) — generan su solicitud de fondos
// ----------------------------------------------------

fondosRouter.get(
  "/anticipos",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const anticipos = await prisma.anticipo.findMany({
      where: { projectId, tipo: "OTORGADO" },
      include: {
        partner: { select: { id: true, name: true } },
        solicitudesFondo: { select: { id: true, numero: true, estado: true, montoPagado: true } },
      },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
    });
    ok(
      res,
      anticipos.map(({ solicitudesFondo, ...a }) => ({
        ...a,
        monto: moneyNumber(a.monto),
        saldoAplicado: moneyNumber(a.saldoAplicado),
        saldoPendiente: moneyNumber(a.monto) - moneyNumber(a.saldoAplicado),
        solicitud: solicitudesFondo[0] ? { ...solicitudesFondo[0], montoPagado: moneyNumber(solicitudesFondo[0].montoPagado) } : null,
      }))
    );
  })
);

const anticipoSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  partnerId: z.coerce.number().int().positive(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date(),
  concepto: z.string().trim().optional(),
});

fondosRouter.post(
  "/anticipos",
  asyncHandler(async (req, res) => {
    const body = anticipoSchema.parse(req.body);
    const { anticipo, solicitud } = await prisma.$transaction((tx) =>
      crearAnticipo(tx, { ...body, tipo: "OTORGADO" }, usuarioDe(req))
    );
    ok(res, { ...anticipo, monto: moneyNumber(anticipo.monto), solicitudId: solicitud?.id ?? null }, 201);
  })
);

fondosRouter.post(
  "/anticipos/:id/anular",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const anticipo = await prisma.$transaction((tx) => anularAnticipo(tx, id, usuarioDe(req)));
    ok(res, { ...anticipo, monto: moneyNumber(anticipo.monto) });
  })
);

// Al final: no debe tapar /anticipos.
fondosRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_ID", "Identificador inválido");
    const s = await prisma.solicitudFondo.findUnique({
      where: { id },
      include: { ...include, pagos: { include: { cuentaFinanciera: { select: { nombre: true } } }, orderBy: { fecha: "asc" } } },
    });
    if (!s) throw new NotFoundError("Solicitud de fondos", id);
    ok(res, { ...serialize(s, localIso()), pagos: s.pagos.map((p) => ({ ...p, monto: moneyNumber(p.monto) })) });
  })
);
