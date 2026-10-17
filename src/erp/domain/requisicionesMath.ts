/**
 * Bandeja de pedidos del ERP: reglas puras (sin base de datos). Una requisición es un pedido de
 * materiales normalizado que llegó del ECMS (obra) o del Taller; el ERP lo convierte en OC.
 */

export type EstadoRequisicion = "RECIBIDA" | "EN_COMPRA" | "COMPRADA_PARCIAL" | "COMPRADA" | "RECHAZADA" | "ANULADA";

/** Estados finales fijados a mano: no los recalcula el avance de las OC. */
export const ESTADOS_FIJOS: EstadoRequisicion[] = ["RECHAZADA", "ANULADA"];

export interface AvanceLinea {
  cantidad: number;
  /** Suma de las OC no anuladas que cubren el renglón. */
  pedida: number;
  /** Suma de las OC ya recibidas. */
  recibida: number;
}

const EPS = 1e-9;

/**
 * Estado según el avance de sus renglones:
 *  - todo recibido → COMPRADA; todo pedido en OC → EN_COMPRA; algo pedido → COMPRADA_PARCIAL;
 *  - nada pedido → RECIBIDA (llegó a la bandeja y espera compra).
 */
export function estadoPorAvance(lineas: AvanceLinea[]): EstadoRequisicion {
  if (lineas.length === 0) return "RECIBIDA";
  if (lineas.every((l) => l.recibida + EPS >= l.cantidad)) return "COMPRADA";
  if (lineas.every((l) => l.pedida + EPS >= l.cantidad)) return "EN_COMPRA";
  if (lineas.some((l) => l.pedida > EPS)) return "COMPRADA_PARCIAL";
  return "RECIBIDA";
}

export const pendienteDeCompra = (l: Pick<AvanceLinea, "cantidad" | "pedida">) => Math.max(0, l.cantidad - l.pedida);

/** Una requisición con OC vigentes ya no se modifica desde el origen: solo se anula si no hay ninguna. */
export function puedeModificarseDesdeOrigen(ocsVigentes: number): boolean {
  return ocsVigentes === 0;
}

export interface LineaPedido {
  requisicionLineaId: number;
  quantity: number;
  unitPrice: number;
}

/** Problemas de los renglones de una OC contra lo que falta comprar; vacío si son válidos. */
export function validarRenglonesOC(lineas: LineaPedido[], pendientes: Map<number, number>): string[] {
  if (lineas.length === 0) return ["La OC necesita al menos un renglón"];
  const out: string[] = [];
  const pedidoAhora = new Map<number, number>();
  for (const l of lineas) {
    if (!pendientes.has(l.requisicionLineaId)) {
      out.push(`El renglón ${l.requisicionLineaId} no pertenece al pedido`);
      continue;
    }
    if (!(l.quantity > 0)) out.push(`El renglón ${l.requisicionLineaId}: la cantidad debe ser mayor a 0`);
    if (!(l.unitPrice >= 0)) out.push(`El renglón ${l.requisicionLineaId}: el precio no puede ser negativo`);
    pedidoAhora.set(l.requisicionLineaId, (pedidoAhora.get(l.requisicionLineaId) ?? 0) + l.quantity);
  }
  for (const [id, qty] of pedidoAhora) {
    const pendiente = pendientes.get(id) ?? 0;
    if (qty > pendiente + EPS) out.push(`El renglón ${id}: pedís ${qty} pero faltan ${pendiente} por comprar`);
  }
  return out;
}
