import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api";
import type { CostDashboardData, DashItemRow, DashMetrics, Project } from "../types";
import { cx, inputClass } from "../ui";
import { LineChart, monthLabel } from "../ui/charts";
import { codeName, curvaPorDias } from "../../domain/dashboardMath";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";
import { type ComparePreset, type Preset, previousRange, rangeFor } from "./ranges";
import { ItemDrillDrawer } from "./ItemDrillDrawer";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const IC_MIN = 0.95;
const IP_MIN = 0.9;
const idx = (v: number | null) => (v === null ? "—" : formatQty(v, 2));
const PRESETS: { value: Preset; label: string }[] = [
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mes" },
  { value: "inicio", label: "Desde inicio de obra" },
  { value: "custom", label: "Personalizado" },
];

/** Diferencia B → A con signo (A es el rango principal). */
function Delta({ a, b, money = true, better = "up" }: { a: number | null; b: number | null | undefined; money?: boolean; better?: "up" | "down" }) {
  if (b === undefined || a === null || b === null) return null;
  const d = a - b;
  if (Math.abs(d) < (money ? 1 : 0.005)) return <span className="block text-xs text-slate-500">= comparado</span>;
  const peor = better === "up" ? d < 0 : d > 0;
  return (
    <span className={cx("block text-xs tabular-nums", peor ? "text-red-600" : "text-slate-500")}>
      {d > 0 ? "+" : "−"}
      {money ? formatGs(Math.abs(d)) : formatQty(Math.abs(d), 2)} vs {money ? formatGs(b) : formatQty(b, 2)}
    </span>
  );
}

function Kpi({ label, value, sub, alert, children }: { label: string; value: string; sub?: string; alert?: boolean; children?: React.ReactNode }) {
  return (
    <div className="border border-slate-300 p-3">
      <p className="text-xs font-semibold">{label}</p>
      <p className={cx("text-lg font-semibold tabular-nums", alert && "text-red-600")}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
      {children}
    </div>
  );
}

/**
 * Tablero de costos de la obra (hoja "8 Resumen"). Lee del motor de costos: costo real del rango
 * y acumulado, venta, márgenes, valor ganado/planificado, IC, IP, costo proyectado y alertas.
 */
export const CostDashboard: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const hoy = todayIso();
  const [preset, setPreset] = useState<Preset>("mes");
  const [custom, setCustom] = useState({ desde: `${hoy.slice(0, 8)}01`, hasta: hoy });
  const [comparar, setComparar] = useState(false);
  const [cmpPreset, setCmpPreset] = useState<ComparePreset>("anterior");
  const [cmpCustom, setCmpCustom] = useState({ desde: "", hasta: "" });
  const [data, setData] = useState<CostDashboardData | null>(null);
  const [cmp, setCmp] = useState<CostDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<number | null>>(new Set());
  const [soloConMov, setSoloConMov] = useState(true);
  const [drill, setDrill] = useState<DashItemRow | null>(null);

  const rango = preset === "custom" ? custom : rangeFor(preset, hoy);

  const load = useCallback(async () => {
    if (rango.desde && rango.desde > rango.hasta) return;
    setLoading(true);
    try {
      const a = await api.getCostDashboard(project.id, rango.desde, rango.hasta);
      setData(a);
      if (comparar) {
        const r = cmpPreset === "anterior" ? previousRange(a.desde, a.hasta) : cmpCustom;
        setCmp(r.desde && r.hasta && r.desde <= r.hasta ? await api.getCostDashboard(project.id, r.desde, r.hasta) : null);
      } else setCmp(null);
    } catch (e: any) {
      showToast(e.message || "No se pudo calcular el tablero", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, rango.desde, rango.hasta, comparar, cmpPreset, cmpCustom.desde, cmpCustom.hasta, showToast]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const cmpItems = useMemo(() => new Map((cmp?.items ?? []).map((i) => [i.id, i])), [cmp]);
  const cmpRubros = useMemo(() => new Map((cmp?.rubros ?? []).map((r) => [r.id, r])), [cmp]);
  const itemsPorRubro = useMemo(() => {
    const m = new Map<number | null, DashItemRow[]>();
    for (const i of data?.items ?? []) {
      if (soloConMov && !i.costoReal && !i.ejecutado && !i.planificado) continue;
      m.set(i.rubroId, [...(m.get(i.rubroId) ?? []), i]);
    }
    return m;
  }, [data, soloConMov]);

  const o = data?.obra;
  const c = cmp?.obra;

  return (
    <div className="space-y-5 text-slate-900">
      {/* Rango y comparación */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              className={cx("border px-3 py-1.5 text-sm", preset === p.value ? "border-slate-900 font-semibold" : "border-slate-300")}
              onClick={() => setPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <>
            <input type="date" className={inputClass} value={custom.desde} onChange={(e) => setCustom({ ...custom, desde: e.target.value })} />
            <input type="date" className={inputClass} value={custom.hasta} max={hoy} onChange={(e) => setCustom({ ...custom, hasta: e.target.value })} />
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
          Comparar con
        </label>
        {comparar && (
          <>
            <select className={inputClass} value={cmpPreset} onChange={(e) => setCmpPreset(e.target.value as ComparePreset)}>
              <option value="anterior">Período anterior</option>
              <option value="custom">Otro rango</option>
            </select>
            {cmpPreset === "custom" && (
              <>
                <input type="date" className={inputClass} value={cmpCustom.desde} onChange={(e) => setCmpCustom({ ...cmpCustom, desde: e.target.value })} />
                <input type="date" className={inputClass} value={cmpCustom.hasta} onChange={(e) => setCmpCustom({ ...cmpCustom, hasta: e.target.value })} />
              </>
            )}
          </>
        )}
        {loading && <span className="text-sm text-slate-600">Calculando…</span>}
      </div>

      {data && o && (
        <>
          <p className="text-sm">
            <strong>
              {fmtDate(data.desde)} – {fmtDate(data.hasta)}
            </strong>
            {cmp && (
              <span className="text-slate-600">
                {" "}
                · comparado con {fmtDate(cmp.desde)} – {fmtDate(cmp.hasta)}
              </span>
            )}
            <span className="text-slate-600"> · inicio de obra {fmtDate(data.inicio)}</span>
            {data.origen !== "calculado" && <span className="text-slate-600"> · {data.origen === "snapshot" ? "cierre oficial" : "rango cerrado (caché)"}</span>}
          </p>

          {/* KPIs de la obra */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Venta sin IVA (certificable)" value={formatGs(o.ventaSinIva)}>
              <Delta a={o.ventaSinIva} b={c?.ventaSinIva} />
            </Kpi>
            <Kpi label="Costo real" value={formatGs(o.costoReal)} sub={`Incluye pérdidas de material ${formatGs(o.perdidas)}`}>
              <Delta a={o.costoReal} b={c?.costoReal} better="down" />
            </Kpi>
            <Kpi
              label="Margen real vs previsto"
              value={`${formatPct(o.margenRealPct, 1)} · ${formatGs(o.margenReal)}`}
              sub={`Previsto ${formatPct(o.margenPrevistoPct, 1)} · ${formatGs(o.margenPrevisto)}`}
              alert={o.margenRealPct !== null && o.margenPrevistoPct !== null && o.margenRealPct < o.margenPrevistoPct - 0.005}
            >
              <Delta a={o.margenReal} b={c?.margenReal} />
            </Kpi>
            <Kpi
              label="Costo proyectado al final"
              value={formatGs(o.eac)}
              sub={`Costo meta total ${formatGs(o.bac)} · ${o.desvioFinal >= 0 ? "ahorro" : "sobrecosto"} ${formatGs(Math.abs(o.desvioFinal))}`}
              alert={o.desvioFinal < 0}
            />
            <Kpi label="Valor ganado (VG)" value={formatGs(o.vg)}>
              <Delta a={o.vg} b={c?.vg} />
            </Kpi>
            <Kpi label="Valor planificado (VP)" value={formatGs(o.vp)}>
              <Delta a={o.vp} b={c?.vp} />
            </Kpi>
            <Kpi label="IC = VG ÷ costo real" value={idx(o.ic)} alert={o.ic !== null && o.ic < IC_MIN} sub={`Acumulado ${idx(o.icAcum)}`}>
              <Delta a={o.ic} b={c?.ic} money={false} />
            </Kpi>
            <Kpi label="IP = VG ÷ VP" value={idx(o.ip)} alert={o.ip !== null && o.ip < IP_MIN}>
              <Delta a={o.ip} b={c?.ip} money={false} />
            </Kpi>
          </div>
          <p className="text-xs text-slate-600">
            Total contable del rango {formatGs(o.totalContable)} = costo real {formatGs(o.costoReal)} + no imputado {formatGs(o.noImputado)}.
            {!o.validacionOk && <span className="font-semibold text-red-600"> El motor no valida el rango.</span>}
          </p>

          {/* Alertas */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Alertas ({data.alertas.length})</h3>
            {data.alertas.length ? (
              <ul className="divide-y divide-slate-100 border border-slate-300 text-sm">
                {data.alertas.map((a, i) => {
                  const it = a.itemId ? data.items.find((x) => x.id === a.itemId) : undefined;
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                      <span className="w-40 shrink-0 font-semibold text-red-600">{ALERTA[a.tipo]}</span>
                      <span className="font-medium">{a.ref}</span>
                      <span className="text-slate-700">{a.mensaje}</span>
                      {it && (
                        <button className="ml-auto text-xs underline" onClick={() => setDrill(it)}>
                          Ver documentos
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm">Sin alertas en el rango.</p>
            )}
          </section>

          {/* Curva S */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Curva S desde el inicio de obra</h3>
            <div className="border border-slate-300 p-3">
              <LineChart
                points={data.curva.map((p) => ({ label: p.fecha, values: { planificado: p.planificado, ganado: p.ganado, real: p.real } }))}
                series={[
                  { key: "planificado", label: "Planificado (VP)", color: "stroke-slate-400", fill: "bg-slate-400", dash: "6 4" },
                  { key: "ganado", label: "Ganado (VG)", color: "stroke-slate-900", fill: "bg-slate-900" },
                  { key: "real", label: "Costo real", color: "stroke-slate-600", fill: "bg-slate-600", dash: "2 3" },
                ]}
                format={(v) => formatGs(v)}
                labelFormat={curvaLabel(data.inicio < data.desde ? data.inicio : data.desde, data.hasta)}
              />
            </div>
            <p className="text-xs text-slate-600">Valores al costo meta (VP y VG) y costo contable acumulado. Ganado por debajo del real = IC menor a 1.</p>
          </section>

          {/* Rubros e ítems */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Por rubro e ítem</h3>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={soloConMov} onChange={(e) => setSoloConMov(e.target.checked)} />
                Solo ítems con movimiento
              </label>
            </div>
            <div className="overflow-x-auto border border-slate-300">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                    <th className="px-2 py-1.5">Rubro / ítem</th>
                    <th className={num}>Venta s/IVA</th>
                    <th className={num}>Costo real</th>
                    <th className={num}>Margen real</th>
                    <th className={num}>Previsto</th>
                    <th className={num}>VG</th>
                    <th className={num}>VP</th>
                    <th className={num}>IC</th>
                    <th className={num}>IP</th>
                    <th className={num}>Costo proyectado final</th>
                    <th className={num}>Resultado proyectado</th>
                    <th className="px-2 py-1.5">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rubros.map((r) => {
                    const open = abiertos.has(r.id);
                    const list = itemsPorRubro.get(r.id) ?? [];
                    if (soloConMov && !list.length) return null;
                    return (
                      <React.Fragment key={r.id ?? "sin"}>
                        <MetricsRow
                          label={
                            <button
                              className="flex items-center gap-1 font-semibold"
                              onClick={() =>
                                setAbiertos((s) => {
                                  const n = new Set(s);
                                  if (n.has(r.id)) n.delete(r.id);
                                  else n.add(r.id);
                                  return n;
                                })
                              }
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {codeName(r.code, r.name)}
                              <span className="font-normal text-slate-500">({list.length})</span>
                            </button>
                          }
                          m={r}
                          cmp={cmpRubros.get(r.id)}
                          strong
                        />
                        {open &&
                          list.map((i) => (
                            <MetricsRow
                              key={i.id}
                              label={
                                <button className="pl-5 text-left hover:underline" onClick={() => setDrill(i)} title="Ver los documentos que forman el costo">
                                  {codeName(i.code, i.name)}
                                  {i.sinCostoMeta && <span className="ml-1 text-xs text-slate-500">(sin costo meta)</span>}
                                </button>
                              }
                              m={i}
                              cmp={cmpItems.get(i.id)}
                            />
                          ))}
                      </React.Fragment>
                    );
                  })}
                  <MetricsRow label={<span className="font-semibold">Subtotal ítems</span>} m={data.subtotalItems} cmp={cmp?.subtotalItems} strong />
                  <tr className="border-b border-slate-100">
                    <td className="px-2 py-1.5">Pérdidas de material</td>
                    <td className={num} />
                    <td className={num}>{formatGs(o.perdidas)}</td>
                    <td className={cx(num, o.perdidas > 0 && "text-red-600")}>{o.perdidas ? `(${formatGs(o.perdidas)})` : "—"}</td>
                    <td colSpan={8} />
                  </tr>
                  <MetricsRow label={<span className="font-semibold">Resultado de la obra</span>} m={o} cmp={c} strong />
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-600">
              Tocá un ítem para ver los documentos, insumos y horas que forman su costo. Costo proyectado final = costo meta total ÷ IC acumulado desde el inicio de obra;
              resultado proyectado = venta total sin IVA − costo proyectado. Las pérdidas de material van aparte: no ensucian los ítems pero bajan el resultado de la obra.
            </p>
          </section>

          {data.avisos.length > 0 && (
            <section className="space-y-1 text-sm">
              <h3 className="font-semibold">Avisos del motor</h3>
              {data.avisos.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </section>
          )}

          {drill && <ItemDrillDrawer project={project} item={drill} desde={data.desde} hasta={data.hasta} onClose={() => setDrill(null)} showToast={showToast} />}
        </>
      )}
    </div>
  );
};

/** Eje X de la curva S: días ("28/9") si el lapso es menor a ~2 meses; si no, meses ("sep 26"). */
function curvaLabel(desde: string, hasta: string) {
  return curvaPorDias(desde, hasta) ? (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : monthLabel;
}

const ALERTA: Record<string, string> = {
  IC: "IC bajo",
  IP: "IP bajo",
  DESVIO_MATERIAL: "Desvío de material",
  ACU_SOBRE_OFERTA: "ACU sobre la oferta",
  NO_IMPUTADO: "No imputado alto",
  VALIDACION: "Validación",
};

function MetricsRow({ label, m, cmp, strong }: { label: React.ReactNode; m: DashMetrics; cmp?: DashMetrics; strong?: boolean }) {
  const cls = cx("border-b border-slate-100", strong && "font-semibold");
  const margenBajo = m.margenRealPct !== null && m.margenPrevistoPct !== null && m.ventaSinIva > 0 && m.margenRealPct < m.margenPrevistoPct - 0.005;
  return (
    <tr className={cls}>
      <td className="px-2 py-1.5">{label}</td>
      <td className={num}>{formatGs(m.ventaSinIva)}</td>
      <td className={num}>
        {formatGs(m.costoReal)}
        {cmp && <span className="block text-xs font-normal text-slate-500">{formatGs(cmp.costoReal)}</span>}
      </td>
      <td className={cx(num, margenBajo && "text-red-600")}>{m.ventaSinIva ? formatPct(m.margenRealPct, 1) : "—"}</td>
      <td className={num}>{m.margenPrevistoPct === null ? "—" : formatPct(m.margenPrevistoPct, 1)}</td>
      <td className={num}>{formatGs(m.vg)}</td>
      <td className={num}>{formatGs(m.vp)}</td>
      <td className={cx(num, m.ic !== null && m.ic < IC_MIN && "text-red-600")}>
        {idx(m.ic)}
        {cmp && <span className="block text-xs font-normal text-slate-500">{idx(cmp.ic)}</span>}
      </td>
      <td className={cx(num, m.ip !== null && m.ip < IP_MIN && "text-red-600")}>
        {idx(m.ip)}
        {cmp && <span className="block text-xs font-normal text-slate-500">{idx(cmp.ip)}</span>}
      </td>
      <td className={cx(num, m.desvioFinal < -1 && "text-red-600")} title={`Costo meta total ${formatGs(m.bac)}`}>
        {formatGs(m.eac)}
      </td>
      <td className={cx(num, m.resultadoProyectado < 0 && "text-red-600")}>{formatGs(m.resultadoProyectado)}</td>
      <td className={cx("px-2 py-1.5 text-xs font-normal whitespace-nowrap", m.diagnostico && /sobrecosto|Atrasado/.test(m.diagnostico) && "text-red-600")}>{m.diagnostico ?? "—"}</td>
    </tr>
  );
}
