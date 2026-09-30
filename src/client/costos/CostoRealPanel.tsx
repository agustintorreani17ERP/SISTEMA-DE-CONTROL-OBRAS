import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Timer, Trash2 } from "lucide-react";
import { api } from "../api";
import type { CostEngineData, Insumo, ParteEquipoRow, Project } from "../types";
import { Button, Drawer, Field, Modal, cx, inputClass } from "../ui";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";
import { BudgetItemSelect, useImputableItems } from "../components/BudgetItemSelect";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const ESTADO_LABEL = { OK: "OK", ALERTA: "ALERTA", REVISAR: "Revisar (consumo bajo)", SIN_CONTEO: "Sin conteos" } as const;

/** Costo real por ítem y vía (hojas 6, 7 y 8 del Excel): calculado en el momento para cualquier rango. */
export const CostoRealPanel: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(todayIso());
  const [oficial, setOficial] = useState<"auto" | "si" | "no">("auto");
  const [soloConCosto, setSoloConCosto] = useState(true);
  const [data, setData] = useState<CostEngineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [horasOpen, setHorasOpen] = useState(false);
  const [partesOpen, setPartesOpen] = useState(false);

  const load = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setLoading(true);
    try {
      setData(await api.getCostos(project.id, desde, hasta, oficial === "auto" ? undefined : oficial === "si"));
    } catch (e: any) {
      showToast(e.message || "No se pudo calcular el costo", "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, desde, hasta, oficial, showToast]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const items = useMemo(() => (data?.items ?? []).filter((i) => !soloConCosto || i.total !== 0 || i.ejecutado !== 0), [data, soloConCosto]);
  const t = data?.totales;

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde" className="w-40">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Hasta" className="w-40">
          <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Field>
        <Field label="Avance" className="w-56">
          <select className={inputClass} value={oficial} onChange={(e) => setOficial(e.target.value as typeof oficial)}>
            <option value="auto">Automático (oficial si está cerrado)</option>
            <option value="si">Solo medición oficial</option>
            <option value="no">Vigente (con partes diarios)</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={soloConCosto} onChange={(e) => setSoloConCosto(e.target.checked)} />
          Solo ítems con costo o avance
        </label>
        <div className="ml-auto flex gap-2">
          <Button icon={<Timer className="h-4 w-4" />} onClick={() => setPartesOpen(true)}>
            Ver horas de equipo
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setHorasOpen(true)}>
            Cargar horas de equipo
          </Button>
        </div>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Calculando…</p>}
      {data && t && (
        <>
          <div className={cx("border px-3 py-2 text-sm", t.ok ? "border-slate-300" : "border-red-600")}>
            <p>
              <b>Validación:</b> imputado {formatGs(t.imputado)} + pérdidas {formatGs(t.perdidas)} + no imputado {formatGs(t.noImputado)} ={" "}
              {formatGs(t.imputado + t.perdidas + t.noImputado)} · total contable del rango {formatGs(t.totalContable)}{" "}
              {t.ok ? "· cierra" : <span className="font-semibold text-red-600">· diferencia {formatGs(t.diferencia)}</span>}
            </p>
            <p className="text-xs text-slate-500">
              {data.soloOficial ? "Avance: solo medición oficial" : "Avance vigente (incluye partes diarios provisorios)"} ·{" "}
              {data.origen === "snapshot" ? "Foto del cierre oficial (no cambia)" : data.origen === "cache" ? "Rango cerrado (en caché)" : "Calculado ahora"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 text-sm sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Costo real (imputado + pérdidas)", formatGs(t.costoReal)],
              ["A · Directos", formatGs(t.a)],
              ["B · Comunes (teórico)", formatGs(t.b)],
              ["C · Tiempo", formatGs(t.c)],
              ["Pérdidas de material", formatGs(t.perdidas)],
              ["No imputado", formatGs(t.noImputado)],
              ["IC = VG ÷ costo", t.ic === null ? "—" : formatQty(t.ic, 2)],
            ].map(([l, v]) => (
              <div key={l} className="bg-white px-3 py-2">
                <p className="text-xs text-slate-500">{l}</p>
                <p className={cx("text-lg font-semibold tabular-nums", l.startsWith("IC") && t.ic !== null && t.ic < 0.95 && "text-red-600")}>{v}</p>
              </div>
            ))}
          </div>

          {data.avisos.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {data.avisos.map((a) => (
                <li key={a} className={cx(/tolerancia|no cierra|sin precio/i.test(a) && "text-red-600")}>
                  {a}
                </li>
              ))}
            </ul>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Costo real por ítem</h3>
            <div className="overflow-x-auto border border-slate-300">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                    <th className="px-2 py-2">Ítem</th>
                    <th className="px-2 py-2">Descripción</th>
                    <th className="px-2 py-2 text-right">Ejecutado</th>
                    <th className="px-2 py-2 text-right">A · Directos</th>
                    <th className="px-2 py-2 text-right">B · Comunes</th>
                    <th className="px-2 py-2 text-right">C · Tiempo</th>
                    <th className="px-2 py-2 text-right">Costo real</th>
                    <th className="px-2 py-2 text-right">Costo unitario</th>
                    <th className="px-2 py-2 text-right">VG</th>
                    <th className="px-2 py-2 text-right">IC</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.budgetItemId} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 font-mono text-xs">{i.code}</td>
                      <td className="max-w-[320px] truncate px-2 py-1.5" title={i.name}>
                        {i.name}
                      </td>
                      <td className={num}>
                        {formatQty(i.ejecutado)} {i.unit}
                      </td>
                      <td className={num} title={Object.entries(i.a.porFuente).map(([k, v]) => `${k}: ${formatGs(v)}`).join("\n")}>
                        {formatGs(i.a.total)}
                      </td>
                      <td className={num} title={i.b.insumos.map((x) => `${x.code}: ${formatQty(x.cantidad)} × ${formatGs(x.precio)}`).join("\n")}>
                        {formatGs(i.b.total)}
                      </td>
                      <td className={num} title={`Asignado ${formatGs(i.c.asignado)} · por horas ${formatGs(i.c.porHoras)} · por VG ${formatGs(i.c.porVG)}`}>
                        {formatGs(i.c.total)}
                      </td>
                      <td className={cx(num, "font-semibold")}>{formatGs(i.total)}</td>
                      <td className={num}>{i.costoUnitario === null ? "—" : formatGs(i.costoUnitario)}</td>
                      <td className={num}>{i.vg === null ? "—" : formatGs(i.vg)}</td>
                      <td className={cx(num, i.ic !== null && i.ic < 0.95 && "font-semibold text-red-600")}>{i.ic === null ? "" : formatQty(i.ic, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 font-semibold">
                    <td colSpan={3} className="px-2 py-2">
                      Subtotal ítems
                    </td>
                    <td className={num}>{formatGs(t.a)}</td>
                    <td className={num}>{formatGs(t.b)}</td>
                    <td className={num}>{formatGs(t.c)}</td>
                    <td className={num}>{formatGs(t.imputado)}</td>
                    <td />
                    <td className={num}>{formatGs(t.vg)}</td>
                    <td className={num}>{t.ic === null ? "" : formatQty(t.ic, 2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="px-2 py-1">
                      Pérdidas de material (desvío de inventario, no se imputa a ítems)
                    </td>
                    <td className={num}>{formatGs(t.perdidas)}</td>
                    <td colSpan={3} />
                  </tr>
                  <tr className="font-semibold">
                    <td colSpan={6} className="px-2 py-1">
                      COSTO REAL DEL PERÍODO
                    </td>
                    <td className={num}>{formatGs(t.costoReal)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              A: certificados de subcontratista, recepciones de insumos DIRECTOS, caja chica y ajustes con ítem. B: avance × consumo del ACU × precio
              vigente al {fmtDate(hasta)}. C: equipos, personal y gastos generales por horas valorizadas; lo sin ítem, por valor ganado. IC en rojo: menor a 0,95.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Insumos comunes: inventario entre conteos</h3>
            <div className="overflow-x-auto border border-slate-300">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                    <th className="px-2 py-2">Código</th>
                    <th className="px-2 py-2">Insumo</th>
                    <th className="px-2 py-2">Conteos usados</th>
                    <th className="px-2 py-2 text-right">Stock inicial</th>
                    <th className="px-2 py-2 text-right">Entradas</th>
                    <th className="px-2 py-2 text-right">Stock final</th>
                    <th className="px-2 py-2 text-right">Consumo real</th>
                    <th className="px-2 py-2 text-right">Teórico</th>
                    <th className="px-2 py-2 text-right">Desvío</th>
                    <th className="px-2 py-2 text-right">Desvío %</th>
                    <th className="px-2 py-2 text-right">Tolerancia</th>
                    <th className="px-2 py-2 text-right">Pérdida del rango (Gs)</th>
                    <th className="px-2 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.materiales.map((m) => (
                    <tr key={m.insumoId} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 font-mono text-xs">{m.code}</td>
                      <td className="px-2 py-1.5">{m.description}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {m.ventana ? `${fmtDate(m.ventana.desde)} → ${fmtDate(m.ventana.hasta)}` : "—"}
                        {m.prorrateado && <span className="ml-1 text-slate-500">(prorrateado al rango)</span>}
                      </td>
                      <td className={num}>{m.stockInicial === null ? "" : formatQty(m.stockInicial)}</td>
                      <td className={num}>{m.entradas === null ? "" : formatQty(m.entradas)}</td>
                      <td className={num}>{m.stockFinal === null ? "" : formatQty(m.stockFinal)}</td>
                      <td className={num}>{m.consumoReal === null ? "" : formatQty(m.consumoReal)}</td>
                      <td className={num}>{formatQty(m.teoricoVentana ?? m.teoricoRango)}</td>
                      <td className={num}>{m.desvio === null ? "" : formatQty(m.desvio)}</td>
                      <td className={num}>{m.desvioPct === null ? "" : formatPct(m.desvioPct)}</td>
                      <td className={num}>{m.toleranciaPct ? `${formatQty(m.toleranciaPct, 1)} %` : "—"}</td>
                      <td className={num}>{formatGs(m.perdidaValorizada)}</td>
                      <td className={cx("px-2 py-1.5 text-xs", m.estado === "ALERTA" && "font-semibold text-red-600")}>{ESTADO_LABEL[m.estado]}</td>
                    </tr>
                  ))}
                  {data.materiales.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-2 py-4 text-center text-slate-500">
                        Sin insumos comunes en el rango.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Consumo real = stock inicial + entradas − stock final entre el último conteo antes del rango y el primero después. El desvío va a pérdidas de
              material, nunca a un ítem.
            </p>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <table className="w-full border border-slate-300 text-sm">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="px-3 py-1.5 font-semibold" colSpan={2}>
                    Costos por tiempo (vía C)
                  </td>
                </tr>
                <Row label="Pozo del rango (tiempo + gastos generales)" value={formatGs(data.tiempo.pozo)} />
                <Row label="Repartido por horas con ítem" value={formatGs(data.tiempo.porHoras)} />
                <Row label="Prorrateado por valor ganado" value={formatGs(data.tiempo.porVG)} />
                <Row label="Sin distribuir" value={formatGs(data.tiempo.sinDistribuir)} alert={data.tiempo.sinDistribuir !== 0} />
              </tbody>
            </table>
            <table className="w-full border border-slate-300 text-sm">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="px-3 py-1.5 font-semibold" colSpan={2}>
                    No imputado
                  </td>
                </tr>
                <Row label="Compras de comunes − consumo (teórico + pérdidas): variación de stock" value={formatGs(data.noImputado.stockNoConsumido)} />
                <Row label="Tiempo sin distribuir y movimientos de ítems fuera del presupuesto" value={formatGs(data.noImputado.tiempoSinDistribuir)} />
                <Row label="Total no imputado" value={formatGs(data.noImputado.total)} />
              </tbody>
            </table>
          </section>
        </>
      )}

      {horasOpen && <HorasEquipoModal project={project} onClose={() => setHorasOpen(false)} onSaved={load} showToast={showToast} />}
      {partesOpen && <PartesEquipoDrawer project={project} desde={desde} hasta={hasta} onClose={() => setPartesOpen(false)} onChanged={load} showToast={showToast} />}
    </div>
  );
};

const Row = ({ label, value, alert }: { label: string; value: string; alert?: boolean }) => (
  <tr className="border-b border-slate-100 last:border-b-0">
    <td className="px-3 py-1.5">{label}</td>
    <td className={cx("px-3 py-1.5 text-right tabular-nums", alert && "font-semibold text-red-600")}>{value}</td>
  </tr>
);

interface HoraLinea {
  key: number;
  insumoId: number | "";
  budgetItemId: number | "";
  horas: string;
}
let seq = 1;

function HorasEquipoModal({ project, onClose, onSaved, showToast }: { project: Project; onClose: () => void; onSaved: () => void; showToast: Toast }) {
  const [fecha, setFecha] = useState(todayIso());
  const [equipos, setEquipos] = useState<Insumo[]>([]);
  const [lineas, setLineas] = useState<HoraLinea[]>([{ key: seq++, insumoId: "", budgetItemId: "", horas: "" }]);
  const [saving, setSaving] = useState(false);
  const { items } = useImputableItems(project.id);
  useEffect(() => {
    api.getInsumos({ tipo: "TIEMPO" }).then(setEquipos).catch((e) => showToast(e.message, "error"));
  }, [showToast]);
  const upd = (key: number, p: Partial<HoraLinea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const validas = lineas.filter((l) => l.insumoId && Number(l.horas.replace(",", ".")) > 0);

  const save = async () => {
    setSaving(true);
    try {
      await api.savePartesEquipo(project.id, {
        fecha,
        lineas: validas.map((l) => ({ insumoId: Number(l.insumoId), budgetItemId: l.budgetItemId || null, horas: Number(l.horas.replace(",", ".")) })),
      });
      showToast("Horas cargadas", "success");
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="lg"
      title="Horas de equipo (parte diario)"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || !validas.length || !fecha}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="text-slate-900">
        <Field label="Fecha" className="w-44">
          <input type="date" className={inputClass} value={fecha} max={todayIso()} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <div className="mt-3 space-y-2">
          {lineas.map((l) => (
            <div key={l.key} className="grid grid-cols-[2fr_2fr_90px_32px] items-center gap-2">
              <select className={inputClass} value={l.insumoId} onChange={(e) => upd(l.key, { insumoId: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Equipo…</option>
                {equipos.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.code} — {q.description} {q.precio === null ? "(sin precio)" : `(${formatGs(q.precio)} / ${q.unit})`}
                  </option>
                ))}
              </select>
              <BudgetItemSelect projectId={project.id} items={items} value={l.budgetItemId} onChange={(v) => upd(l.key, { budgetItemId: v })} placeholder="Ítem (sin ítem: se prorratea)" />
              <input className={cx(inputClass, "text-right")} inputMode="decimal" placeholder="Horas" value={l.horas} onChange={(e) => upd(l.key, { horas: e.target.value })} />
              <button className="p-1 text-slate-400 hover:text-slate-900" onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setLineas((ls) => [...ls, { key: seq++, insumoId: "", budgetItemId: "", horas: "" }])}>
            Agregar equipo
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Las horas no son un costo: son la llave para repartir los costos por tiempo del período (alquileres, gastos generales, personal) entre ítems,
          valorizadas con el precio por hora del equipo.
        </p>
      </div>
    </Modal>
  );
}

function PartesEquipoDrawer({
  project,
  desde,
  hasta,
  onClose,
  onChanged,
  showToast,
}: {
  project: Project;
  desde: string;
  hasta: string;
  onClose: () => void;
  onChanged: () => void;
  showToast: Toast;
}) {
  const [rows, setRows] = useState<ParteEquipoRow[] | null>(null);
  const load = useCallback(() => {
    api.getPartesEquipo(project.id, desde, hasta).then(setRows).catch((e) => showToast(e.message, "error"));
  }, [project.id, desde, hasta, showToast]);
  useEffect(load, [load]);
  return (
    <Drawer title={`Horas de equipo ${fmtDate(desde)} – ${fmtDate(hasta)}`} onClose={onClose}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-xs font-semibold">
            <th className="py-1.5">Fecha</th>
            <th className="py-1.5">Equipo</th>
            <th className="py-1.5">Ítem</th>
            <th className="py-1.5 text-right">Horas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="py-1.5 tabular-nums">{fmtDate(r.fecha)}</td>
              <td className="py-1.5">{r.insumo?.code}</td>
              <td className="py-1.5 text-xs">{r.budgetItem ? `${r.budgetItem.code} ${r.budgetItem.name}` : "Sin ítem (prorrateo)"}</td>
              <td className="py-1.5 text-right tabular-nums">{formatQty(r.horas)}</td>
              <td className="w-8 text-center">
                <button
                  className="p-1 text-slate-400 hover:text-slate-900"
                  onClick={async () => {
                    try {
                      await api.deleteParteEquipo(r.id);
                      load();
                      onChanged();
                    } catch (e: any) {
                      showToast(e.message, "error");
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
          {rows?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-slate-500">
                Sin horas cargadas en el rango.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Drawer>
  );
}
