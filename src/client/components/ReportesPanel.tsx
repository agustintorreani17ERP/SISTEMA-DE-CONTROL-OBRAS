import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { BarChart3, Download } from "lucide-react";
import { api } from "../api";
import { Project } from "../types";
import { formatGs } from "../utils/numbers";
import { todayIso } from "../insumos/labels";
import { type Preset, rangeFor } from "../dashboard/ranges";

interface Props {
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Reporte = "estado-resultados" | "balance" | "flujo-caja" | "iva-posicion" | "resumen-obras";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mes" },
  { value: "inicio", label: "Desde el inicio" },
  { value: "custom", label: "Personalizado" },
];

const inputClass = "rounded-lg border border-slate-300 px-2 py-1.5 text-xs";

function downloadSheet(filename: string, sheets: { name: string; rows: (string | number)[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
      <Download className="h-3.5 w-3.5" /> Exportar a Excel
    </button>
  );
}

export const ReportesPanel: React.FC<Props> = ({ showToast }) => {
  const hoy = todayIso();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [preset, setPreset] = useState<Preset>("mes");
  const [custom, setCustom] = useState({ desde: `${hoy.slice(0, 8)}01`, hasta: hoy });
  const [reporte, setReporte] = useState<Reporte>("estado-resultados");

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {});
  }, []);

  const rango = preset === "custom" ? custom : rangeFor(preset, hoy);
  const desde = rango.desde ?? undefined;
  const obraLabel = projectId ? projects.find((p) => p.id === projectId)?.code ?? "obra" : "consolidado";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Reportes</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
            <option value="">Consolidado (todas las obras)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${preset === p.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600"}`}
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
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {([
          ["estado-resultados", "Estado de resultados"],
          ["balance", "Balance"],
          ["flujo-caja", "Flujo de caja"],
          ["iva-posicion", "Posición de IVA"],
          ["resumen-obras", "Resumen por obra"],
        ] as [Reporte, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setReporte(k)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              reporte === k ? "bg-blue-50 text-blue-700 border border-blue-200" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {reporte === "estado-resultados" && <EstadoResultados projectId={projectId || undefined} desde={desde} hasta={rango.hasta} obraLabel={obraLabel} showToast={showToast} />}
      {reporte === "balance" && <Balance projectId={projectId || undefined} hasta={rango.hasta} obraLabel={obraLabel} showToast={showToast} />}
      {reporte === "flujo-caja" && <FlujoCaja projectId={projectId || undefined} desde={desde} hasta={rango.hasta} obraLabel={obraLabel} showToast={showToast} />}
      {reporte === "iva-posicion" && <IvaPosicion projectId={projectId || undefined} desde={desde} hasta={rango.hasta} obraLabel={obraLabel} showToast={showToast} />}
      {reporte === "resumen-obras" && <ResumenObras projectId={projectId || undefined} desde={desde} hasta={rango.hasta} obraLabel={obraLabel} showToast={showToast} />}
    </div>
  );
};

function EstadoResultados({ projectId, desde, hasta, obraLabel, showToast }: { projectId?: number; desde?: string; hasta: string; obraLabel: string; showToast: Props["showToast"] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getEstadoResultados>> | null>(null);
  useEffect(() => {
    api.getEstadoResultados({ projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const rows: (string | number)[][] = [["Obra", "Ingresos", "Costos", "Resultado"]];
    for (const r of data.porObra) rows.push([r.obra.code, r.ingresos, r.costos, r.resultado]);
    rows.push(["CONSOLIDADO", data.consolidado.ingresos, data.consolidado.costos, data.consolidado.resultado]);
    downloadSheet(`Estado_Resultados_${obraLabel}.xlsx`, [{ name: "Estado de resultados", rows }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportar} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Obra</th>
              <th className="px-3 py-2 text-right">Ingresos (sin IVA)</th>
              <th className="px-3 py-2 text-right">Costos</th>
              <th className="px-3 py-2 text-right">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.porObra.map((r) => (
              <tr key={r.obra.id}>
                <td className="px-3 py-2 font-bold">{r.obra.code} — {r.obra.name}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(r.ingresos)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(r.costos)}</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${r.resultado < 0 ? "text-rose-600" : "text-emerald-700"}`}>{formatGs(r.resultado)}</td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                <td className="px-3 py-2">CONSOLIDADO</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(data.consolidado.ingresos)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(data.consolidado.costos)}</td>
                <td className={`px-3 py-2 text-right font-mono ${data.consolidado.resultado < 0 ? "text-rose-600" : "text-emerald-700"}`}>{formatGs(data.consolidado.resultado)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Balance({ projectId, hasta, obraLabel, showToast }: { projectId?: number; hasta: string; obraLabel: string; showToast: Props["showToast"] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getBalance>> | null>(null);
  useEffect(() => {
    api.getBalance({ projectId, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const section = (title: string, rows: { cuenta: { codigo: string; nombre: string }; saldo: number }[]) => [
      [title], ...rows.map((r) => [r.cuenta.codigo, r.cuenta.nombre, r.saldo]), [],
    ];
    const rows: (string | number)[][] = [
      ...section("ACTIVO", data.activo as any),
      ["TOTAL ACTIVO", "", data.totalActivo],
      [],
      ...section("PASIVO", data.pasivo as any),
      ["TOTAL PASIVO", "", data.totalPasivo],
      [],
      ...section("PATRIMONIO", data.patrimonio as any),
      ["Resultado del ejercicio", "", data.resultadoDelEjercicio],
      ["TOTAL PATRIMONIO", "", data.totalPatrimonio],
    ];
    downloadSheet(`Balance_${obraLabel}_${hasta}.xlsx`, [{ name: "Balance", rows }]);
  };

  const Section = ({ title, rows, total, totalLabel }: { title: string; rows: { cuenta: { codigo: string; nombre: string }; saldo: number }[]; total: number; totalLabel: string }) => (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-100 bg-slate-50 p-2.5 text-xs font-bold text-slate-800">{title}</div>
      <table className="w-full text-xs">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.cuenta.codigo}>
              <td className="px-3 py-1.5 font-mono">{r.cuenta.codigo}</td>
              <td className="px-3 py-1.5">{r.cuenta.nombre}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatGs(r.saldo)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50 font-bold">
            <td colSpan={2} className="px-3 py-1.5">{totalLabel}</td>
            <td className="px-3 py-1.5 text-right font-mono">{formatGs(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {data && !data.cuadra && <span className="text-xs font-bold text-rose-600">El balance no cuadra: revisá los asientos.</span>}
        <div className="ml-auto">
          <ExportButton onClick={exportar} />
        </div>
      </div>
      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Activo" rows={data.activo} total={data.totalActivo} totalLabel="Total activo" />
          <div className="space-y-4">
            <Section title="Pasivo" rows={data.pasivo} total={data.totalPasivo} totalLabel="Total pasivo" />
            <Section
              title="Patrimonio"
              rows={[...data.patrimonio, { cuenta: { codigo: "", nombre: "Resultado del ejercicio" }, saldo: data.resultadoDelEjercicio }]}
              total={data.totalPatrimonio}
              totalLabel="Total patrimonio"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FlujoCaja({ projectId, desde, hasta, obraLabel, showToast }: { projectId?: number; desde?: string; hasta: string; obraLabel: string; showToast: Props["showToast"] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getFlujoCaja>> | null>(null);
  useEffect(() => {
    api.getFlujoCaja({ projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const real: (string | number)[][] = [["Fecha", "Ingresos", "Egresos", "Neto", "Saldo acumulado"]];
    for (const r of data.real) real.push([r.fecha, r.ingresos, r.egresos, r.neto, r.saldoAcumulado]);
    const proyectado: (string | number)[][] = [["Días", "Ingresos esperados", "Egresos esperados", "Neto"]];
    for (const p of data.proyectado) proyectado.push([p.dias, p.ingresosEsperados, p.egresosEsperados, p.neto]);
    downloadSheet(`Flujo_Caja_${obraLabel}.xlsx`, [
      { name: "Real", rows: real },
      { name: "Proyectado", rows: proyectado },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportar} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {data?.proyectado.map((p) => (
          <div key={p.dias} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
            <p className="text-[10px] font-bold uppercase text-slate-500">Proyectado a {p.dias} días</p>
            <p className="mt-1 text-xs">Ingresos esperados: <span className="font-mono font-bold text-emerald-700">{formatGs(p.ingresosEsperados)}</span></p>
            <p className="text-xs">Egresos esperados: <span className="font-mono font-bold text-rose-700">{formatGs(p.egresosEsperados)}</span></p>
            <p className="mt-1 border-t border-slate-100 pt-1 text-xs font-bold">Neto: <span className="font-mono">{formatGs(p.neto)}</span></p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 p-2.5 text-xs font-bold text-slate-800">Flujo real (movimientos confirmados)</div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-1.5 text-left">Fecha</th>
                <th className="px-3 py-1.5 text-right">Ingresos</th>
                <th className="px-3 py-1.5 text-right">Egresos</th>
                <th className="px-3 py-1.5 text-right">Neto</th>
                <th className="px-3 py-1.5 text-right">Saldo acumulado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.real.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">Sin movimientos en el rango.</td>
                </tr>
              )}
              {data?.real.map((r) => (
                <tr key={r.fecha}>
                  <td className="px-3 py-1.5">{r.fecha.split("-").reverse().join("/")}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatGs(r.ingresos)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatGs(r.egresos)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatGs(r.neto)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold">{formatGs(r.saldoAcumulado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IvaPosicion({ projectId, desde, hasta, obraLabel, showToast }: { projectId?: number; desde?: string; hasta: string; obraLabel: string; showToast: Props["showToast"] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getIvaPosicion>> | null>(null);
  useEffect(() => {
    api.getIvaPosicion({ projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const rows: (string | number)[][] = [["Mes", "Débito fiscal (ventas)", "Crédito fiscal (compras)", "Posición"]];
    for (const m of data.meses) rows.push([m.mes, m.debitoFiscal, m.creditoFiscal, m.posicion]);
    downloadSheet(`Posicion_IVA_${obraLabel}.xlsx`, [{ name: "IVA mensual", rows }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportar} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-right">Débito fiscal (ventas)</th>
              <th className="px-3 py-2 text-right">Crédito fiscal (compras)</th>
              <th className="px-3 py-2 text-right">Posición</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.meses.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-400">Sin facturas en el rango.</td>
              </tr>
            )}
            {data?.meses.map((m) => (
              <tr key={m.mes}>
                <td className="px-3 py-2 font-mono font-bold">{m.mes}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(m.debitoFiscal)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(m.creditoFiscal)}</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${m.posicion > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  {formatGs(m.posicion)} {m.posicion > 0 ? "(a pagar)" : "(saldo a favor)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResumenObras({ projectId, desde, hasta, obraLabel, showToast }: { projectId?: number; desde?: string; hasta: string; obraLabel: string; showToast: Props["showToast"] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getResumenObras>> | null>(null);
  useEffect(() => {
    api.getResumenObras({ projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const header = ["Obra", "Facturado", "Cobrado", "Por cobrar", "Anticipos pendientes", "Fondo de reparo pendiente", "Pagado", "Por pagar"];
    const rows: (string | number)[][] = [header];
    for (const f of data.filas) rows.push([f.obra.code, f.facturado, f.cobrado, f.porCobrar, f.anticipos, f.fondoReparo, f.pagado, f.porPagar]);
    downloadSheet(`Resumen_Obras_${obraLabel}.xlsx`, [{ name: "Resumen por obra", rows }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportar} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">Obra</th>
              <th className="px-2 py-2 text-right">Facturado</th>
              <th className="px-2 py-2 text-right">Cobrado</th>
              <th className="px-2 py-2 text-right">Por cobrar</th>
              <th className="px-2 py-2 text-right">Anticipos</th>
              <th className="px-2 py-2 text-right">Fondo de reparo</th>
              <th className="px-2 py-2 text-right">Pagado</th>
              <th className="px-2 py-2 text-right">Por pagar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-slate-400">Sin obras.</td>
              </tr>
            )}
            {data?.filas.map((f) => (
              <tr key={f.obra.id}>
                <td className="px-2 py-2 font-bold">{f.obra.code} — {f.obra.name}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.facturado)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.cobrado)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.porCobrar)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.anticipos)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.fondoReparo)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.pagado)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatGs(f.porPagar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
