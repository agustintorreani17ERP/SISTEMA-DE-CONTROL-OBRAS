/**
 * Avance físico fechado (hojas "5 Medición mes" y "8 Resumen" del Excel CTN). Código puro.
 * Fechas "AAAA-MM-DD". Un parte diario es provisorio; una medición oficial es la cantidad del
 * período medida oficialmente y reemplaza a todos los partes con fecha hasta la suya.
 */

export type AvanceOrigen = "PARTE_DIARIO" | "MEDICION_OFICIAL";

export interface AvanceFact {
  fecha: string;
  cantidad: number;
  origen: AvanceOrigen;
}

export interface PlanFact {
  fecha: string;
  cantidad: number;
}

export interface Acumulado {
  /** Oficial + provisorio. */
  total: number;
  oficial: number;
  /** Partes posteriores a la última medición oficial. */
  provisorio: number;
  ultimaOficial: string | null;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function acumuladoAl(facts: AvanceFact[], fecha: string): Acumulado {
  let oficial = 0;
  let ultimaOficial: string | null = null;
  for (const f of facts) {
    if (f.origen !== "MEDICION_OFICIAL" || f.fecha > fecha) continue;
    oficial += f.cantidad;
    if (!ultimaOficial || f.fecha > ultimaOficial) ultimaOficial = f.fecha;
  }
  let provisorio = 0;
  for (const f of facts) {
    if (f.origen === "PARTE_DIARIO" && f.fecha <= fecha && (!ultimaOficial || f.fecha > ultimaOficial)) provisorio += f.cantidad;
  }
  return { total: r4(oficial + provisorio), oficial: r4(oficial), provisorio: r4(provisorio), ultimaOficial };
}

export interface AvanceRango {
  anterior: number;
  rango: number;
  acumulado: number;
  anteriorOficial: number;
  rangoOficial: number;
  acumuladoOficial: number;
  /** Parte del avance al `hasta` que todavía no tiene medición oficial. */
  provisorio: number;
  ultimaOficial: string | null;
}

export function avanceRango(facts: AvanceFact[], desde: string, hasta: string): AvanceRango {
  const antes = acumuladoAl(facts, dayBefore(desde));
  const al = acumuladoAl(facts, hasta);
  return {
    anterior: antes.total,
    rango: r4(al.total - antes.total),
    acumulado: al.total,
    anteriorOficial: antes.oficial,
    rangoOficial: r4(al.oficial - antes.oficial),
    acumuladoOficial: al.oficial,
    provisorio: al.provisorio,
    ultimaOficial: al.ultimaOficial,
  };
}

export function planAcumulado(plan: PlanFact[], fecha: string) {
  return r4(plan.reduce((acc, p) => (p.fecha <= fecha ? acc + p.cantidad : acc), 0));
}

export function planRango(plan: PlanFact[], desde: string, hasta: string) {
  return r4(plan.reduce((acc, p) => (p.fecha >= desde && p.fecha <= hasta ? acc + p.cantidad : acc), 0));
}

export interface Indicadores {
  pctAvance: number | null;
  /** Ejecutado del rango ÷ planificado del rango. */
  cumplimiento: number | null;
  /** Valor planificado = planificado × costo meta. */
  vp: number | null;
  /** Valor ganado = ejecutado × costo meta. */
  vg: number | null;
  /** Certificable al cliente sin IVA = ejecutado × PU sin IVA. */
  ventaSinIva: number;
  /** Índice de plazo = VG ÷ VP. */
  ip: number | null;
}

export function indicadores(p: {
  contrato: number;
  acumulado: number;
  ejecutado: number;
  planificado: number;
  costoMetaUnit: number | null;
  puSinIva: number;
}): Indicadores {
  const vp = p.costoMetaUnit === null ? null : p.planificado * p.costoMetaUnit;
  const vg = p.costoMetaUnit === null ? null : p.ejecutado * p.costoMetaUnit;
  return {
    pctAvance: p.contrato > 0 ? p.acumulado / p.contrato : null,
    cumplimiento: p.planificado > 0 ? p.ejecutado / p.planificado : null,
    vp,
    vg,
    ventaSinIva: p.ejecutado * p.puSinIva,
    ip: vp && vg !== null && vp > 0 ? vg / vp : null,
  };
}
