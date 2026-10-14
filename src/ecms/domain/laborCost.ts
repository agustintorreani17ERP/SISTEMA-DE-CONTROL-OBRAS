/**
 * Costo hora del personal propio con cargas sociales. Puro: lo usan RRHH, el parte diario y el
 * motor de costos (peso de las horas de personal en la vía C).
 *
 * - Mensualero: salario mensual ÷ días laborales del mes ÷ horas por día.
 * - Jornalero / destajista: salarioBase es el jornal diario ÷ horas por día.
 * - Cargas = IPS patronal + aguinaldo (1 ÷ meses) + vacaciones + otras, sobre el salario.
 */

export type EmpleadoTipo = "MENSUALERO" | "JORNALERO" | "DESTAJISTA";

export interface CargasConfig {
  pctIpsPatronal: number;
  aguinaldoMeses: number;
  pctVacaciones: number;
  pctOtrasCargas: number;
  horasDiasLaborales: number;
  diasLaboralesMes: number;
}

export const CARGAS_DEFAULT: CargasConfig = {
  pctIpsPatronal: 16.5,
  aguinaldoMeses: 12,
  pctVacaciones: 4.17,
  pctOtrasCargas: 0,
  horasDiasLaborales: 8,
  diasLaboralesMes: 26,
};

export interface CostoHora {
  base: number;
  /** Detalle de cargas en % del salario. */
  cargas: { ipsPatronal: number; aguinaldo: number; vacaciones: number; otras: number; total: number };
  factor: number;
  costoHora: number;
  manual: boolean;
}

export function cargasPct(cfg: CargasConfig) {
  const ipsPatronal = cfg.pctIpsPatronal;
  const aguinaldo = cfg.aguinaldoMeses > 0 ? 100 / cfg.aguinaldoMeses : 0;
  const vacaciones = cfg.pctVacaciones;
  const otras = cfg.pctOtrasCargas;
  return { ipsPatronal, aguinaldo, vacaciones, otras, total: ipsPatronal + aguinaldo + vacaciones + otras };
}

export function costoHoraBase(tipo: EmpleadoTipo, salarioBase: number, cfg: CargasConfig): number {
  const horas = cfg.horasDiasLaborales > 0 ? cfg.horasDiasLaborales : 8;
  const dias = cfg.diasLaboralesMes > 0 ? cfg.diasLaboralesMes : 26;
  return tipo === "MENSUALERO" ? salarioBase / dias / horas : salarioBase / horas;
}

export function costoHora(emp: { tipo: EmpleadoTipo; salarioBase: number; costoHoraManual?: number | null }, cfg: CargasConfig): CostoHora {
  const cargas = cargasPct(cfg);
  const factor = 1 + cargas.total / 100;
  const base = costoHoraBase(emp.tipo, emp.salarioBase, cfg);
  if (emp.costoHoraManual != null && emp.costoHoraManual > 0) {
    return { base, cargas, factor, costoHora: emp.costoHoraManual, manual: true };
  }
  return { base, cargas, factor, costoHora: Math.round(base * factor), manual: false };
}

export interface HoraPersonalParte {
  empleadoId: number;
  fecha: string;
  budgetItemId: number | null;
  horas: number;
}

export interface AsistenciaPeso {
  empleadoId: number;
  fecha: string;
  budgetItemId: number | null;
  horas: number;
  jornal: number;
}

/**
 * Pesos de la vía C para el personal propio. Las horas del parte diario (por ítem) reemplazan a
 * la asistencia del mismo empleado y día; sin parte, la asistencia (jornal con cargas o horas ×
 * costo hora).
 */
export function pesosPersonal(
  partes: HoraPersonalParte[],
  asistencias: AsistenciaPeso[],
  costo: (empleadoId: number) => CostoHora
): { budgetItemId: number | null; peso: number }[] {
  const conParte = new Set(partes.map((p) => `${p.empleadoId}|${p.fecha}`));
  const out: { budgetItemId: number | null; peso: number }[] = [];
  for (const p of partes) {
    const peso = p.horas * costo(p.empleadoId).costoHora;
    if (peso > 0) out.push({ budgetItemId: p.budgetItemId, peso });
  }
  for (const a of asistencias) {
    if (conParte.has(`${a.empleadoId}|${a.fecha}`)) continue;
    const c = costo(a.empleadoId);
    const peso = a.jornal > 0 ? a.jornal * c.factor : a.horas * c.costoHora;
    if (peso > 0) out.push({ budgetItemId: a.budgetItemId, peso });
  }
  return out;
}

/** Asistencia derivada de las horas del parte: normales hasta la jornada, el resto extra. */
export function asistenciaDesdeParte(lineas: { budgetItemId: number | null; horas: number }[], horasDia: number) {
  const total = lineas.reduce((s, l) => s + l.horas, 0);
  const jornada = horasDia > 0 ? horasDia : 8;
  const porItem = new Map<number | null, number>();
  for (const l of lineas) porItem.set(l.budgetItemId, (porItem.get(l.budgetItemId) ?? 0) + l.horas);
  const principal = [...porItem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    estado: total >= jornada * 0.75 ? ("PRESENTE" as const) : ("MEDIA_JORNADA" as const),
    horasNormales: Math.min(total, jornada),
    horasExtra: Math.max(0, Math.round((total - jornada) * 100) / 100),
    budgetItemId: principal,
  };
}
