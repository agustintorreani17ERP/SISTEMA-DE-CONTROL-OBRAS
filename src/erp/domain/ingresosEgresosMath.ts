/**
 * Clasificación de ingresos/egresos y antigüedad de saldos, usada por los libros y reportes de
 * Contabilidad y Finanzas (libros.controller.ts, reportes.controller.ts, cuentasCorrientes.controller.ts).
 * Funciones puras para poder testear "¿esto se detecta como ingreso o como egreso?" sin tocar la DB.
 */

/** Factura EMITIDA (al cliente) = ingreso; RECIBIDA (de proveedor/subcontratista) = egreso. */
export function esIngreso(tipo: "EMITIDA" | "RECIBIDA"): boolean {
  return tipo === "EMITIDA";
}

export interface SaldoInput {
  total: number;
  montoRetenido: number;
  totalPagado: number;
}

/** Saldo pendiente de una factura: total facturado, menos lo retenido (fondo de reparo) y lo ya pagado/cobrado. */
export function saldoPendiente(f: SaldoInput): number {
  return Math.max(0, f.total - f.montoRetenido - f.totalPagado);
}

export type AgingBucket = "A_VENCER" | "0-30" | "31-60" | "61-90" | "+90";

/** Antigüedad de un saldo vencido, en los 5 baldes estándar de la corrida de cuentas corrientes. */
export function agruparPorBucketAntiguedad(fechaVencimiento: Date, hoy: Date): { bucket: AgingBucket; diasVencido: number } {
  const dias = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / 86_400_000);
  if (dias <= 0) return { bucket: "A_VENCER", diasVencido: 0 };
  if (dias <= 30) return { bucket: "0-30", diasVencido: dias };
  if (dias <= 60) return { bucket: "31-60", diasVencido: dias };
  if (dias <= 90) return { bucket: "61-90", diasVencido: dias };
  return { bucket: "+90", diasVencido: dias };
}
