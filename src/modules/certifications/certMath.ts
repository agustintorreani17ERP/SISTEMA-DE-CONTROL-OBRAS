/**
 * Aritmética de mediciones y certificados (formato "Medición N / Cert N").
 * Código puro: lo usa el servidor para guardar y la pantalla para mostrar en vivo.
 */

export interface AuxLine {
  largo?: number | null;
  ancho?: number | null;
  alto?: number | null;
  factor_repeticion?: number | null; // piezas / veces
  isDeduction?: boolean; // vanos, aberturas: restan
}

/**
 * Subtotal de una línea del cómputo métrico.
 * Multiplica solo las dimensiones cargadas: L = ml, L×A = m², L×A×H = m³; sin dimensiones,
 * son unidades (las piezas). Los descuentos (vanos) restan.
 */
export function auxSubtotal(line: AuxLine): number {
  const dims = [line.largo, line.ancho, line.alto].map((v) => Number(v || 0)).filter((v) => v > 0);
  const pieces = line.factor_repeticion === null || line.factor_repeticion === undefined ? 1 : Number(line.factor_repeticion);
  const base = dims.length ? dims.reduce((acc, v) => acc * v, 1) : 1;
  const value = base * pieces;
  return round(line.isDeduction ? -value : value, 4);
}

/** Fórmula legible de la línea, para mostrarla junto al resultado (ej. "2 × 3,50 × 2,80"). */
export function auxFormula(line: AuxLine): string {
  const fmt = (v: number) => v.toLocaleString("es-PY", { maximumFractionDigits: 3 });
  const parts = [line.largo, line.ancho, line.alto].map((v) => Number(v || 0)).filter((v) => v > 0).map(fmt);
  const pieces = Number(line.factor_repeticion ?? 1);
  if (pieces !== 1 || parts.length === 0) parts.unshift(fmt(pieces));
  return `${line.isDeduction ? "− " : ""}${parts.join(" × ")}`;
}

export function measuredQuantity(lines: AuxLine[]): number {
  return round(lines.reduce((acc, l) => acc + auxSubtotal(l), 0), 4);
}

export interface MeasurementRowInput {
  code: string;
  name: string;
  unit: string;
  contractedQuantity: number;
  previousQuantity: number;
  periodQuantity: number;
  unitPrice: number;
}

export interface MeasurementRow extends MeasurementRowInput {
  accumulatedQuantity: number;
  progress: number; // acumulado ÷ contratado
  overContract: boolean;
  contractedAmount: number;
  previousAmount: number;
  periodAmount: number;
  accumulatedAmount: number;
}

export interface CertificateSummary {
  rows: MeasurementRow[];
  contractAmount: number;
  previousAmount: number;
  periodAmount: number;
  accumulatedAmount: number;
  balance: number;
  retentionPct: number;
  retentionAmount: number;
  netAmount: number;
}

const round = (v: number, d = 0) => Math.round((v + Number.EPSILON) * 10 ** d) / 10 ** d;

/** Medición N y Cert N: acumulados, % de avance, saldo, fondo de reparo y neto a pagar (Gs. sin decimales). */
export function buildCertificate(rows: MeasurementRowInput[], retentionPct = 0): CertificateSummary {
  const computed: MeasurementRow[] = rows.map((r) => {
    const accumulatedQuantity = round(r.previousQuantity + r.periodQuantity, 4);
    return {
      ...r,
      accumulatedQuantity,
      progress: r.contractedQuantity > 0 ? accumulatedQuantity / r.contractedQuantity : 0,
      overContract: r.contractedQuantity > 0 && accumulatedQuantity > r.contractedQuantity + 1e-9,
      contractedAmount: round(r.contractedQuantity * r.unitPrice),
      previousAmount: round(r.previousQuantity * r.unitPrice),
      periodAmount: round(r.periodQuantity * r.unitPrice),
      accumulatedAmount: round(accumulatedQuantity * r.unitPrice),
    };
  });
  const sum = (f: (r: MeasurementRow) => number) => computed.reduce((acc, r) => acc + f(r), 0);
  const periodAmount = sum((r) => r.periodAmount);
  const retentionAmount = round((periodAmount * retentionPct) / 100);
  return {
    rows: computed,
    contractAmount: sum((r) => r.contractedAmount),
    previousAmount: sum((r) => r.previousAmount),
    periodAmount,
    accumulatedAmount: sum((r) => r.accumulatedAmount),
    balance: sum((r) => r.contractedAmount) - sum((r) => r.accumulatedAmount),
    retentionPct,
    retentionAmount,
    netAmount: periodAmount - retentionAmount,
  };
}
