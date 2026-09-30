/**
 * Tablero de costos (hoja "8 Resumen" del Excel CTN). Código puro: recibe el costo real del motor
 * (rango y acumulado desde el inicio) y el avance, y arma los indicadores por ítem, rubro y obra.
 *
 *  Venta sin IVA = ejecutado × PU ÷ (1 + IVA)       VG = ejecutado × costo meta
 *  VP = planificado × costo meta                     IC = VG ÷ costo real      IP = VG ÷ VP
 *  Margen real = venta − costo real                  Margen previsto = venta × (1 − costo meta ÷ PU s/IVA)
 *  Costo proyectado al final (EAC) = costo real acumulado + (BAC − VG acumulado) ÷ IC acumulado,
 *  con BAC = cantidad de contrato × costo meta. Es lo mismo que la hoja 8 (BAC ÷ IC), pero con el
 *  IC acumulado desde el inicio de obra en vez del IC del mes. Sin IC acumulado se supone IC = 1.
 *  Resultado proyectado = venta total del contrato sin IVA − EAC.
 */

export interface DashItemInput {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  rubro: { id: number; code: string; name: string } | null;
  contrato: number;
  puSinIva: number;
  costoMetaUnit: number | null;
  /** ACU por encima del costo de la oferta (PU ÷ K). */
  superaOferta: boolean;
  diferenciaOferta: number | null;
  // Rango
  ejecutado: number;
  planificado: number;
  costoReal: number;
  // Acumulado desde el inicio de obra hasta el fin del rango
  acumulado: number;
  costoRealAcum: number;
}

export interface Metrics {
  ventaSinIva: number;
  costoReal: number;
  margenReal: number;
  margenRealPct: number | null;
  margenPrevisto: number | null;
  margenPrevistoPct: number | null;
  vg: number;
  vp: number;
  ic: number | null;
  ip: number | null;
  /** Presupuesto meta a terminación (BAC). */
  bac: number;
  vgAcum: number;
  costoRealAcum: number;
  icAcum: number | null;
  /** Costo proyectado al final (EAC). */
  eac: number;
  /** BAC − EAC: positivo = se termina por debajo del costo meta. */
  desvioFinal: number;
  /** Venta total del contrato sin IVA. */
  ventaTotal: number;
  /** Resultado proyectado = venta total sin IVA − costo proyectado al final. */
  resultadoProyectado: number;
  /** "Costo OK · En plazo", "Leve sobrecosto · Atrasado"… (columna Diagnóstico de la hoja 8). */
  diagnostico: string | null;
}

/** Diagnóstico de la hoja 8 a partir de IC e IP. */
export function diagnostico(ic: number | null, ip: number | null): string | null {
  const costo = ic === null ? null : ic >= 0.995 ? "Costo OK" : ic >= 0.95 ? "Leve sobrecosto" : "Sobrecosto";
  const plazo = ip === null ? null : ip >= 0.995 ? "En plazo" : ip >= 0.9 ? "Leve atraso" : "Atrasado";
  const partes = [costo, plazo].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

export interface DashItemRow extends Metrics {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  rubroId: number | null;
  ejecutado: number;
  planificado: number;
  acumulado: number;
  contrato: number;
  sinCostoMeta: boolean;
}

export interface DashRubroRow extends Metrics {
  id: number | null;
  code: string;
  name: string;
  items: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * "Código Descripción" sin repetir: hay rubros importados cuyo código y descripción son el mismo
 * texto ("Área: 1) OBRADOR"), o uno contiene al otro.
 */
export function codeName(code: string | null | undefined, name: string | null | undefined): string {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (!c) return n;
  if (!n || c === n || c.startsWith(n)) return c;
  if (n.startsWith(c)) return n;
  return `${c} ${n}`;
}

function eac(costoRealAcum: number, bac: number, vgAcum: number) {
  const ic = costoRealAcum > 0 && vgAcum > 0 ? vgAcum / costoRealAcum : null;
  return costoRealAcum + Math.max(0, bac - vgAcum) / (ic ?? 1);
}

export function itemRow(i: DashItemInput): DashItemRow {
  const cm = i.costoMetaUnit;
  const ventaSinIva = i.ejecutado * i.puSinIva;
  const vg = cm === null ? 0 : i.ejecutado * cm;
  const vp = cm === null ? 0 : i.planificado * cm;
  const bac = cm === null ? 0 : i.contrato * cm;
  const vgAcum = cm === null ? 0 : i.acumulado * cm;
  const margenPrevistoPct = cm === null || i.puSinIva <= 0 ? null : 1 - cm / i.puSinIva;
  const margenReal = ventaSinIva - i.costoReal;
  const proj = eac(i.costoRealAcum, bac, vgAcum);
  const ventaTotal = i.contrato * i.puSinIva;
  const ic = cm === null ? null : ratio(vg, i.costoReal);
  const ip = cm === null ? null : ratio(vg, vp);
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    unit: i.unit,
    rubroId: i.rubro?.id ?? null,
    ejecutado: i.ejecutado,
    planificado: i.planificado,
    acumulado: i.acumulado,
    contrato: i.contrato,
    sinCostoMeta: cm === null,
    ventaSinIva,
    costoReal: i.costoReal,
    margenReal,
    margenRealPct: ratio(margenReal, ventaSinIva),
    margenPrevisto: margenPrevistoPct === null ? null : ventaSinIva * margenPrevistoPct,
    margenPrevistoPct,
    vg,
    vp,
    ic,
    ip,
    bac,
    vgAcum,
    costoRealAcum: i.costoRealAcum,
    icAcum: cm === null ? null : ratio(vgAcum, i.costoRealAcum),
    eac: proj,
    desvioFinal: bac - proj,
    ventaTotal,
    resultadoProyectado: ventaTotal - proj,
    diagnostico: diagnostico(ic, ip),
  };
}

/**
 * Suma de filas y recálculo de los índices (nunca se promedian índices). El costo proyectado es
 * la suma de las proyecciones de cada ítem (como el subtotal de la hoja 8).
 */
export function aggregate(rows: Metrics[], extra?: { costoReal?: number; costoRealAcum?: number }): Metrics {
  const s = (f: (r: Metrics) => number | null) => rows.reduce((acc, r) => acc + (f(r) ?? 0), 0);
  const ventaSinIva = s((r) => r.ventaSinIva);
  const costoReal = extra?.costoReal ?? s((r) => r.costoReal);
  const costoRealAcum = extra?.costoRealAcum ?? s((r) => r.costoRealAcum);
  const vg = s((r) => r.vg);
  const vp = s((r) => r.vp);
  const bac = s((r) => r.bac);
  const vgAcum = s((r) => r.vgAcum);
  const margenPrevisto = rows.some((r) => r.margenPrevisto !== null) ? s((r) => r.margenPrevisto) : null;
  const margenReal = ventaSinIva - costoReal;
  const proj = s((r) => r.eac);
  const ventaTotal = s((r) => r.ventaTotal);
  const ic = ratio(vg, costoReal);
  const ip = ratio(vg, vp);
  return {
    ventaSinIva,
    costoReal,
    margenReal,
    margenRealPct: ratio(margenReal, ventaSinIva),
    margenPrevisto,
    margenPrevistoPct: margenPrevisto === null ? null : ratio(margenPrevisto, ventaSinIva),
    vg,
    vp,
    ic,
    ip,
    bac,
    vgAcum,
    costoRealAcum,
    icAcum: ratio(vgAcum, costoRealAcum),
    eac: proj,
    desvioFinal: bac - proj,
    ventaTotal,
    resultadoProyectado: ventaTotal - proj,
    diagnostico: diagnostico(ic, ip),
  };
}

export function byRubro(inputs: DashItemInput[], rows: DashItemRow[]): DashRubroRow[] {
  const groups = new Map<string, { rubro: DashItemInput["rubro"]; rows: DashItemRow[] }>();
  inputs.forEach((inp, idx) => {
    const k = inp.rubro ? String(inp.rubro.id) : "-";
    const g = groups.get(k) ?? { rubro: inp.rubro, rows: [] };
    g.rows.push(rows[idx]);
    groups.set(k, g);
  });
  return [...groups.values()].map((g) => ({
    id: g.rubro?.id ?? null,
    code: g.rubro?.code ?? "",
    name: g.rubro?.name ?? "Sin rubro",
    items: g.rows.length,
    ...aggregate(g.rows),
  }));
}

// ─── Alertas ───────────────────────────────────────────────────────────────

export interface Umbrales {
  ic: number;
  ip: number;
  /** Costo no imputado sobre el total contable del rango (fracción). */
  noImputadoPct: number;
}

export const UMBRALES: Umbrales = { ic: 0.95, ip: 0.9, noImputadoPct: 0.1 };

export type AlertaTipo = "IC" | "IP" | "DESVIO_MATERIAL" | "ACU_SOBRE_OFERTA" | "NO_IMPUTADO" | "VALIDACION";

export interface Alerta {
  tipo: AlertaTipo;
  nivel: "OBRA" | "RUBRO" | "ITEM" | "INSUMO";
  ref: string;
  itemId?: number;
  mensaje: string;
  valor: number | null;
}

const f2 = (n: number) => n.toFixed(2).replace(".", ",");
const pctTxt = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")} %`;
const gs = (n: number) => Math.round(n).toLocaleString("es-PY");

export function alertas(p: {
  obra: Metrics;
  rubros: DashRubroRow[];
  items: DashItemRow[];
  inputs: DashItemInput[];
  materiales: { code: string; description: string; estado: string; desvioPct: number | null; toleranciaPct: number; perdidaValorizada: number }[];
  noImputado: number;
  totalContable: number;
  validacionOk: boolean;
  umbrales?: Umbrales;
}): Alerta[] {
  const u = p.umbrales ?? UMBRALES;
  const out: Alerta[] = [];
  if (!p.validacionOk) out.push({ tipo: "VALIDACION", nivel: "OBRA", ref: "Obra", mensaje: "El motor no valida: imputado + pérdidas + no imputado ≠ total contable", valor: null });
  if (p.obra.ic !== null && p.obra.ic < u.ic) out.push({ tipo: "IC", nivel: "OBRA", ref: "Obra", mensaje: `IC de la obra ${f2(p.obra.ic)} (< ${f2(u.ic)})`, valor: p.obra.ic });
  if (p.obra.ip !== null && p.obra.ip < u.ip) out.push({ tipo: "IP", nivel: "OBRA", ref: "Obra", mensaje: `IP de la obra ${f2(p.obra.ip)} (< ${f2(u.ip)})`, valor: p.obra.ip });
  for (const r of p.rubros) {
    const ref = codeName(r.code, r.name);
    if (r.ic !== null && r.ic < u.ic) out.push({ tipo: "IC", nivel: "RUBRO", ref, mensaje: `IC ${f2(r.ic)}`, valor: r.ic });
    if (r.ip !== null && r.ip < u.ip) out.push({ tipo: "IP", nivel: "RUBRO", ref, mensaje: `IP ${f2(r.ip)}`, valor: r.ip });
  }
  p.items.forEach((r, idx) => {
    const ref = codeName(r.code, r.name);
    if (r.ic !== null && r.ic < u.ic) out.push({ tipo: "IC", nivel: "ITEM", ref, itemId: r.id, mensaje: `IC ${f2(r.ic)}: costo ${gs(r.costoReal)} para VG ${gs(r.vg)}`, valor: r.ic });
    if (r.ip !== null && r.ip < u.ip) out.push({ tipo: "IP", nivel: "ITEM", ref, itemId: r.id, mensaje: `IP ${f2(r.ip)}: ejecutado ${r.ejecutado} de ${r.planificado} planificado`, valor: r.ip });
    const inp = p.inputs[idx];
    if (inp.superaOferta) {
      out.push({
        tipo: "ACU_SOBRE_OFERTA",
        nivel: "ITEM",
        ref,
        itemId: r.id,
        mensaje: `El ACU supera el costo de la oferta en ${gs(inp.diferenciaOferta ?? 0)} por ${r.unit ?? "unidad"}`,
        valor: inp.diferenciaOferta,
      });
    }
  });
  for (const m of p.materiales) {
    if (m.estado !== "ALERTA") continue;
    out.push({
      tipo: "DESVIO_MATERIAL",
      nivel: "INSUMO",
      ref: codeName(m.code, m.description),
      mensaje: `Consumo real ${m.desvioPct === null ? "" : pctTxt(m.desvioPct)} sobre el teórico (tolerancia ${m.toleranciaPct} %): pérdida ${gs(m.perdidaValorizada)}`,
      valor: m.desvioPct,
    });
  }
  const share = p.totalContable > 0 ? p.noImputado / p.totalContable : 0;
  if (share > u.noImputadoPct) {
    out.push({ tipo: "NO_IMPUTADO", nivel: "OBRA", ref: "Obra", mensaje: `Costo no imputado ${gs(p.noImputado)} = ${pctTxt(share)} del total contable (> ${pctTxt(u.noImputadoPct)})`, valor: share });
  }
  return out;
}

// ─── Curva S ───────────────────────────────────────────────────────────────

export interface CurvaInput {
  items: { id: number; costoMetaUnit: number | null }[];
  plan: Map<number, { fecha: string; cantidad: number }[]>;
  /** Avance acumulado de cada ítem a una fecha (oficial + provisorio). */
  acumuladoAl: (itemId: number, fecha: string) => number;
  /** Costo contable (libro mayor) por fecha. */
  costos: { fecha: string; amount: number }[];
}

export interface CurvaPunto {
  fecha: string;
  planificado: number;
  ganado: number;
  real: number;
}

/** Lapso corto (menos de ~2 meses): la curva se corta por semana y el eje muestra días. */
export const CURVA_DIAS_MAX = 62;

export function curvaPorDias(desde: string, hasta: string) {
  return (new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86_400_000 <= CURVA_DIAS_MAX;
}

/** Cortes de la curva: fin de cada mes (o de cada semana si el lapso es corto), más la fecha final. */
export function cortes(desde: string, hasta: string): string[] {
  const d0 = new Date(`${desde}T00:00:00Z`);
  const d1 = new Date(`${hasta}T00:00:00Z`);
  const out: string[] = [];
  if (curvaPorDias(desde, hasta)) {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); // domingo
    while (d < d1) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0));
    while (d < d1) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 2);
      d.setUTCDate(0);
    }
  }
  out.push(hasta);
  return [...new Set(out)];
}

export function curvaS(fechas: string[], c: CurvaInput): CurvaPunto[] {
  const costos = [...c.costos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return fechas.map((fecha) => {
    let planificado = 0;
    let ganado = 0;
    for (const it of c.items) {
      if (it.costoMetaUnit === null) continue;
      const plan = (c.plan.get(it.id) ?? []).reduce((s, p) => (p.fecha <= fecha ? s + p.cantidad : s), 0);
      planificado += plan * it.costoMetaUnit;
      ganado += c.acumuladoAl(it.id, fecha) * it.costoMetaUnit;
    }
    const real = costos.reduce((s, m) => (m.fecha <= fecha ? s + m.amount : s), 0);
    return { fecha, planificado: Math.round(planificado), ganado: Math.round(ganado), real: Math.round(real) };
  });
}
