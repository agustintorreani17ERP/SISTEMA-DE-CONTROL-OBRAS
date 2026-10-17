import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { localIso } from "../../core/domain/localDate";
import { encolarEvento } from "../../bridge/domain/eventosSalida";
import { ESTADOS_FIJOS, estadoPorAvance, puedeModificarseDesdeOrigen, type EstadoRequisicion } from "./requisicionesMath";

/**
 * Bandeja de pedidos: los pedidos de materiales de la obra (ECMS) y del Taller llegan acá,
 * normalizados, para que el ERP los compre. El costo de un pedido de obra se imputa como siempre
 * (OC → ledger); el de un pedido del Taller no genera movimientos de presupuesto.
 */

type Tx = Prisma.TransactionClient;

const toDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const num = (v: unknown) => Number(v ?? 0);

/** Al aprobar un pedido de obra nace su requisición (misma transacción). Idempotente. */
export async function crearRequisicionDesdePedido(tx: Tx, materialRequestId: number) {
  const existente = await tx.requisicion.findUnique({ where: { materialRequestId } });
  if (existente) return existente;
  const mr = await tx.materialRequest.findUnique({
    where: { id: materialRequestId },
    include: { details: { include: { material: true }, orderBy: { id: "asc" } } },
  });
  if (!mr) throw new NotFoundError("Pedido de material", materialRequestId);
  return tx.requisicion.create({
    data: {
      sistemaOrigen: "ECMS",
      externalId: String(mr.id),
      numeroOrigen: mr.number,
      fecha: toDay(localIso(mr.requestedDate)),
      projectId: mr.projectId,
      observaciones: mr.notes,
      materialRequestId: mr.id,
      lineas: {
        create: mr.details.map((d, i) => ({
          position: i + 1,
          descripcion: d.material.description,
          cantidad: d.quantity,
          unidad: d.material.unit,
          materialId: d.materialId,
          budgetItemId: d.budgetItemId,
          materialRequestDetailId: d.id,
        })),
      },
    },
  });
}

/** Recalcula el estado de la requisición según lo que las OC cubren y recibieron. */
export async function actualizarEstadoRequisicion(tx: Tx, requisicionId: number): Promise<EstadoRequisicion> {
  const req = await tx.requisicion.findUnique({ where: { id: requisicionId }, include: { lineas: true } });
  if (!req) throw new NotFoundError("Requisición", requisicionId);
  if (ESTADOS_FIJOS.includes(req.estado)) return req.estado;
  const detalles = await tx.purchaseOrderDetail.findMany({
    where: { requisicionLineaId: { in: req.lineas.map((l) => l.id) }, order: { status: { not: "ANULADO" } } },
    include: { order: { select: { status: true } } },
  });
  const avance = req.lineas.map((l) => {
    const propios = detalles.filter((d) => d.requisicionLineaId === l.id);
    return {
      cantidad: num(l.cantidad),
      pedida: propios.reduce((a, d) => a + num(d.quantity), 0),
      recibida: propios.filter((d) => d.order.status === "RECIBIDO").reduce((a, d) => a + num(d.quantity), 0),
    };
  });
  const estado = estadoPorAvance(avance);
  if (estado !== req.estado) await tx.requisicion.update({ where: { id: requisicionId }, data: { estado } });
  return estado;
}

// ----------------------------------------------------
// Pedidos que llegan del Taller
// ----------------------------------------------------

export interface PedidoTallerInput {
  /** Id del pedido en el Taller (uuid). */
  externalId: string;
  /** "123" o "123/2026": como lo ve el Taller. */
  numero: string;
  fecha: string;
  /** Código de la obra del Taller; si coincide con el de una obra del ERP, el pedido se enlaza. */
  obraCodigo?: string | null;
  obraNombre?: string | null;
  maquinaCodigo?: string | null;
  maquinaDescripcion?: string | null;
  compraCentral: boolean;
  anulado: boolean;
  observaciones?: string | null;
  lineas: {
    externalLineId: string;
    nroParte?: string | null;
    descripcion: string;
    cantidad: number;
    unidad?: string | null;
    maquinaCodigo?: string | null;
    rubro?: string | null;
  }[];
}

/**
 * Registra o actualiza un pedido del Taller. Idempotente por externalId. Con OC ya hechas el
 * pedido no se modifica (las cantidades compradas dependen de sus renglones); sí se anula si
 * todavía no tiene OC vigentes.
 */
export async function upsertPedidoTaller(tx: Tx, input: PedidoTallerInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) throw new DomainError("FECHA_INVALIDA", "Fecha AAAA-MM-DD", 422);
  if (!input.anulado && input.lineas.length === 0) throw new DomainError("PEDIDO_SIN_RENGLONES", "El pedido no tiene renglones", 422);
  if (input.lineas.some((l) => !(l.cantidad > 0))) throw new DomainError("CANTIDAD_INVALIDA", "Las cantidades deben ser mayores a 0", 422);

  const project = input.obraCodigo ? await tx.project.findUnique({ where: { code: input.obraCodigo } }) : null;
  const cabecera = {
    numeroOrigen: input.numero,
    fecha: toDay(input.fecha),
    projectId: project?.id ?? null,
    obraTexto: project ? null : input.obraNombre ?? input.obraCodigo ?? null,
    maquinaTexto: [input.maquinaCodigo, input.maquinaDescripcion].filter(Boolean).join(" · ") || null,
    compraCentral: input.compraCentral,
    observaciones: input.observaciones?.trim() || null,
  };

  const existente = await tx.requisicion.findUnique({
    where: { sistemaOrigen_externalId: { sistemaOrigen: "TALLER", externalId: input.externalId } },
    include: { lineas: true },
  });

  const lineasData = input.lineas.map((l, i) => ({
    position: i + 1,
    descripcion: l.descripcion.trim(),
    cantidad: l.cantidad,
    unidad: l.unidad?.trim() || null,
    nroParte: l.nroParte?.trim() || null,
    maquinaCodigo: l.maquinaCodigo ?? input.maquinaCodigo ?? null,
    rubro: l.rubro ?? null,
    externalLineId: l.externalLineId,
  }));

  if (!existente) {
    return tx.requisicion.create({
      data: {
        sistemaOrigen: "TALLER",
        externalId: input.externalId,
        ...cabecera,
        estado: input.anulado ? "ANULADA" : "RECIBIDA",
        lineas: { create: lineasData },
      },
    });
  }

  const ocs = await tx.purchaseOrder.count({ where: { requisicionId: existente.id, status: { not: "ANULADO" } } });
  if (!puedeModificarseDesdeOrigen(ocs)) return existente; // ya se está comprando: el origen no la toca
  if (input.anulado) return tx.requisicion.update({ where: { id: existente.id }, data: { estado: "ANULADA" } });

  await tx.requisicionLinea.deleteMany({ where: { requisicionId: existente.id } });
  return tx.requisicion.update({
    where: { id: existente.id },
    data: {
      ...cabecera,
      estado: existente.estado === "ANULADA" || existente.estado === "RECHAZADA" ? "RECIBIDA" : existente.estado,
      lineas: { create: lineasData },
    },
  });
}

export async function rechazarRequisicion(tx: Tx, id: number, motivo: string) {
  const req = await tx.requisicion.findUnique({ where: { id } });
  if (!req) throw new NotFoundError("Requisición", id);
  if (!motivo.trim()) throw new DomainError("MOTIVO_REQUERIDO", "Rechazar un pedido requiere el motivo", 422);
  if (req.sistemaOrigen !== "TALLER") {
    throw new DomainError("RECHAZO_NO_PERMITIDO", "Los pedidos de obra se anulan desde el ECMS", 422);
  }
  const ocs = await tx.purchaseOrder.count({ where: { requisicionId: id, status: { not: "ANULADO" } } });
  if (ocs > 0) throw new DomainError("TIENE_OC", "El pedido ya tiene órdenes de compra vigentes", 409);
  if (req.estado === "RECHAZADA" || req.estado === "ANULADA") return req;
  const updated = await tx.requisicion.update({ where: { id }, data: { estado: "RECHAZADA" } });
  await encolarEvento(tx, "TALLER", "pedido.rechazado", { externalId: req.externalId, motivo: motivo.trim() });
  return updated;
}

// ----------------------------------------------------
// Avisos al Taller
// ----------------------------------------------------

/** El Taller deja de comprar el pedido: el ERP lo tomó (primera OC). */
export async function avisarPedidoTomado(tx: Tx, requisicionId: number, ocNumber: string) {
  const req = await tx.requisicion.findUnique({ where: { id: requisicionId } });
  if (!req || req.sistemaOrigen !== "TALLER") return;
  await encolarEvento(tx, "TALLER", "pedido.tomado_por_erp", { externalId: req.externalId, ocNumber });
}

export async function avisarOcEmitida(tx: Tx, requisicionId: number, ocNumber: string, fecha: Date) {
  const req = await tx.requisicion.findUnique({ where: { id: requisicionId } });
  if (!req || req.sistemaOrigen !== "TALLER") return;
  await encolarEvento(tx, "TALLER", "pedido.oc_emitida", { externalId: req.externalId, ocNumber, fecha: localIso(fecha) });
}

/** Lo recibido, renglón por renglón, para que el Taller registre su recepción. */
export async function avisarRecepcion(
  tx: Tx,
  requisicionId: number,
  oc: { number: string; receiptNumber: string | null; fecha: Date; detalles: { requisicionLineaId: number | null; quantity: unknown }[] }
) {
  const req = await tx.requisicion.findUnique({ where: { id: requisicionId }, include: { lineas: true } });
  if (!req || req.sistemaOrigen !== "TALLER") return;
  const porLinea = new Map(req.lineas.map((l) => [l.id, l.externalLineId]));
  await encolarEvento(tx, "TALLER", "pedido.recibido", {
    externalId: req.externalId,
    ocNumber: oc.number,
    remito: oc.receiptNumber,
    fecha: localIso(oc.fecha),
    lineas: oc.detalles
      .filter((d) => d.requisicionLineaId != null && porLinea.get(d.requisicionLineaId))
      .map((d) => ({ externalLineId: porLinea.get(d.requisicionLineaId!), cantidad: num(d.quantity) })),
  });
}
