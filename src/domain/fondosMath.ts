/**
 * Solicitudes de fondos — cálculo puro (neto, transiciones, estado tras un pago, totales).
 * Lo usan el servidor (src/domain/fondos.ts) y el cliente.
 */

export const ESTADOS_SOLICITUD = [
  "PENDIENTE",
  "APROBADA",
  "RECHAZADA",
  "PROGRAMADA",
  "PAGADA_PARCIAL",
  "PAGADA",
  "ANULADA",
] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

export const ORIGENES_SOLICITUD = ["CERT_SUBCONTRATISTA", "ANTICIPO", "FACTURA"] as const;
export type OrigenSolicitud = (typeof ORIGENES_SOLICITUD)[number];

/** Estados que todavía son plata a pagar ("Solicitado sin pagar"). */
export const ESTADOS_SIN_PAGAR: EstadoSolicitud[] = ["PENDIENTE", "APROBADA", "PROGRAMADA", "PAGADA_PARCIAL"];
/** Estados desde los que tesorería puede pagar. */
export const ESTADOS_PAGABLES: EstadoSolicitud[] = ["APROBADA", "PROGRAMADA", "PAGADA_PARCIAL"];

/**
 * Transiciones manuales permitidas. PAGADA_PARCIAL / PAGADA solo se alcanzan pagando;
 * ANULADA solo al anular el documento origen (y sin pagos).
 */
export const TRANSICIONES: Record<EstadoSolicitud, EstadoSolicitud[]> = {
  PENDIENTE: ["APROBADA", "RECHAZADA", "ANULADA"],
  APROBADA: ["PROGRAMADA", "PAGADA_PARCIAL", "PAGADA", "RECHAZADA", "ANULADA"],
  PROGRAMADA: ["PROGRAMADA", "PAGADA_PARCIAL", "PAGADA", "ANULADA"],
  PAGADA_PARCIAL: ["PAGADA_PARCIAL", "PAGADA"],
  RECHAZADA: [],
  PAGADA: [],
  ANULADA: [],
};

export function puedeTransicionar(from: EstadoSolicitud, to: EstadoSolicitud): boolean {
  return TRANSICIONES[from].includes(to);
}

/** Tolerancia de redondeo en Gs. */
const TOL = 0.5;

const gs = (n: number) => Math.round(Number(n) || 0);

export interface Descuentos {
  reparo?: number;
  retenciones?: number;
  anticipo?: number;
}

/** Neto a pagar = bruto − fondo de reparo − retenciones − anticipo aplicado (Gs sin decimales). */
export function calcularNeto(bruto: number, d: Descuentos = {}) {
  const reparo = gs(d.reparo ?? 0);
  const retenciones = gs(d.retenciones ?? 0);
  const anticipo = gs(d.anticipo ?? 0);
  const montoBruto = gs(bruto);
  return { montoBruto, reparo, retenciones, anticipo, montoNeto: montoBruto - reparo - retenciones - anticipo };
}

export function saldoSolicitud(s: { montoNeto: number; montoPagado: number }): number {
  return Math.max(0, gs(s.montoNeto) - gs(s.montoPagado));
}

/** Estado después de sumar un pago: PAGADA si cubre el neto, si no PAGADA_PARCIAL. */
export function estadoTrasPago(montoNeto: number, montoPagadoNuevo: number): EstadoSolicitud {
  return montoPagadoNuevo >= montoNeto - TOL ? "PAGADA" : "PAGADA_PARCIAL";
}

/** Valida el monto de un pago contra el saldo; devuelve el monto a pagar (por defecto, el saldo). */
export function montoDePago(s: { montoNeto: number; montoPagado: number }, monto?: number | null): number {
  const saldo = saldoSolicitud(s);
  const m = monto == null ? saldo : gs(monto);
  if (m <= 0) throw new Error("El monto del pago debe ser mayor a cero");
  if (m > saldo + TOL) throw new Error(`El monto supera el saldo de la solicitud (saldo ${saldo})`);
  return m;
}

/** Vencida = vencimiento anterior a hoy y todavía sin pagar. Fechas AAAA-MM-DD. */
export function estaVencida(s: { estado: EstadoSolicitud; fechaVencimiento: string }, hoyIso: string): boolean {
  return ESTADOS_SIN_PAGAR.includes(s.estado) && s.fechaVencimiento.slice(0, 10) < hoyIso;
}

export interface TotalEstado {
  cantidad: number;
  neto: number;
  pagado: number;
  saldo: number;
}

/** Totales por estado (suma, nunca promedio). */
export function totalesPorEstado(rows: { estado: EstadoSolicitud; montoNeto: number; montoPagado: number }[]) {
  const out = Object.fromEntries(
    ESTADOS_SOLICITUD.map((e) => [e, { cantidad: 0, neto: 0, pagado: 0, saldo: 0 }])
  ) as Record<EstadoSolicitud, TotalEstado>;
  for (const r of rows) {
    const t = out[r.estado];
    t.cantidad += 1;
    t.neto += gs(r.montoNeto);
    t.pagado += gs(r.montoPagado);
    t.saldo += r.estado === "ANULADA" || r.estado === "RECHAZADA" ? 0 : saldoSolicitud(r);
  }
  return out;
}

/** "Solicitado sin pagar": saldo de las solicitudes pendientes, aprobadas, programadas o pagadas en parte. */
export function solicitadoSinPagar(rows: { estado: EstadoSolicitud; montoNeto: number; montoPagado: number }[]): number {
  return rows.filter((r) => ESTADOS_SIN_PAGAR.includes(r.estado)).reduce((acc, r) => acc + saldoSolicitud(r), 0);
}
