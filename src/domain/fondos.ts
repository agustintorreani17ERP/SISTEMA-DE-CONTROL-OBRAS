import { Prisma, type EstadoSolicitudFondo, type OrigenSolicitudFondo } from "@prisma/client";
import { randomUUID } from "crypto";
import { DomainError, NotFoundError } from "../errors/domain";
import { moneyNumber } from "../lib/money";
import { EVENTO, postAsiento } from "./contabilidad";
import { localIso } from "./localDate";
import {
  calcularNeto,
  estadoTrasPago,
  ESTADOS_PAGABLES,
  montoDePago,
  puedeTransicionar,
  type Descuentos,
  type EstadoSolicitud,
} from "./fondosMath";

/**
 * Solicitudes de fondos: el pedido de pago a tesorería que nace del documento que crea la deuda
 * (certificado de subcontratista aprobado, anticipo otorgado). Una por origen (sourceType +
 * sourceId), generada en la misma transacción del origen. Es tesorería: no toca BudgetMovement
 * (el costo ya entró con el documento). Pagar crea el Payment de la factura (si hay) y el egreso
 * de la cuenta financiera, con su asiento (Debe Proveedores / Anticipos, Haber la cuenta).
 */

type Tx = Prisma.TransactionClient;

export const FONDO_SOURCE = {
  CERTIFICATION: "Certification",
  SUB_CERT: "SubcontractorCertificate",
  ANTICIPO: "Anticipo",
  INVOICE: "Invoice",
} as const;

const PAGO_SOURCE = "PagoSolicitudFondo";

function hoy(): Date {
  return new Date(`${localIso()}T00:00:00.000Z`);
}

function masDias(base: Date, dias: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

const fmtGs = (n: number) => Math.round(n).toLocaleString("es-PY");

function requireUsuario(usuario: string | null | undefined): string {
  const u = (usuario ?? "").trim();
  if (!u) throw new DomainError("USUARIO_REQUERIDO", "Falta el usuario que realiza la acción", 401);
  return u;
}

// ----------------------------------------------------
// Generación (idempotente por origen)
// ----------------------------------------------------

export interface SolicitudInput {
  projectId: number;
  origen: OrigenSolicitudFondo;
  sourceType: string;
  sourceId: number;
  partnerId: number;
  invoiceId?: number | null;
  anticipoId?: number | null;
  concepto: string;
  montoBruto: number;
  descuentos?: Descuentos;
  fechaVencimiento: Date;
  creadoPor: string;
}

/**
 * Crea la solicitud del origen o, si ya existe, la devuelve. Si todavía está PENDIENTE y sin
 * pagos, refresca montos y factura (el origen pudo corregirse); si ya avanzó, no la toca.
 */
export async function upsertSolicitudFondo(tx: Tx, input: SolicitudInput) {
  const n = calcularNeto(input.montoBruto, input.descuentos);
  if (n.montoNeto < 0) {
    throw new DomainError(
      "NETO_NEGATIVO",
      `Los descuentos (${fmtGs(n.reparo + n.retenciones + n.anticipo)} Gs) superan el monto bruto (${fmtGs(n.montoBruto)} Gs)`,
      422
    );
  }
  const data = {
    partnerId: input.partnerId,
    invoiceId: input.invoiceId ?? null,
    anticipoId: input.anticipoId ?? null,
    concepto: input.concepto,
    montoBruto: n.montoBruto,
    descuentoReparo: n.reparo,
    descuentoRetenciones: n.retenciones,
    descuentoAnticipo: n.anticipo,
    montoNeto: n.montoNeto,
    fechaVencimiento: input.fechaVencimiento,
  };

  const existing = await tx.solicitudFondo.findUnique({
    where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
  });
  if (existing) {
    if (existing.estado === "PENDIENTE" && moneyNumber(existing.montoPagado) === 0) {
      return tx.solicitudFondo.update({ where: { id: existing.id }, data });
    }
    return existing;
  }

  const last = await tx.solicitudFondo.aggregate({ where: { projectId: input.projectId }, _max: { numero: true } });
  return tx.solicitudFondo.create({
    data: {
      ...data,
      projectId: input.projectId,
      numero: (last._max.numero ?? 0) + 1,
      origen: input.origen,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      estado: "PENDIENTE",
      montoPagado: 0,
      creadoPor: input.creadoPor,
    },
  });
}

/** Retenciones de garantía, fondo de reparo (RetencionFondo) y anticipos aplicados a un documento. */
async function descuentosDe(tx: Tx, sourceType: string, sourceId: number) {
  const [retenciones, aplicaciones] = await Promise.all([
    tx.retencionFondo.findMany({ where: { sourceType, sourceId } }),
    tx.aplicacionAnticipo.findMany({ where: { sourceType, sourceId } }),
  ]);
  const suma = (rows: { monto: unknown }[]) => rows.reduce((acc, r) => acc + moneyNumber(r.monto), 0);
  return {
    reparo: suma(retenciones.filter((r) => r.tipo === "FONDO_REPARO")),
    retenciones: suma(retenciones.filter((r) => r.tipo === "RETENCION_GARANTIA")),
    anticipo: suma(aplicaciones),
  };
}

/** Certificado de subcontratista aprobado (Certification con partner): enlaza su factura RECIBIDA. */
export async function solicitudDesdeCertificacion(tx: Tx, certificationId: number, usuario: string) {
  const cert = await tx.certification.findUnique({
    where: { id: certificationId },
    include: { partner: true, project: true, invoices: true },
  });
  if (!cert) throw new NotFoundError("Certificación", certificationId);
  if (!cert.partnerId) return null;
  const invoice = cert.invoices.find((i) => i.tipo === "RECIBIDA" && i.estado !== "ANULADA") ?? null;
  const d = await descuentosDe(tx, FONDO_SOURCE.CERTIFICATION, cert.id);
  return upsertSolicitudFondo(tx, {
    projectId: cert.projectId,
    origen: "CERT_SUBCONTRATISTA",
    sourceType: FONDO_SOURCE.CERTIFICATION,
    sourceId: cert.id,
    partnerId: cert.partnerId,
    invoiceId: invoice?.id ?? null,
    concepto: `Cert. N° ${cert.numero} — ${cert.partner?.name ?? ""}`,
    montoBruto: moneyNumber(cert.montoTotal),
    // El fondo de reparo del certificado vive en la propia certificación.
    descuentos: { reparo: moneyNumber(cert.retentionAmount) || d.reparo, retenciones: d.retenciones, anticipo: d.anticipo },
    fechaVencimiento: invoice?.fechaVencimiento ?? masDias(cert.approvedAt ?? hoy(), 30),
    creadoPor: usuario,
  });
}

/** Certificado del contrato de subcontrato (SubcontractorCertificate) certificado. */
export async function solicitudDesdeCertificadoSubcontrato(tx: Tx, certId: number, usuario: string) {
  const cert = await tx.subcontractorCertificate.findUnique({ where: { id: certId }, include: { contract: true } });
  if (!cert) throw new NotFoundError("Certificado", certId);
  const d = await descuentosDe(tx, FONDO_SOURCE.SUB_CERT, cert.id);
  return upsertSolicitudFondo(tx, {
    projectId: cert.contract.projectId,
    origen: "CERT_SUBCONTRATISTA",
    sourceType: FONDO_SOURCE.SUB_CERT,
    sourceId: cert.id,
    partnerId: cert.contract.partnerId,
    concepto: `Certificado ${cert.number} / ${cert.contract.number}`,
    montoBruto: moneyNumber(cert.amount),
    descuentos: d,
    fechaVencimiento: masDias(cert.issuedAt ?? hoy(), 30),
    creadoPor: usuario,
  });
}

/** Anticipo OTORGADO a un proveedor/subcontratista: se paga por el monto completo. */
export async function solicitudDesdeAnticipo(tx: Tx, anticipoId: number, usuario: string) {
  const a = await tx.anticipo.findUnique({ where: { id: anticipoId }, include: { partner: true } });
  if (!a) throw new NotFoundError("Anticipo", anticipoId);
  if (a.tipo !== "OTORGADO" || !a.partnerId) return null;
  return upsertSolicitudFondo(tx, {
    projectId: a.projectId,
    origen: "ANTICIPO",
    sourceType: FONDO_SOURCE.ANTICIPO,
    sourceId: a.id,
    partnerId: a.partnerId,
    anticipoId: a.id,
    concepto: `Anticipo — ${a.partner?.name ?? ""}${a.concepto ? ` — ${a.concepto}` : ""}`,
    montoBruto: moneyNumber(a.monto),
    fechaVencimiento: a.fecha,
    creadoPor: usuario,
  });
}

export interface AnticipoInput {
  projectId: number;
  partnerId?: number | null;
  tipo: "OTORGADO" | "RECIBIDO";
  monto: number;
  fecha: Date;
  concepto?: string;
}

/** Alta de anticipo; el OTORGADO exige tercero y genera su solicitud de fondos. */
export async function crearAnticipo(tx: Tx, input: AnticipoInput, usuario: string) {
  const project = await tx.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new NotFoundError("Obra", input.projectId);
  if (input.tipo === "OTORGADO" && !input.partnerId) {
    throw new DomainError("PARTNER_REQUIRED", "El anticipo otorgado necesita el proveedor o subcontratista", 422);
  }
  const anticipo = await tx.anticipo.create({
    data: { ...input, partnerId: input.partnerId ?? null },
  });
  const solicitud = input.tipo === "OTORGADO" ? await solicitudDesdeAnticipo(tx, anticipo.id, usuario?.trim() || "sistema") : null;
  return { anticipo, solicitud };
}

/** Anula un anticipo: sin aplicaciones y con su solicitud sin pagos. */
export async function anularAnticipo(tx: Tx, anticipoId: number, usuario?: string) {
  const a = await tx.anticipo.findUnique({ where: { id: anticipoId }, include: { aplicaciones: true } });
  if (!a) throw new NotFoundError("Anticipo", anticipoId);
  if (a.anuladoAt) return a;
  if (a.aplicaciones.length > 0) {
    throw new DomainError("ANTICIPO_APLICADO", "El anticipo ya se descontó de certificados o facturas: no se puede anular", 409);
  }
  await anularSolicitudPorOrigen(tx, FONDO_SOURCE.ANTICIPO, anticipoId, usuario);
  return tx.anticipo.update({ where: { id: anticipoId }, data: { anuladoAt: new Date() } });
}

/**
 * Al anular el documento origen: la solicitud pasa a ANULADA si no tiene pagos; si los tiene,
 * error (primero hay que revertir los pagos). Sin solicitud, no hace nada.
 */
export async function anularSolicitudPorOrigen(tx: Tx, sourceType: string, sourceId: number, _usuario?: string) {
  const s = await tx.solicitudFondo.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!s || s.estado === "ANULADA") return s;
  const pagado = moneyNumber(s.montoPagado);
  if (pagado > 0) {
    throw new DomainError(
      "SOLICITUD_CON_PAGOS",
      `No se puede anular: la solicitud de fondos N° ${s.numero} ya tiene pagos por ${fmtGs(pagado)} Gs. Revertí los pagos antes de anular el documento.`,
      409
    );
  }
  return tx.solicitudFondo.update({ where: { id: s.id }, data: { estado: "ANULADA" } });
}

// ----------------------------------------------------
// Transiciones
// ----------------------------------------------------

async function cargar(tx: Tx, id: number) {
  const s = await tx.solicitudFondo.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Solicitud de fondos", id);
  return s;
}

function assertTransicion(from: EstadoSolicitudFondo, to: EstadoSolicitud, numero: number) {
  if (!puedeTransicionar(from as EstadoSolicitud, to)) {
    throw new DomainError("INVALID_STATUS_TRANSITION", `Solicitud N° ${numero}: no se puede pasar de ${from} a ${to}`, 422);
  }
}

export async function aprobarSolicitud(tx: Tx, id: number, usuario: string) {
  const u = requireUsuario(usuario);
  const s = await cargar(tx, id);
  assertTransicion(s.estado, "APROBADA", s.numero);
  if (u === s.creadoPor) {
    throw new DomainError("APROBADOR_IGUAL_CREADOR", `La solicitud N° ${s.numero} la generó ${s.creadoPor}: debe aprobarla otra persona`, 403);
  }
  return tx.solicitudFondo.update({ where: { id }, data: { estado: "APROBADA", aprobadoPor: u, motivoRechazo: null } });
}

export async function rechazarSolicitud(tx: Tx, id: number, usuario: string, motivo: string) {
  const u = requireUsuario(usuario);
  if (!motivo?.trim()) throw new DomainError("MOTIVO_REQUERIDO", "Indicá el motivo del rechazo", 422);
  const s = await cargar(tx, id);
  assertTransicion(s.estado, "RECHAZADA", s.numero);
  return tx.solicitudFondo.update({ where: { id }, data: { estado: "RECHAZADA", aprobadoPor: u, motivoRechazo: motivo.trim() } });
}

export async function programarSolicitud(tx: Tx, id: number, params: { fechaProgramada: Date; cuentaFinancieraId?: number | null }) {
  const s = await cargar(tx, id);
  // Una pagada en parte se puede reprogramar sin perder su estado.
  const destino: EstadoSolicitud = s.estado === "PAGADA_PARCIAL" ? "PAGADA_PARCIAL" : "PROGRAMADA";
  assertTransicion(s.estado, destino, s.numero);
  if (params.cuentaFinancieraId) {
    const cuenta = await tx.cuentaFinanciera.findUnique({ where: { id: params.cuentaFinancieraId } });
    if (!cuenta) throw new NotFoundError("Cuenta financiera", params.cuentaFinancieraId);
    if (cuenta.projectId !== s.projectId) {
      throw new DomainError("ACCOUNT_PROJECT_MISMATCH", "La cuenta financiera no pertenece a la obra de la solicitud", 422);
    }
  }
  return tx.solicitudFondo.update({
    where: { id },
    data: {
      estado: destino,
      fechaProgramada: params.fechaProgramada,
      ...(params.cuentaFinancieraId ? { cuentaFinancieraId: params.cuentaFinancieraId } : {}),
    },
  });
}

// ----------------------------------------------------
// Pagos
// ----------------------------------------------------

export interface PagoInput {
  monto?: number | null;
  cuentaFinancieraId?: number | null;
  fecha?: Date;
  metodo?: "TRANSFERENCIA" | "EFECTIVO";
  referencia: string;
  usuario?: string;
  grupoPagoId?: string;
}

/** Asiento del pago: Debe la cuenta de la regla (Proveedores / Anticipos), Haber la cuenta contable de la cuenta financiera (o la de la regla). */
async function asientoPago(
  tx: Tx,
  p: { evento: string; projectId: number; concepto: string; sourceType: string; sourceId: number; fecha: Date; monto: number; partnerId: number; cuentaContableId: number | null; usuario?: string }
) {
  const regla = await tx.reglaAsientoContable.findUnique({ where: { evento: p.evento } });
  if (!regla || !regla.activo) return null;
  return postAsiento(tx, {
    projectId: p.projectId,
    concepto: p.concepto,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    fecha: p.fecha,
    usuario: p.usuario,
    lineas: [
      { cuentaId: regla.cuentaDebeId, debe: p.monto, partnerId: p.partnerId },
      { cuentaId: p.cuentaContableId ?? regla.cuentaHaberId, haber: p.monto },
    ],
  });
}

/**
 * Paga (total o parcial) una solicitud aprobada o programada. Con factura: Payment + egreso
 * (sourceType "Payment", como el resto de los pagos de facturas). Sin factura (anticipo): solo
 * el egreso. No toca BudgetMovement.
 */
export async function pagarSolicitud(tx: Tx, id: number, input: PagoInput) {
  const s = await cargar(tx, id);
  if (!ESTADOS_PAGABLES.includes(s.estado as EstadoSolicitud)) {
    throw new DomainError("SOLICITUD_NO_PAGABLE", `La solicitud N° ${s.numero} está ${s.estado}: solo se pagan las aprobadas o programadas`, 422);
  }
  const referencia = input.referencia?.trim();
  if (!referencia) throw new DomainError("REFERENCIA_REQUERIDA", "La referencia bancaria o N° de recibo es obligatoria", 422);

  const montoNeto = moneyNumber(s.montoNeto);
  const montoPagado = moneyNumber(s.montoPagado);
  let monto: number;
  try {
    monto = montoDePago({ montoNeto, montoPagado }, input.monto);
  } catch (e) {
    throw new DomainError("MONTO_INVALIDO", `Solicitud N° ${s.numero}: ${(e as Error).message}`, 422);
  }

  const cuentaId = input.cuentaFinancieraId ?? s.cuentaFinancieraId;
  if (!cuentaId) throw new DomainError("CUENTA_REQUERIDA", "Elegí la cuenta financiera del pago", 422);
  const cuenta = await tx.cuentaFinanciera.findUnique({ where: { id: cuentaId } });
  if (!cuenta) throw new NotFoundError("Cuenta financiera", cuentaId);
  if (cuenta.projectId !== s.projectId) {
    throw new DomainError("ACCOUNT_PROJECT_MISMATCH", `La cuenta financiera no pertenece a la obra de la solicitud N° ${s.numero}`, 422);
  }

  const fecha = input.fecha ?? hoy();
  const metodo = input.metodo ?? "TRANSFERENCIA";
  const concepto = `Solicitud de fondos N° ${s.numero} — ${s.concepto} — ${referencia}`;

  let paymentId: number | null = null;
  let invoice: { id: number; numeroFactura: string; estado: string } | null = null;
  if (s.invoiceId) {
    invoice = await tx.invoice.findUnique({ where: { id: s.invoiceId } });
    if (!invoice) throw new NotFoundError("Factura", s.invoiceId);
    if (invoice.estado !== "APROBADA" && invoice.estado !== "PAGADA") {
      throw new DomainError("PAYMENT_NOT_AUTHORIZED", `La factura ${invoice.numeroFactura} está ${invoice.estado}: debe estar APROBADA para pagarla`, 422);
    }
    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        cuentaFinancieraId: cuenta.id,
        montoPagado: monto,
        fechaPago: fecha,
        metodo,
        referenciaBanco: referencia,
        notas: `Solicitud de fondos N° ${s.numero}`,
        grupoPagoId: input.grupoPagoId ?? null,
      },
    });
    paymentId = payment.id;
  }

  const pago = await tx.pagoSolicitudFondo.create({
    data: {
      solicitudId: s.id,
      cuentaFinancieraId: cuenta.id,
      monto,
      fecha,
      metodo,
      referencia,
      paymentId,
      grupoPagoId: input.grupoPagoId ?? null,
      usuario: input.usuario ?? null,
    },
  });

  const sourceType = paymentId ? "Payment" : PAGO_SOURCE;
  const sourceId = paymentId ?? pago.id;
  await tx.movimientoCuentaFinanciera.create({
    data: { cuentaFinancieraId: cuenta.id, fecha, tipo: "EGRESO", monto, concepto, confirmado: true, sourceType, sourceId },
  });
  await asientoPago(tx, {
    evento: paymentId ? EVENTO.PAGO_FACTURA : s.origen === "ANTICIPO" ? EVENTO.PAGO_ANTICIPO_PROVEEDOR : EVENTO.PAGO_CERTIFICADO_SUBCONTRATISTA,
    projectId: s.projectId,
    concepto,
    sourceType,
    sourceId,
    fecha,
    monto,
    partnerId: s.partnerId,
    cuentaContableId: cuenta.cuentaContableId ?? null,
    usuario: input.usuario,
  });

  const nuevoPagado = montoPagado + monto;
  const estado = estadoTrasPago(montoNeto, nuevoPagado);
  const updated = await tx.solicitudFondo.update({
    where: { id: s.id },
    data: { montoPagado: nuevoPagado, estado, cuentaFinancieraId: cuenta.id },
  });

  if (estado === "PAGADA") {
    if (invoice && invoice.estado !== "PAGADA") {
      await tx.invoice.update({ where: { id: invoice.id }, data: { estado: "PAGADA" } });
    }
    if (s.sourceType === FONDO_SOURCE.SUB_CERT) {
      const cert = await tx.subcontractorCertificate.findUnique({ where: { id: s.sourceId } });
      if (cert && cert.status === "CERTIFICADO") {
        await tx.subcontractorCertificate.update({ where: { id: cert.id }, data: { status: "PAGADO", paidAt: new Date() } });
        await tx.subcontractorContract.update({
          where: { id: cert.contractId },
          data: { status: "PAGADO", paidAmount: { increment: cert.amount } },
        });
      }
    }
  }
  return { solicitud: updated, pago };
}

/** Pago en lote: todas las solicitudes en la misma transacción y con el mismo grupoPagoId (todo o nada). */
export async function pagarLote(
  tx: Tx,
  input: Omit<PagoInput, "monto" | "grupoPagoId"> & { items: { solicitudId: number; monto?: number | null }[] }
) {
  if (input.items.length === 0) throw new DomainError("LOTE_VACIO", "Elegí al menos una solicitud", 422);
  const ids = new Set(input.items.map((i) => i.solicitudId));
  if (ids.size !== input.items.length) throw new DomainError("LOTE_DUPLICADO", "Una solicitud aparece dos veces en el lote", 422);
  const grupoPagoId = randomUUID();
  const pagos = [];
  for (const item of input.items) {
    pagos.push(await pagarSolicitud(tx, item.solicitudId, { ...input, monto: item.monto, grupoPagoId }));
  }
  const total = pagos.reduce((acc, p) => acc + moneyNumber(p.pago.monto), 0);
  return { grupoPagoId, total, pagos };
}
