import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Project, ReconFuente, ReconciliationData } from "../types";
import { cx, inputClass } from "../ui";
import { formatGs } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

const FUENTE: Record<ReconFuente, string> = {
  OC: "Órdenes de compra recibidas",
  SUBCONTRATO: "Certificados de subcontratistas",
  CAJA_CHICA: "Caja chica rendida",
  FACTURA: "Facturas sin OC (imputadas)",
  PERSONAL: "Liquidaciones de personal",
  OTROS: "Ajustes, transferencias y otros",
};
const TIPO: Record<ReconciliationData["partidas"][number]["tipo"], string> = {
  SIN_ASIENTO: "Documento sin asiento",
  DIFERENCIA: "Monto distinto",
  SIN_DOCUMENTO: "Asiento sin documento",
  FUERA_DE_RANGO: "Documento de otra fecha",
  FACTURA_DIFIERE: "Factura ≠ documento",
  SIN_FACTURA: "Sin factura (provisión)",
};
/** Las que cambian el costo (las otras son informativas). */
const GRAVE = new Set(["SIN_ASIENTO", "DIFERENCIA", "FACTURA_DIFIERE"]);

/**
 * Conciliación por rango: lo que dicen los documentos, lo que tiene el libro mayor y lo que
 * reparte el motor de costos. Si las tres cosas cierran, todo el dinero del rango está en costos.
 */
export const ConciliacionPanel: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(todayIso());
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setLoading(true);
    try {
      setData(await api.getConciliacion(project.id, desde, hasta));
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, desde, hasta, showToast]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const m = data?.motor;
  const cierraDocs = data ? Math.abs(data.totales.diferencia) <= 1 : false;
  const cierraMotor = m ? m.ok && Math.abs(m.diferenciaConLibro) <= 1 : false;

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Desde</span>
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Hasta</span>
          <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        {loading && <span className="text-sm text-slate-600">Calculando…</span>}
      </div>

      {data && m && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-slate-300 p-3">
              <p className="text-xs font-semibold">Documentos del rango</p>
              <p className="text-xl font-semibold tabular-nums">{formatGs(data.totales.documentos)}</p>
            </div>
            <div className="border border-slate-300 p-3">
              <p className="text-xs font-semibold">Libro mayor (costo incurrido)</p>
              <p className="text-xl font-semibold tabular-nums">{formatGs(data.totales.libro)}</p>
              <p className={cx("text-xs", !cierraDocs && "font-semibold text-red-600")}>
                {cierraDocs ? "Coincide con los documentos" : `Diferencia con documentos: ${formatGs(data.totales.diferencia)}`}
              </p>
            </div>
            <div className="border border-slate-300 p-3">
              <p className="text-xs font-semibold">Motor de costos</p>
              <p className="text-xl font-semibold tabular-nums">{formatGs(m.totalContable)}</p>
              <p className={cx("text-xs", !cierraMotor && "font-semibold text-red-600")}>
                {cierraMotor
                  ? "Imputado + pérdidas + no imputado = total contable"
                  : !m.ok
                  ? `El motor no valida: diferencia ${formatGs(m.diferencia)}`
                  : `El motor parte de otro total: ${formatGs(m.diferenciaConLibro)}`}
              </p>
            </div>
          </div>

          <table className="w-full max-w-xl text-sm">
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1">Imputado a ítems (A {formatGs(m.a)} · B {formatGs(m.b)} · C {formatGs(m.c)})</td>
                <td className="py-1 text-right tabular-nums">{formatGs(m.imputado)}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1">Pérdidas de material</td>
                <td className="py-1 text-right tabular-nums">{formatGs(m.perdidas)}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1">No imputado (stock sin consumir, tiempo sin repartir)</td>
                <td className="py-1 text-right tabular-nums">{formatGs(m.noImputado)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-1">Total contable</td>
                <td className="py-1 text-right tabular-nums">{formatGs(m.totalContable)}</td>
              </tr>
            </tbody>
          </table>

          <div className="overflow-x-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                  <th className="px-2 py-1.5">Fuente</th>
                  <th className={num}>Documentos</th>
                  <th className={num}>Libro mayor</th>
                  <th className={num}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {data.porFuente.map((f) => (
                  <tr key={f.fuente} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">{FUENTE[f.fuente]}</td>
                    <td className={num}>{formatGs(f.documentos)}</td>
                    <td className={num}>{formatGs(f.libro)}</td>
                    <td className={cx(num, Math.abs(f.diferencia) > 1 && "font-semibold text-red-600")}>{formatGs(f.diferencia)}</td>
                  </tr>
                ))}
                {!data.porFuente.length && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-slate-500">
                      Sin movimientos en el rango.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Partidas a revisar ({data.partidas.length})</h3>
            {data.partidas.length ? (
              <div className="overflow-x-auto border border-slate-300">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                      <th className="px-2 py-1.5">Tipo</th>
                      <th className="px-2 py-1.5">Documento</th>
                      <th className="px-2 py-1.5">Fecha</th>
                      <th className={num}>Documento</th>
                      <th className={num}>Libro</th>
                      <th className={num}>Diferencia</th>
                      <th className="px-2 py-1.5">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.partidas.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className={cx("px-2 py-1.5 whitespace-nowrap", GRAVE.has(p.tipo) && "font-semibold text-red-600")}>{TIPO[p.tipo]}</td>
                        <td className="px-2 py-1.5">{p.numero}</td>
                        <td className="px-2 py-1.5 tabular-nums">{p.fecha ? fmtDate(p.fecha) : "—"}</td>
                        <td className={num}>{p.documento === null ? "—" : formatGs(p.documento)}</td>
                        <td className={num}>{p.libro === null ? "—" : formatGs(p.libro)}</td>
                        <td className={num}>{p.diferencia ? formatGs(p.diferencia) : "—"}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-600">{p.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm">Sin diferencias: documentos, libro mayor y facturas coinciden en el rango.</p>
            )}
          </div>

          {m.avisos.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-semibold">Avisos del motor</p>
              {m.avisos.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
