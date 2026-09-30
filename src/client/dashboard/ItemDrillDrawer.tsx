import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { DashItemRow, ItemDrillData, Project } from "../types";
import { Drawer } from "../ui";
import { formatGs, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { codeName } from "../../domain/dashboardMath";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "py-1 text-right tabular-nums whitespace-nowrap";

/** Del ítem a los documentos que forman su costo: vía A (documentos), B (insumos por ACU) y C (tiempo). */
export function ItemDrillDrawer({ project, item, desde, hasta, onClose, showToast }: { project: Project; item: DashItemRow; desde: string; hasta: string; onClose: () => void; showToast: Toast }) {
  const [d, setD] = useState<ItemDrillData | null>(null);
  useEffect(() => {
    api
      .getItemDrill(project.id, item.id, desde, hasta)
      .then(setD)
      .catch((e) => showToast(e.message, "error"));
  }, [project.id, item.id, desde, hasta, showToast]);
  const c = d?.costo;

  return (
    <Drawer title={codeName(item.code, item.name)} onClose={onClose}>
      <div className="space-y-5 text-sm text-slate-900">
        <p className="text-xs text-slate-600">
          {fmtDate(desde)} – {fmtDate(hasta)} · ejecutado {formatQty(item.ejecutado)} {item.unit ?? ""} · VG {formatGs(item.vg)}
        </p>
        {!d ? (
          <p>Cargando…</p>
        ) : (
          <>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-1">A · documentos con el ítem</td>
                  <td className={num}>{formatGs(c?.a.total ?? 0)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-1">B · insumos comunes (avance × ACU × precio)</td>
                  <td className={num}>{formatGs(c?.b.total ?? 0)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-1">C · tiempo (personal, equipos, gastos generales)</td>
                  <td className={num}>{formatGs(c?.c.total ?? 0)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-1">Costo real del ítem</td>
                  <td className={num}>{formatGs(c?.total ?? 0)}</td>
                </tr>
              </tbody>
            </table>

            <section>
              <h4 className="mb-1 font-semibold">A · Documentos</h4>
              {d.viaA.length ? (
                <table className="w-full">
                  <tbody>
                    {d.viaA.map((x) => (
                      <tr key={`${x.sourceType}${x.sourceId}`} className="border-b border-slate-100 align-top">
                        <td className="py-1 pr-2 tabular-nums">{fmtDate(x.fecha)}</td>
                        <td className="py-1 pr-2">
                          {x.fuente} {x.numero}
                          {x.insumos.length > 0 && <span className="block text-xs text-slate-600">{x.insumos.join(" · ")}</span>}
                        </td>
                        <td className={num}>{formatGs(x.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-slate-600">Sin documentos directos en el rango.</p>
              )}
            </section>

            <section>
              <h4 className="mb-1 font-semibold">B · Insumos comunes consumidos</h4>
              {d.viaB.length ? (
                <table className="w-full">
                  <tbody>
                    {d.viaB.map((x) => (
                      <tr key={x.insumoId} className="border-b border-slate-100">
                        <td className="py-1 pr-2 font-mono text-xs">{x.code}</td>
                        <td className={num}>{formatQty(x.cantidad)}</td>
                        <td className={num}>× {x.precio === null ? <span className="text-red-600">sin precio</span> : formatGs(x.precio)}</td>
                        <td className={num}>{formatGs(x.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-slate-600">Sin insumos comunes en el ACU o sin avance en el rango.</p>
              )}
              <p className="mt-1 text-xs text-slate-600">Cantidad teórica = ejecutado × consumo del ACU × (1 + desperdicio). El desvío real va a pérdidas de material de la obra, no al ítem.</p>
            </section>

            <section>
              <h4 className="mb-1 font-semibold">C · Tiempo</h4>
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="py-1">Personal propio liquidado al ítem</td>
                    <td className={num}>{formatGs(d.viaC.asignado)}</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-1">Reparto por horas del parte diario</td>
                    <td className={num}>{formatGs(d.viaC.porHoras)}</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-1">Prorrateo por valor ganado (sin horas asignables)</td>
                    <td className={num}>{formatGs(d.viaC.porVG)}</td>
                  </tr>
                </tbody>
              </table>
              {d.viaC.liquidaciones.map((x) => (
                <p key={`${x.sourceType}${x.sourceId}`} className="text-xs">
                  {fmtDate(x.fecha)} · {x.fuente} {x.numero} · {formatGs(x.monto)}
                </p>
              ))}
              {(d.viaC.horasPersonal.length > 0 || d.viaC.horasEquipo.length > 0) && (
                <div className="mt-2 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="font-semibold">Horas de personal</p>
                    {d.viaC.horasPersonal.map((h) => (
                      <p key={h.persona}>
                        {h.persona}: {formatQty(h.horas, 1)} h
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="font-semibold">Horas de equipo</p>
                    {d.viaC.horasEquipo.map((h) => (
                      <p key={h.equipo}>
                        {h.equipo}: {formatQty(h.horas, 1)} h
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-600">
                Pozo de tiempo de la obra en el rango {formatGs(d.viaC.pozo.pozo)}: repartido por horas {formatGs(d.viaC.pozo.porHoras)}, por VG {formatGs(d.viaC.pozo.porVG)}, sin repartir{" "}
                {formatGs(d.viaC.pozo.sinDistribuir)}.
              </p>
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}
