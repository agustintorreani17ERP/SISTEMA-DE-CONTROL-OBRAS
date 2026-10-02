import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { BookOpen, Download, ChevronLeft } from "lucide-react";
import { api } from "../api";
import { Project } from "../types";
import { formatDate } from "../utils/format";
import { formatGs } from "../utils/numbers";
import { todayIso } from "../insumos/labels";

interface Props {
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Libro = "ingresos-egresos" | "diario" | "mayor" | "iva-compras" | "iva-ventas";

const firstDayOfYearIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
};

const inputClass = "rounded-lg border border-slate-300 px-2 py-1.5 text-xs";

function downloadSheet(filename: string, sheets: { name: string; rows: (string | number)[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export const LibrosPanel: React.FC<Props> = ({ showToast }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [desde, setDesde] = useState(firstDayOfYearIso());
  const [hasta, setHasta] = useState(todayIso());
  const [libro, setLibro] = useState<Libro>("ingresos-egresos");

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {});
  }, []);

  const obraLabel = projectId ? projects.find((p) => p.id === projectId)?.code ?? "obra" : "todas-las-obras";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Libros contables</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Obra</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
              <option value="">Todas las obras</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {([
          ["ingresos-egresos", "Ingresos y Egresos"],
          ["diario", "Libro Diario"],
          ["mayor", "Libro Mayor"],
          ["iva-compras", "IVA Compras"],
          ["iva-ventas", "IVA Ventas"],
        ] as [Libro, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setLibro(k)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              libro === k ? "bg-blue-50 text-blue-700 border border-blue-200" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {libro === "ingresos-egresos" && (
        <LibroIngresosEgresos projectId={projectId || undefined} desde={desde} hasta={hasta} obraLabel={obraLabel} showToast={showToast} />
      )}
      {libro === "diario" && <LibroDiario projectId={projectId || undefined} desde={desde} hasta={hasta} obraLabel={obraLabel} showToast={showToast} />}
      {libro === "mayor" && <LibroMayor projectId={projectId || undefined} desde={desde} hasta={hasta} obraLabel={obraLabel} showToast={showToast} />}
      {libro === "iva-compras" && (
        <LibroIva tipo="COMPRAS" projectId={projectId || undefined} desde={desde} hasta={hasta} obraLabel={obraLabel} showToast={showToast} />
      )}
      {libro === "iva-ventas" && (
        <LibroIva tipo="VENTAS" projectId={projectId || undefined} desde={desde} hasta={hasta} obraLabel={obraLabel} showToast={showToast} />
      )}
    </div>
  );
};

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
      <Download className="h-3.5 w-3.5" /> Exportar a Excel
    </button>
  );
}

function LibroIngresosEgresos({
  projectId,
  desde,
  hasta,
  obraLabel,
  showToast,
}: {
  projectId?: number;
  desde: string;
  hasta: string;
  obraLabel: string;
  showToast: Props["showToast"];
}) {
  const [vista, setVista] = useState<"DEVENGADO" | "PERCIBIDO">("DEVENGADO");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getLibroIngresosEgresos>> | null>(null);

  const load = useCallback(() => {
    api.getLibroIngresosEgresos({ projectId, desde, hasta, vista }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, vista, showToast]);
  useEffect(load, [load]);

  const exportar = () => {
    if (!data) return;
    const header = ["Fecha", "Obra", "Comprobante", "Tercero", "Concepto", "Monto"];
    downloadSheet(`Ingresos_Egresos_${vista}_${obraLabel}.xlsx`, [
      { name: "Ingresos", rows: [header, ...data.ingresos.map((r) => [formatDate(r.fecha), r.obra, r.comprobante, r.tercero, r.concepto, r.monto]), ["", "", "", "", "TOTAL", data.totalIngresos]] },
      { name: "Egresos", rows: [header, ...data.egresos.map((r) => [formatDate(r.fecha), r.obra, r.comprobante, r.tercero, r.concepto, r.monto]), ["", "", "", "", "TOTAL", data.totalEgresos]] },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button
            onClick={() => setVista("DEVENGADO")}
            className={`rounded-lg px-3 py-1 text-xs font-bold ${vista === "DEVENGADO" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Devengado (facturado)
          </button>
          <button
            onClick={() => setVista("PERCIBIDO")}
            className={`rounded-lg px-3 py-1 text-xs font-bold ${vista === "PERCIBIDO" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Cobrado / Pagado
          </button>
        </div>
        <ExportButton onClick={exportar} />
      </div>

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BookTable title="Ingresos" rows={data.ingresos} total={data.totalIngresos} color="emerald" />
          <BookTable title="Egresos" rows={data.egresos} total={data.totalEgresos} color="rose" />
        </div>
      )}
      {data && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-right text-xs font-bold">
          Saldo del período: <span className="font-mono">{formatGs(data.saldo)}</span>
        </div>
      )}
    </div>
  );
}

function BookTable({
  title,
  rows,
  total,
  color,
}: {
  title: string;
  rows: { fecha: string; obra: string; comprobante: string; tercero: string; concepto: string; monto: number }[];
  total: number;
  color: "emerald" | "rose";
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className={`border-b border-slate-100 p-2.5 text-xs font-bold ${color === "emerald" ? "text-emerald-700" : "text-rose-700"}`}>{title}</div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left">Fecha</th>
              <th className="px-2 py-1.5 text-left">Comprobante</th>
              <th className="px-2 py-1.5 text-left">Tercero</th>
              <th className="px-2 py-1.5 text-right">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-slate-400">
                  Sin registros.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">{formatDate(r.fecha)}</td>
                <td className="px-2 py-1.5 font-mono">{r.comprobante}</td>
                <td className="px-2 py-1.5">{r.tercero}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(r.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold">
        <span>Total</span>
        <span className="font-mono">{formatGs(total)}</span>
      </div>
    </div>
  );
}

function LibroDiario({
  projectId,
  desde,
  hasta,
  obraLabel,
  showToast,
}: {
  projectId?: number;
  desde: string;
  hasta: string;
  obraLabel: string;
  showToast: Props["showToast"];
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getLibroDiario>> | null>(null);

  useEffect(() => {
    api.getLibroDiario({ projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const rows: (string | number)[][] = [["Fecha", "Obra", "Concepto", "Cuenta", "Debe", "Haber"]];
    for (const a of data.asientos) {
      for (const l of a.lineas) {
        rows.push([formatDate(a.fecha), a.obra, a.concepto, `${l.cuentaCodigo} — ${l.cuentaNombre}`, l.debe || "", l.haber || ""]);
      }
    }
    rows.push(["", "", "", "TOTAL", data.totalDebe, data.totalHaber]);
    downloadSheet(`Libro_Diario_${obraLabel}.xlsx`, [{ name: "Diario", rows }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportar} />
      </div>
      <div className="space-y-2">
        {data?.asientos.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">Sin asientos en el rango.</p>}
        {data?.asientos.map((a) => (
          <div key={a.id} className={`rounded-2xl border bg-white p-3 shadow-xs ${a.anulado ? "opacity-50" : "border-slate-200"}`}>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">
                #{a.id} · {formatDate(a.fecha)} · {a.obra}
              </span>
              <span className="text-slate-500">{a.concepto}</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {a.lineas.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pl-4">{l.cuentaCodigo} — {l.cuentaNombre}</td>
                    <td className="py-1 text-right font-mono">{l.debe ? formatGs(l.debe) : ""}</td>
                    <td className="py-1 pr-2 text-right font-mono">{l.haber ? formatGs(l.haber) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {data && (
        <div className="flex justify-end gap-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold">
          <span>Total Debe: <span className="font-mono">{formatGs(data.totalDebe)}</span></span>
          <span>Total Haber: <span className="font-mono">{formatGs(data.totalHaber)}</span></span>
        </div>
      )}
    </div>
  );
}

function LibroMayor({
  projectId,
  desde,
  hasta,
  obraLabel,
  showToast,
}: {
  projectId?: number;
  desde: string;
  hasta: string;
  obraLabel: string;
  showToast: Props["showToast"];
}) {
  const [resumen, setResumen] = useState<Awaited<ReturnType<typeof api.getLibroMayorResumen>> | null>(null);
  const [detalle, setDetalle] = useState<Awaited<ReturnType<typeof api.getLibroMayorDetalle>> | null>(null);

  useEffect(() => {
    setDetalle(null);
    api.getLibroMayorResumen({ projectId, desde, hasta }).then(setResumen).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [projectId, desde, hasta, showToast]);

  const abrirCuenta = (cuentaId: number) => {
    api.getLibroMayorDetalle({ projectId, desde, hasta, cuentaId }).then(setDetalle).catch((err) => showToast(err.message || "Error al cargar", "error"));
  };

  const exportarResumen = () => {
    if (!resumen) return;
    const rows: (string | number)[][] = [["Cuenta", "Nombre", "Debe", "Haber", "Saldo"]];
    for (const c of resumen.cuentas) rows.push([c.cuenta.codigo, c.cuenta.nombre, c.debe, c.haber, c.saldo]);
    downloadSheet(`Libro_Mayor_${obraLabel}.xlsx`, [{ name: "Mayor", rows }]);
  };

  const exportarDetalle = () => {
    if (!detalle) return;
    const rows: (string | number)[][] = [["Fecha", "Concepto", "Debe", "Haber", "Saldo"]];
    rows.push(["", "Saldo inicial", "", "", detalle.saldoInicial]);
    for (const m of detalle.movimientos) rows.push([formatDate(m.fecha), m.concepto, m.debe || "", m.haber || "", m.saldo]);
    rows.push(["", "Saldo final", "", "", detalle.saldoFinal]);
    downloadSheet(`Mayor_${detalle.cuenta.codigo}_${obraLabel}.xlsx`, [{ name: detalle.cuenta.codigo, rows }]);
  };

  if (detalle) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setDetalle(null)} className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900">
            <ChevronLeft className="h-4 w-4" /> Volver al resumen
          </button>
          <ExportButton onClick={exportarDetalle} />
        </div>
        <h4 className="text-sm font-bold text-slate-900">
          {detalle.cuenta.codigo} — {detalle.cuenta.nombre}
        </h4>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left">Fecha</th>
                <th className="px-2 py-1.5 text-left">Concepto</th>
                <th className="px-2 py-1.5 text-right">Debe</th>
                <th className="px-2 py-1.5 text-right">Haber</th>
                <th className="px-2 py-1.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50 font-bold">
                <td colSpan={4} className="px-2 py-1.5">Saldo inicial</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(detalle.saldoInicial)}</td>
              </tr>
              {detalle.movimientos.map((m, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">{formatDate(m.fecha)}</td>
                  <td className="px-2 py-1.5">{m.concepto}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{m.debe ? formatGs(m.debe) : ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{m.haber ? formatGs(m.haber) : ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{formatGs(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportButton onClick={exportarResumen} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left">Cuenta</th>
              <th className="px-2 py-1.5 text-right">Debe</th>
              <th className="px-2 py-1.5 text-right">Haber</th>
              <th className="px-2 py-1.5 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resumen?.cuentas.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-slate-400">
                  Sin movimientos en el rango.
                </td>
              </tr>
            )}
            {resumen?.cuentas.map((c) => (
              <tr key={c.cuenta.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => abrirCuenta(c.cuenta.id)}>
                <td className="px-2 py-1.5 font-mono font-bold">
                  {c.cuenta.codigo} — {c.cuenta.nombre}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(c.debe)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(c.haber)}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">{formatGs(c.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LibroIva({
  tipo,
  projectId,
  desde,
  hasta,
  obraLabel,
  showToast,
}: {
  tipo: "COMPRAS" | "VENTAS";
  projectId?: number;
  desde: string;
  hasta: string;
  obraLabel: string;
  showToast: Props["showToast"];
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getLibroIva>> | null>(null);

  useEffect(() => {
    api.getLibroIva({ tipo, projectId, desde, hasta }).then(setData).catch((err) => showToast(err.message || "Error al cargar", "error"));
  }, [tipo, projectId, desde, hasta, showToast]);

  const exportar = () => {
    if (!data) return;
    const header = ["Fecha", "RUC", "Razón social", "Timbrado", "N° Factura", "Gravado 10%", "IVA 10%", "Gravado 5%", "IVA 5%", "Exento", "IVA Total", "Total"];
    const rows: (string | number)[][] = [header];
    for (const f of data.filas) {
      rows.push([formatDate(f.fecha), f.ruc, f.razonSocial, f.timbrado, f.numero, f.gravado10, f.iva10, f.gravado5, f.iva5, f.exento, f.ivaTotal, f.total]);
    }
    rows.push([
      "", "", "", "", "TOTAL",
      data.totales.gravado10, data.totales.iva10, data.totales.gravado5, data.totales.iva5, data.totales.exento, data.totales.ivaTotal, data.totales.total,
    ]);
    downloadSheet(`Libro_IVA_${tipo}_${obraLabel}.xlsx`, [{ name: tipo, rows }]);
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
              <th className="px-2 py-1.5 text-left">Fecha</th>
              <th className="px-2 py-1.5 text-left">RUC</th>
              <th className="px-2 py-1.5 text-left">Razón social</th>
              <th className="px-2 py-1.5 text-left">Timbrado</th>
              <th className="px-2 py-1.5 text-left">N° Factura</th>
              <th className="px-2 py-1.5 text-right">Gravado 10%</th>
              <th className="px-2 py-1.5 text-right">IVA 10%</th>
              <th className="px-2 py-1.5 text-right">Gravado 5%</th>
              <th className="px-2 py-1.5 text-right">IVA 5%</th>
              <th className="px-2 py-1.5 text-right">Exento</th>
              <th className="px-2 py-1.5 text-right">IVA Total</th>
              <th className="px-2 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.filas.length === 0 && (
              <tr>
                <td colSpan={12} className="px-2 py-4 text-center text-slate-400">
                  Sin facturas en el rango.
                </td>
              </tr>
            )}
            {data?.filas.map((f, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">{formatDate(f.fecha)}</td>
                <td className="px-2 py-1.5 font-mono">{f.ruc}</td>
                <td className="px-2 py-1.5">{f.razonSocial}</td>
                <td className="px-2 py-1.5 font-mono">{f.timbrado}</td>
                <td className="px-2 py-1.5 font-mono">{f.numero}</td>
                <td className="px-2 py-1.5 text-right font-mono">{f.gravado10 ? formatGs(f.gravado10) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{f.iva10 ? formatGs(f.iva10) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{f.gravado5 ? formatGs(f.gravado5) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{f.iva5 ? formatGs(f.iva5) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{f.exento ? formatGs(f.exento) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">{formatGs(f.ivaTotal)}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">{formatGs(f.total)}</td>
              </tr>
            ))}
          </tbody>
          {data && data.filas.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                <td colSpan={5} className="px-2 py-1.5 text-right">TOTAL</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.gravado10)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.iva10)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.gravado5)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.iva5)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.exento)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.ivaTotal)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatGs(data.totales.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
