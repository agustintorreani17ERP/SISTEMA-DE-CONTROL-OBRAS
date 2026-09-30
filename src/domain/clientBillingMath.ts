/**
 * Factura al cliente desde la medición oficial cerrada (puro). Cantidad oficial del período × PU
 * del presupuesto (con IVA). El IVA se desglosa con el % de la obra; el fondo de reparo se
 * informa sobre el total y no cambia el importe facturado.
 */

export interface BillingRow {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  cantidad: number;
  puConIva: number;
}

export interface BillingLine extends BillingRow {
  total: number;
  iva: number;
  sinIva: number;
}

export interface ClientInvoiceDraft {
  lineas: BillingLine[];
  total: number;
  iva: number;
  sinIva: number;
  ivaPct: number;
  retencionPct: number;
  retencion: number;
  netoACobrar: number;
  /** Ítems con medición negativa (correcciones): se facturan como nota de crédito aparte. */
  negativos: BillingLine[];
}

export function buildClientInvoice(rows: BillingRow[], ivaPct: number, retencionPct = 0): ClientInvoiceDraft {
  const toLine = (r: BillingRow): BillingLine => {
    const total = Math.round(r.cantidad * r.puConIva);
    const iva = ivaPct > 0 ? Math.round((total * ivaPct) / (100 + ivaPct)) : 0;
    return { ...r, total, iva, sinIva: total - iva };
  };
  const all = rows.filter((r) => Math.abs(r.cantidad) > 1e-9).map(toLine);
  const lineas = all.filter((l) => l.total > 0);
  const negativos = all.filter((l) => l.total < 0);
  const total = lineas.reduce((s, l) => s + l.total, 0);
  const iva = lineas.reduce((s, l) => s + l.iva, 0);
  const retencion = Math.round((total * retencionPct) / 100);
  return { lineas, total, iva, sinIva: total - iva, ivaPct, retencionPct, retencion, netoACobrar: total - retencion, negativos };
}
