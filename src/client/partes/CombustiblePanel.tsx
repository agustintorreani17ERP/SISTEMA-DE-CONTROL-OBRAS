import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CombustibleData, EstadoCombustible, Project } from "../types";
import { EmptyState, cx, inputClass } from "../ui";
import { formatPct, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

const ESTADO: Record<EstadoCombustible, string> = {
  PRIMERA: "Primera carga (base)",
  OK: "OK",
  ALERTA: "ALERTA: consumo alto",
  REVISAR: "Revisar: consumo bajo",
  SIN_HORAS: "Sin horas",
  SIN_TEORICO: "Sin consumo teórico",
  HOROMETRO_INVALIDO: "Horómetro menor al anterior",
};
const esAlerta = (e: EstadoCombustible) => e === "ALERTA" || e === "HOROMETRO_INVALIDO";

/**
 * Control de combustible: cada carga repone lo consumido desde la anterior del mismo equipo.
 * Consumo real = litros ÷ horas (horómetro o, si falta, horas del parte) contra el teórico.
 */
export const CombustiblePanel: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(todayIso());
  const [data, setData] = useState<CombustibleData | null>(null);

  const load = useCallback(() => {
    if (!desde || !hasta || desde > hasta) return;
    api
      .getCombustible(project.id, desde, hasta)
      .then(setData)
      .catch((e) => showToast(e.message, "error"));
  }, [project.id, desde, hasta, showToast]);
  useEffect(load, [load]);

  const eq = new Map((data?.equipos ?? []).map((e) => [e.id, e]));

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
        <p className="max-w-xl text-xs text-slate-600">
          Las cargas se registran en el parte diario. El consumo teórico (L/h) y la tolerancia se cargan en el insumo del equipo (Configuración › Insumos); sin tolerancia se usa 15 %.
          El combustible es un control: su costo entra por la compra.
        </p>
      </div>

      {!data ? (
        <p className="text-sm text-slate-600">Cargando…</p>
      ) : !data.cargas.length ? (
        <EmptyState title="Sin cargas de combustible en el rango" />
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                  <th className="px-2 py-1.5">Equipo</th>
                  <th className={num}>Litros</th>
                  <th className={num}>Horas</th>
                  <th className={num}>Real L/h</th>
                  <th className={num}>Teórico L/h</th>
                  <th className={num}>Desvío</th>
                  <th className="px-2 py-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.resumen.map((r) => (
                  <tr key={r.equipoId} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-xs">{eq.get(r.equipoId)?.code}</span> {eq.get(r.equipoId)?.description}
                    </td>
                    <td className={num}>{formatQty(r.litros, 1)}</td>
                    <td className={num}>{formatQty(r.horas, 1)}</td>
                    <td className={num}>{r.consumoReal === null ? "—" : formatQty(r.consumoReal, 2)}</td>
                    <td className={num}>{r.consumoTeorico === null ? "—" : formatQty(r.consumoTeorico, 2)}</td>
                    <td className={cx(num, esAlerta(r.estado) && "font-semibold text-red-600")}>{r.desvioPct === null ? "—" : formatPct(r.desvioPct, 1)}</td>
                    <td className={cx("px-2 py-1.5", esAlerta(r.estado) && "font-semibold text-red-600")}>
                      {ESTADO[r.estado]}
                      {r.alertas > 0 && ` · ${r.alertas} carga(s) a revisar`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5">Equipo</th>
                  <th className={num}>Litros</th>
                  <th className={num}>Horómetro</th>
                  <th className={num}>Horas desde la anterior</th>
                  <th className={num}>Horas parte</th>
                  <th className={num}>Real L/h</th>
                  <th className={num}>Desvío</th>
                  <th className="px-2 py-1.5">Estado</th>
                  <th className="px-2 py-1.5">Ticket</th>
                </tr>
              </thead>
              <tbody>
                {data.cargas.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums">{fmtDate(c.fecha)}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{eq.get(c.equipoId)?.code}</td>
                    <td className={num}>{formatQty(c.litros, 1)}</td>
                    <td className={num}>{c.horometro === null ? "—" : formatQty(c.horometro, 1)}</td>
                    <td className={num}>
                      {c.horasUsadas === null ? "—" : formatQty(c.horasUsadas, 1)}
                      {c.fuenteHoras === "PARTE" && <span className="text-xs text-slate-500"> (parte)</span>}
                    </td>
                    <td className={cx(num, c.alertaHoras && "font-semibold text-red-600")}>{formatQty(c.horasParte, 1)}</td>
                    <td className={num}>{c.consumoReal === null ? "—" : formatQty(c.consumoReal, 2)}</td>
                    <td className={cx(num, esAlerta(c.estado) && "font-semibold text-red-600")}>{c.desvioPct === null ? "—" : formatPct(c.desvioPct, 1)}</td>
                    <td className={cx("px-2 py-1.5", (esAlerta(c.estado) || c.alertaHoras) && "font-semibold text-red-600")}>
                      {ESTADO[c.estado]}
                      {c.alertaHoras && " · horas del parte ≠ horómetro"}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.fotoUrl ? (
                        <a className="underline" href={c.fotoUrl} target="_blank" rel="noreferrer">
                          ver
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
