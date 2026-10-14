import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { api } from "../api";
import type { PrevistoEjecutadoData, Project } from "../types";
import { Button, Card, EmptyState, Field, inputClass } from "../ui";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { todayIso } from "../insumos/labels";
import { buildPrevistoView, montosPorNodo, totalesGenerales } from "./previstoModel";
import { exportPrevistoEjecutado } from "./exportPrevisto";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const num = "text-right tabular-nums whitespace-nowrap px-2 py-1.5";

/**
 * Planilla general Previsto vs Ejecutado (Centro de Costos). Presupuesto original congelado +
 * adendas: cantidad contractual, Δ por adenda, cantidad real (vigente) y cantidad ejecutada
 * (medición de los certificados al cliente) a la fecha de corte. Los precios no cambian.
 */
export function PrevistoEjecutadoPanel({ project, showToast }: { project: Project; showToast: Toast }) {
  const [al, setAl] = useState(todayIso());
  const [data, setData] = useState<PrevistoEjecutadoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [soloDesvio, setSoloDesvio] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getPrevistoEjecutado(project.id, al));
    } catch (e: any) {
      showToast(e.message || "No se pudo armar la planilla", "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, al, showToast]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const visibles = useMemo(
    () => (data ? buildPrevistoView(data.rows, { search, soloConDesvio: soloDesvio, collapsed }) : []),
    [data, search, soloDesvio, collapsed]
  );
  const totales = useMemo(() => (data ? totalesGenerales(data.rows) : null), [data]);
  const montos = useMemo(() => (data ? montosPorNodo(data.rows) : new Map()), [data]);
  const filtrada = Boolean(search.trim()) || soloDesvio;

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!data) {
    return <p className="text-sm text-slate-600">{loading ? "Armando la planilla…" : "Sin datos de presupuesto."}</p>;
  }
  if (!data.rows.length) {
    return <EmptyState title="Sin presupuesto" help="Cargá el presupuesto desde Importar presupuesto para armar la planilla." />;
  }

  return (
    <div className="space-y-3 text-slate-900">
      {!data.congelado && (
        <p className="text-sm">
          El presupuesto todavía no está congelado: las cantidades contractuales son las actuales. Congelalo en la pestaña Adendas para que sea el contrato original.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Al" className="w-40">
          <input type="date" className={inputClass} value={al} onChange={(e) => setAl(e.target.value)} />
        </Field>
        <Field label="Buscar" className="w-64">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className={`${inputClass} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código o descripción" />
          </div>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={soloDesvio} onChange={(e) => setSoloDesvio(e.target.checked)} />
          Solo con desvío
        </label>
        <div className="ml-auto flex gap-2">
          <Button icon={<Download className="h-4 w-4" />} onClick={() => exportPrevistoEjecutado(data, project.code, filtrada, visibles)}>
            Exportar Excel
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Contractual = presupuesto congelado · Real = contractual ± adendas aprobadas hasta la fecha · Ejecutada = medición de los certificados al cliente hasta la fecha.
        {data.adendas.length ? ` Adendas incluidas: ${data.adendas.map((a) => `N° ${a.numero}`).join(", ")}.` : " Sin adendas aprobadas a esta fecha."}
      </p>

      <Card padded={false}>
        <div className="overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left text-slate-900">
                <th className="sticky left-0 z-10 bg-white px-2 py-2 font-semibold">Ítem</th>
                <th className="sticky left-[110px] z-10 bg-white px-2 py-2 font-semibold">Descripción</th>
                <th className="px-2 py-2 font-semibold">Un.</th>
                <th className={`${num} font-semibold`}>P.U. s/IVA</th>
                <th className={`${num} font-semibold`}>Cant. contractual</th>
                {data.adendas.map((a) => (
                  <th key={a.id} className={`${num} font-semibold`} title={a.titulo}>
                    Adenda N° {a.numero} (Δ)
                  </th>
                ))}
                <th className={`${num} font-semibold`}>Cant. real</th>
                <th className={`${num} font-semibold`}>Cant. ejecutada</th>
                <th className={`${num} font-semibold`}>Saldo cant.</th>
                <th className={`${num} font-semibold`}>% ejec.</th>
                <th className={`${num} font-semibold`}>Monto contractual</th>
                <th className={`${num} font-semibold`}>Monto real</th>
                <th className={`${num} font-semibold`}>Monto ejecutado</th>
                <th className={`${num} font-semibold`}>Saldo Gs.</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(({ row: r, depth, hasChildren, montos: m }) => {
                const esRubro = r.nodeKind !== "ITEM";
                const m2 = esRubro ? montos.get(r.id) ?? m : m;
                return (
                  <tr key={r.id} className={`border-t border-slate-200 ${esRubro ? "font-semibold" : ""}`}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5 font-mono">
                      <span className="inline-flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
                        {hasChildren ? (
                          <button className="text-slate-600" onClick={() => toggle(r.id)} aria-label="Plegar o desplegar" disabled={filtrada}>
                            {collapsed.has(r.id) && !filtrada ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                        {r.code}
                      </span>
                    </td>
                    <td className="sticky left-[110px] z-10 bg-white px-2 py-1.5">
                      {r.name}
                      {r.isExtra && <span className="ml-2 text-xs text-slate-600">Extra · Adenda N° {r.extraAdendaNumero}</span>}
                    </td>
                    <td className="px-2 py-1.5">{r.unit ?? ""}</td>
                    <td className={num}>{esRubro ? "" : formatGs(r.unitPrice)}</td>
                    <td className={num}>{esRubro ? "" : formatQty(r.contractQty)}</td>
                    {data.adendas.map((a) => (
                      <td key={a.id} className={num}>
                        {esRubro ? "" : formatQty(r.deltas[a.id] ?? 0)}
                      </td>
                    ))}
                    <td className={num}>{esRubro ? "" : formatQty(r.realQty)}</td>
                    <td className={num}>{esRubro ? "" : formatQty(r.executedQty)}</td>
                    <td className={`${num} ${!esRubro && (r.saldoQty ?? 0) < 0 ? "text-red-600" : ""}`}>{esRubro ? "" : formatQty(r.saldoQty)}</td>
                    <td className={`${num} ${!esRubro && r.exceeded ? "text-red-600" : ""}`}>{esRubro ? "" : formatPct(r.pct, 1)}</td>
                    <td className={num}>{formatGs(m2.contractAmount)}</td>
                    <td className={num}>{formatGs(m2.realAmount)}</td>
                    <td className={num}>{formatGs(m2.executedAmount)}</td>
                    <td className={`${num} ${m2.saldoAmount < 0 ? "text-red-600" : ""}`}>{formatGs(m2.saldoAmount)}</td>
                  </tr>
                );
              })}
              {!visibles.length && (
                <tr>
                  <td colSpan={data.adendas.length + 13} className="px-3 py-6 text-center text-slate-600">
                    Ningún ítem coincide con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
            {totales && (
              <tfoot>
                <tr className="border-t-2 border-slate-900 font-semibold">
                  <td className="sticky left-0 z-10 bg-white px-2 py-2" colSpan={2}>
                    TOTAL GENERAL
                  </td>
                  <td colSpan={3 + data.adendas.length + 4} />
                  <td className={num}>{formatGs(totales.contractAmount)}</td>
                  <td className={num}>{formatGs(totales.realAmount)}</td>
                  <td className={num}>{formatGs(totales.executedAmount)}</td>
                  <td className={`${num} ${totales.saldoAmount < 0 ? "text-red-600" : ""}`}>{formatGs(totales.saldoAmount)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      {loading && <p className="text-xs text-slate-500">Actualizando…</p>}
    </div>
  );
}
