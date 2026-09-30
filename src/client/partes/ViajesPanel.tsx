import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Project, ViajesData } from "../types";
import { EmptyState, inputClass } from "../ui";
import { formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** Viajes de camión del parte diario: resumen por ítem y detalle. */
export const ViajesPanel: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(todayIso());
  const [data, setData] = useState<ViajesData | null>(null);

  const load = useCallback(() => {
    if (!desde || !hasta || desde > hasta) return;
    api
      .getViajes(project.id, desde, hasta)
      .then(setData)
      .catch((e) => showToast(e.message, "error"));
  }, [project.id, desde, hasta, showToast]);
  useEffect(load, [load]);

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
      </div>

      {!data ? (
        <p className="text-sm text-slate-600">Cargando…</p>
      ) : !data.viajes.length ? (
        <EmptyState title="Sin viajes en el rango" help="Los viajes se cargan en el parte diario." />
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                  <th className="px-2 py-1.5">Ítem</th>
                  <th className={num}>Viajes</th>
                  <th className={num}>m³</th>
                  <th className={num}>t</th>
                  <th className={num}>km</th>
                </tr>
              </thead>
              <tbody>
                {data.resumen.map((r) => (
                  <tr key={r.item?.id ?? 0} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">{r.item ? `${r.item.code} ${r.item.name}` : "Sin ítem"}</td>
                    <td className={num}>{r.viajes}</td>
                    <td className={num}>{r.m3 ? formatQty(r.m3, 1) : "—"}</td>
                    <td className={num}>{r.t ? formatQty(r.t, 1) : "—"}</td>
                    <td className={num}>{r.km ? formatQty(r.km, 1) : "—"}</td>
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
                  <th className="px-2 py-1.5">Camión</th>
                  <th className="px-2 py-1.5">Origen → destino</th>
                  <th className="px-2 py-1.5">Material</th>
                  <th className={num}>Cantidad</th>
                  <th className={num}>km</th>
                  <th className="px-2 py-1.5">Ítem</th>
                </tr>
              </thead>
              <tbody>
                {data.viajes.map((v) => (
                  <tr key={v.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums">{fmtDate(v.fecha)}</td>
                    <td className="px-2 py-1.5">{v.camion ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {v.origen} → {v.destino}
                    </td>
                    <td className="px-2 py-1.5">{v.material ?? "—"}</td>
                    <td className={num}>
                      {formatQty(v.cantidad, 1)} {v.unidad === "M3" ? "m³" : "t"}
                    </td>
                    <td className={num}>{v.km === null ? "—" : formatQty(v.km, 1)}</td>
                    <td className="px-2 py-1.5 text-xs">{v.item ? `${v.item.code} ${v.item.name}` : "Sin ítem"}</td>
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
