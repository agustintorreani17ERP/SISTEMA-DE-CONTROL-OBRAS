/**
 * Cálculo del costo meta de un ítem (hoja "3 ACU" y "4 Presupuesto control" del Excel CTN).
 * Código puro: lo usan el servidor y la pantalla. Montos en Gs sin IVA, sin redondear.
 */

export type AcuGrupo = "MATERIAL" | "MANO_OBRA" | "EQUIPO";

export interface AcuLineInput {
  consumo: number;
  desperdicioPct: number;
  /** Precio vigente sin IVA; null si el insumo no tiene precio a la fecha. */
  precio: number | null;
  grupo: AcuGrupo;
}

export interface AcuItemInput {
  unitPrice: number;
  quantity: number;
  lines: AcuLineInput[];
  coeficienteK: number | null;
  ivaPct: number;
}

export type CostoMetaFuente = "ACU" | "K" | null;

export interface AcuResult {
  parciales: number[];
  subtotales: Record<AcuGrupo, number>;
  lineasSinPrecio: number;
  /** Σ consumo × (1 + desperdicio) × precio. null si el ítem no tiene componentes. */
  costoAcu: number | null;
  /** Costo que usó la oferta: PU ÷ K. */
  costoOferta: number | null;
  diferenciaOferta: number | null;
  superaOferta: boolean;
  fuente: CostoMetaFuente;
  costoMetaUnit: number | null;
  costoMetaTotal: number | null;
  ventaSinIvaUnit: number;
  ventaSinIvaTotal: number;
  margenUnit: number | null;
  margenTotal: number | null;
  /** Margen previsto sobre la venta sin IVA (fracción). */
  margenPct: number | null;
}

export const lineParcial = (l: Pick<AcuLineInput, "consumo" | "desperdicioPct" | "precio">) =>
  l.consumo * (1 + (l.desperdicioPct || 0) / 100) * (l.precio ?? 0);

export function computeAcu(input: AcuItemInput): AcuResult {
  const subtotales: Record<AcuGrupo, number> = { MATERIAL: 0, MANO_OBRA: 0, EQUIPO: 0 };
  const parciales = input.lines.map((l) => {
    const p = lineParcial(l);
    subtotales[l.grupo] += p;
    return p;
  });
  const hasAcu = input.lines.length > 0;
  const costoAcu = hasAcu ? subtotales.MATERIAL + subtotales.MANO_OBRA + subtotales.EQUIPO : null;
  const k = input.coeficienteK && input.coeficienteK > 0 ? input.coeficienteK : null;
  const costoOferta = k ? input.unitPrice / k : null;
  const costoMetaUnit = costoAcu ?? costoOferta;
  const ventaSinIvaUnit = input.unitPrice / (1 + (input.ivaPct || 0) / 100);
  const q = input.quantity;
  const margenUnit = costoMetaUnit === null ? null : ventaSinIvaUnit - costoMetaUnit;
  return {
    parciales,
    subtotales,
    lineasSinPrecio: input.lines.filter((l) => l.precio === null).length,
    costoAcu,
    costoOferta,
    diferenciaOferta: costoAcu !== null && costoOferta !== null ? costoAcu - costoOferta : null,
    superaOferta: costoAcu !== null && costoOferta !== null && costoAcu > costoOferta + 0.5,
    fuente: costoAcu !== null ? "ACU" : costoOferta !== null ? "K" : null,
    costoMetaUnit,
    costoMetaTotal: costoMetaUnit === null ? null : costoMetaUnit * q,
    ventaSinIvaUnit,
    ventaSinIvaTotal: ventaSinIvaUnit * q,
    margenUnit,
    margenTotal: margenUnit === null ? null : margenUnit * q,
    margenPct: margenUnit === null || ventaSinIvaUnit <= 0 ? null : margenUnit / ventaSinIvaUnit,
  };
}

/**
 * Ítems que concentran el `umbral` del monto (Pareto): de mayor a menor, se toman hasta
 * alcanzar el umbral incluyendo el ítem que lo cruza.
 */
export function paretoIds(items: { id: number; amount: number }[], umbral = 0.8): Set<number> {
  const positive = items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount || a.id - b.id);
  const total = positive.reduce((acc, i) => acc + i.amount, 0);
  const out = new Set<number>();
  if (total <= 0) return out;
  let acc = 0;
  for (const i of positive) {
    if (acc >= total * umbral - 1e-9) break;
    out.add(i.id);
    acc += i.amount;
  }
  return out;
}
