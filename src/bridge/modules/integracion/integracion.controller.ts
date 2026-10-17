import { timingSafeEqual } from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../../../config/env";
import { DomainError } from "../../../errors/domain";
import { ok } from "../../../http/respond";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { asignarNumero, sembrarSecuencia } from "../../../core/domain/numeracion";
import { upsertPedidoTaller } from "../../../erp/domain/requisiciones";
import { marcarRecibidaPorTaller, registrarNotaTaller } from "../../domain/notasEnvio";
import { entregarEventosAlTaller } from "../../integracion/tallerClient";

/**
 * Entrada de sistemas externos (Taller). Se autentica con una clave de máquina en la cabecera
 * `x-integration-key`; sin `INTEGRACION_TALLER_KEY` configurada la ruta responde 503.
 */
export const integracionRouter = Router();

function requireClaveTaller(req: Request, _res: Response, next: NextFunction) {
  const esperada = env.integracionTallerKey;
  if (!esperada) throw new DomainError("INTEGRACION_NO_CONFIGURADA", "Falta INTEGRACION_TALLER_KEY en el servidor", 503);
  const recibida = String(req.header("x-integration-key") ?? "");
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new DomainError("CLAVE_INVALIDA", "Clave de integración inválida", 401);
  }
  next();
}

const tipoSchema = z.enum(["SF", "NE"]);
const isoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

const pedirNumeroSchema = z.object({
  tipo: tipoSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD"),
  /** Id del documento en el Taller (uuid): hace idempotente el reintento. */
  externalId: z.string().min(1),
});

integracionRouter.post(
  "/numeracion",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const body = pedirNumeroSchema.parse(req.body);
    const n = await prisma.$transaction((tx) =>
      asignarNumero(tx, { tipo: body.tipo, fecha: new Date(`${body.fecha}T00:00:00.000Z`), sistema: "TALLER", externalId: body.externalId })
    );
    ok(res, { ...n, etiqueta: `${n.numero}/${n.anio}` });
  })
);

const semillaSchema = z.object({
  tipo: tipoSchema,
  anio: z.number().int().min(2000).max(2100),
  ultimo: z.number().int().min(0),
});

integracionRouter.post(
  "/numeracion/semilla",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const body = semillaSchema.parse(req.body);
    const seq = await prisma.$transaction((tx) => sembrarSecuencia(tx, body.tipo, body.anio, body.ultimo));
    ok(res, { tipo: seq.tipo, anio: seq.anio, siguiente: seq.siguiente });
  })
);

// ─── Pedidos, solicitudes de fondos y notas que manda el Taller ──────────────

const numStr = z.union([z.string(), z.number()]).transform(String);

const pedidoSchema = z.object({
  externalId: z.string().min(1),
  numero: numStr,
  fecha: isoSchema,
  obraCodigo: z.string().nullish(),
  obraNombre: z.string().nullish(),
  maquinaCodigo: z.string().nullish(),
  maquinaDescripcion: z.string().nullish(),
  compraCentral: z.boolean().default(false),
  anulado: z.boolean().default(false),
  observaciones: z.string().nullish(),
  lineas: z.array(
    z.object({
      externalLineId: z.string().min(1),
      nroParte: z.string().nullish(),
      descripcion: z.string().min(1),
      cantidad: z.number(),
      unidad: z.string().nullish(),
      maquinaCodigo: z.string().nullish(),
      rubro: z.string().nullish(),
    })
  ),
});

/** El Taller manda cada pedido al guardarlo o cambiarlo; es idempotente por externalId. */
integracionRouter.post(
  "/taller/pedidos",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const body = pedidoSchema.parse(req.body);
    const r = await prisma.$transaction((tx) => upsertPedidoTaller(tx, body));
    ok(res, { id: r.id, estado: r.estado });
  })
);

const sfSchema = z.object({
  externalId: z.string().min(1),
  anio: z.number().int().min(2000).max(2100),
  numero: z.number().int().positive(),
  fecha: isoSchema,
  proveedor: z.string().min(1),
  proveedorRuc: z.string().nullish(),
  monto: z.number().positive(),
  moneda: z.string().min(1),
  concepto: z.string().min(1),
  maquinaCodigo: z.string().nullish(),
  anulado: z.boolean().default(false),
});

/** Copia de una SF del Taller para la bandeja del ERP. La verdad es del Taller. */
integracionRouter.post(
  "/taller/solicitudes-fondos",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const b = sfSchema.parse(req.body);
    const data = {
      anio: b.anio,
      numero: b.numero,
      fecha: new Date(`${b.fecha}T00:00:00.000Z`),
      proveedor: b.proveedor,
      proveedorRuc: b.proveedorRuc ?? null,
      monto: b.monto,
      moneda: b.moneda,
      concepto: b.concepto,
      maquinaCodigo: b.maquinaCodigo ?? null,
      anulado: b.anulado,
    };
    const r = await prisma.$transaction(async (tx) => {
      const otra = await tx.solicitudFondoTaller.findUnique({ where: { anio_numero: { anio: b.anio, numero: b.numero } } });
      if (otra && otra.externalId !== b.externalId) {
        throw new DomainError("NUMERO_REPETIDO", `La SF ${b.numero}/${b.anio} ya existe con otro documento del Taller`, 409);
      }
      return tx.solicitudFondoTaller.upsert({ where: { externalId: b.externalId }, create: { externalId: b.externalId, ...data }, update: data });
    });
    ok(res, { id: r.id });
  })
);

const notaTallerSchema = z.object({
  externalId: z.string().min(1),
  anio: z.number().int().min(2000).max(2100),
  numero: z.number().int().positive(),
  fecha: isoSchema,
  destinoTipo: z.enum(["OFICINA", "OBRA", "TALLER"]),
  /** Código de la obra de destino (Project.code); obligatorio si el destino es OBRA. */
  destinoObraCodigo: z.string().nullish(),
  contenido: z.enum(["DOCUMENTOS", "MATERIALES"]),
  chofer: z.string().nullish(),
  observaciones: z.string().nullish(),
  estado: z.enum(["ENVIADA", "ANULADA"]).default("ENVIADA"),
  anuladoMotivo: z.string().nullish(),
  lineas: z.array(z.object({ descripcion: z.string().min(1), cantidad: z.number().nullish(), unidad: z.string().nullish() })).min(1),
});

/** Una nota que emitió el Taller hacia la oficina o una obra, para que la reciban acá. */
integracionRouter.post(
  "/taller/notas",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const { destinoObraCodigo, ...b } = notaTallerSchema.parse(req.body);
    const nota = await prisma.$transaction(async (tx) => {
      let destinoProjectId: number | null = null;
      if (b.destinoTipo === "OBRA") {
        const obra = destinoObraCodigo ? await tx.project.findUnique({ where: { code: destinoObraCodigo } }) : null;
        if (!obra) throw new DomainError("OBRA_DESCONOCIDA", `No hay una obra con el código ${destinoObraCodigo ?? "(vacío)"}`, 422);
        destinoProjectId = obra.id;
      }
      return registrarNotaTaller(tx, { ...b, destinoProjectId });
    });
    ok(res, { id: nota.id, estado: nota.estado });
  })
);

/** El Taller recibió una nota que le mandó el ERP o el ECMS. */
integracionRouter.post(
  "/taller/notas/recibida",
  requireClaveTaller,
  asyncHandler(async (req, res) => {
    const b = z
      .object({ anio: z.number().int(), numero: z.number().int().positive(), recibidoPor: z.string().trim().min(1), fecha: isoSchema.optional() })
      .parse(req.body);
    const nota = await prisma.$transaction((tx) => marcarRecibidaPorTaller(tx, b));
    ok(res, { id: nota.id, estado: nota.estado });
  })
);

/** Fuerza un ciclo de entrega de avisos (diagnóstico; el servidor también lo hace cada 30 s). */
integracionRouter.post(
  "/taller/eventos/entregar",
  requireClaveTaller,
  asyncHandler(async (_req, res) => {
    ok(res, (await entregarEventosAlTaller()) ?? { enviados: 0, reintentos: 0, fallidos: 0 });
  })
);
