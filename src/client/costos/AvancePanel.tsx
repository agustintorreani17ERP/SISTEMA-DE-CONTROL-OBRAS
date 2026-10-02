import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ClipboardList, Lock, Trash2 } from "lucide-react";
import { api, currentRole } from "../api";
import type { AvanceHecho, CierreResumen, ClientInvoicePreview, PlanPreview, ProgressReport, ProgressRow, Project } from "../types";
import { Button, Drawer, Field, Modal, cx, inputClass } from "../ui";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";
import { NumCell } from "../components/certifications/sheetGrid";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Avance físico fechado por ítem: planificado vs ejecutado, valor ganado y cierres oficiales (hojas 5 y 8). */
export const AvancePanel: React.FC<{ project: Project; onChanged: () => void; showToast: Toast }> = ({ project, onChanged, showToast }) => {
  const [range, setRange] = useState<{ desde: string; hasta: string } | null>(null);
  const [soloOficial, setSoloOficial] = useState(false);
  const [soloMov, setSoloMov] = useState(true);
  const [q, setQ] = useState("");
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [cierres, setCierres] = useState<CierreResumen[]>([]);
  const [dialog, setDialog] = useState<"parte" | "plan" | "cierre" | null>(null);
  const [detail, setDetail] = useState<ProgressRow | null>(null);
  const [snapshotOf, setSnapshotOf] = useState<CierreResumen | null>(null);
  const [facturarOf, setFacturarOf] = useState<CierreResumen | null>(null);
  const [reabrirOf, setReabrirOf] = useState<CierreResumen | null>(null);
  const esAdmin = currentRole() === "ADMIN";

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.getAvance(project.id, { ...(range ?? {}), oficial: soloOficial }), api.getCierres(project.id)]);
      setReport(r);
      setCierres(c);
      if (!range) setRange({ desde: r.desde, hasta: r.hasta });
    } catch (e: any) {
      showToast(e.message || "No se pudo cargar el avance", "error");
    }
  }, [project.id, range, soloOficial, showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (report?.rows ?? []).filter(
      (r) => (!soloMov || r.ejecutado !== 0 || r.planificado !== 0 || r.provisorio !== 0) && (!t || `${r.code} ${r.name}`.toLowerCase().includes(t))
    );
  }, [report, q, soloMov]);

  const refresh = () => {
    load();
    onChanged();
  };
  const tot = report?.totales;
  const ultimo = report?.ultimoCierre;

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde" className="w-40">
          <input type="date" className={inputClass} value={range?.desde ?? ""} onChange={(e) => range && setRange({ ...range, desde: e.target.value })} />
        </Field>
        <Field label="Hasta" className="w-40">
          <input type="date" className={inputClass} value={range?.hasta ?? ""} onChange={(e) => range && setRange({ ...range, hasta: e.target.value })} />
        </Field>
        <Field label="Buscar" className="w-52">
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={soloOficial} onChange={(e) => setSoloOficial(e.target.checked)} />
          Solo medición oficial
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={soloMov} onChange={(e) => setSoloMov(e.target.checked)} />
          Solo ítems con plan o avance
        </label>
        <div className="ml-auto flex gap-2">
          <Button icon={<CalendarRange className="h-4 w-4" />} onClick={() => setDialog("plan")}>
            Cronograma
          </Button>
          <Button icon={<ClipboardList className="h-4 w-4" />} onClick={() => setDialog("parte")}>
            Parte diario
          </Button>
          <Button variant="primary" icon={<Lock className="h-4 w-4" />} onClick={() => setDialog("cierre")}>
            Cerrar período
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {ultimo ? `Cerrado oficialmente hasta el ${fmtDate(ultimo.hasta)}: lo anterior no se edita. ` : "Sin cierres oficiales. "}
        El parte diario es provisorio; la medición del certificado al cliente es la oficial y reemplaza a los partes hasta su fecha.
        {tot && tot.itemsProvisorios > 0 && !soloOficial ? ` ${tot.itemsProvisorios} ítem(s) con avance provisorio (prov.).` : ""}
      </p>

      <div className="overflow-x-auto border border-slate-300">
        <table className="w-full min-w-[1400px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs font-semibold">
              <th className="px-2 py-2">Ítem</th>
              <th className="px-2 py-2">Descripción</th>
              <th className="px-2 py-2">Un.</th>
              <th className="px-2 py-2 text-right">Cant. contrato</th>
              <th className="px-2 py-2 text-right">Acum. anterior</th>
              <th className="px-2 py-2 text-right">Planificado</th>
              <th className="px-2 py-2 text-right">Ejecutado</th>
              <th className="px-2 py-2 text-right">Acum. actual</th>
              <th className="px-2 py-2 text-right">% avance</th>
              <th className="px-2 py-2 text-right">Cumplimiento</th>
              <th className="border-l border-slate-300 px-2 py-2 text-right">VP (Gs)</th>
              <th className="px-2 py-2 text-right">VG (Gs)</th>
              <th className="px-2 py-2 text-right">IP</th>
              <th className="px-2 py-2 text-right">Certificable s/IVA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.budgetItemId} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setDetail(r)}>
                <td className="px-2 py-1.5 font-mono text-xs">{r.code}</td>
                <td className="max-w-[340px] truncate px-2 py-1.5" title={r.name}>
                  {r.name}
                </td>
                <td className="px-2 py-1.5 text-slate-600">{r.unit}</td>
                <td className={num}>{formatQty(r.contrato)}</td>
                <td className={num}>{formatQty(r.anterior)}</td>
                <td className={num}>{r.planificado ? formatQty(r.planificado) : ""}</td>
                <td className={num}>
                  {formatQty(r.ejecutado)}
                  {!soloOficial && r.provisorio !== 0 && <span className="ml-1 text-[10px] text-slate-500" title={`${formatQty(r.provisorio)} sin medición oficial`}>prov.</span>}
                </td>
                <td className={cx(num, r.excedeContrato && "font-semibold text-red-600")} title={r.excedeContrato ? "Supera la cantidad del contrato" : undefined}>
                  {formatQty(r.acumulado)}
                </td>
                <td className={num}>{formatPct(r.pctAvance)}</td>
                <td className={num}>{r.cumplimiento === null ? "" : formatPct(r.cumplimiento)}</td>
                <td className={cx(num, "border-l border-slate-300")}>{r.vp === null ? "—" : formatGs(r.vp)}</td>
                <td className={num}>{r.vg === null ? "—" : formatGs(r.vg)}</td>
                <td className={num}>{r.ip === null ? "" : formatQty(r.ip, 2)}</td>
                <td className={num}>{formatGs(r.ventaSinIva)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-slate-500">
                  Sin avance ni plan en el rango. Cargá un parte diario o el cronograma.
                </td>
              </tr>
            )}
          </tbody>
          {tot && (
            <tfoot>
              <tr className="border-t-2 border-slate-900 font-semibold">
                <td colSpan={10} className="px-2 py-2">
                  TOTAL {fmtDate(report!.desde)} – {fmtDate(report!.hasta)}
                </td>
                <td className={cx(num, "border-l border-slate-300")}>{formatGs(tot.vp)}</td>
                <td className={num}>{formatGs(tot.vg)}</td>
                <td className={num}>{tot.ip === null ? "" : formatQty(tot.ip, 2)}</td>
                <td className={num}>{formatGs(tot.ventaSinIva)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-500">VP = planificado × costo meta · VG = ejecutado × costo meta · IP = VG ÷ VP · Certificable = ejecutado × PU sin IVA.</p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Cierres oficiales</h3>
        <div className="border border-slate-300">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2 text-right">Certificable s/IVA</th>
                <th className="px-3 py-2 text-right">VG</th>
                <th className="px-3 py-2 text-right">IP</th>
                <th className="px-3 py-2">Cerrado</th>
                <th className="px-3 py-2">Notas</th>
                <th className="px-3 py-2">Factura al cliente</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cierres.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setSnapshotOf(c)}>
                  <td className="px-3 py-1.5 tabular-nums">
                    {fmtDate(c.desde)} – {fmtDate(c.hasta)}
                  </td>
                  <td className={num}>{formatGs(c.totales?.ventaSinIva)}</td>
                  <td className={num}>{formatGs(c.totales?.vg)}</td>
                  <td className={num}>{c.totales?.ip == null ? "" : formatQty(c.totales.ip, 2)}</td>
                  <td className="px-3 py-1.5 text-xs">{new Date(c.createdAt).toLocaleDateString("es-PY")}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-600">{c.notas}</td>
                  <td className="px-3 py-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                    {c.factura ? (
                      <span className="tabular-nums">
                        {c.factura.numeroFactura} · {formatGs(c.factura.total)}
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setFacturarOf(c)}>
                        Facturar
                      </Button>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                    {/* Solo el último cierre (la lista viene del más reciente al más viejo) y solo un administrador. */}
                    {esAdmin && c.id === cierres[0]?.id && (
                      <Button size="sm" onClick={() => setReabrirOf(c)}>
                        Reabrir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {cierres.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                    Todavía no hay cierres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reabrirOf && (
        <ReabrirCierreModal
          cierre={reabrirOf}
          onClose={() => setReabrirOf(null)}
          onDone={() => {
            setReabrirOf(null);
            setRange(null); // el rango por defecto vuelve a empezar después del cierre anterior
            load();
          }}
          showToast={showToast}
        />
      )}

      {facturarOf && (
        <FacturaCierreModal
          cierre={facturarOf}
          onClose={() => setFacturarOf(null)}
          onDone={() => {
            setFacturarOf(null);
            refresh();
          }}
          showToast={showToast}
        />
      )}
      {dialog === "parte" && report && <ParteDiarioModal project={project} rows={report.rows} onClose={() => setDialog(null)} onSaved={refresh} showToast={showToast} />}
      {dialog === "plan" && <CronogramaModal project={project} onClose={() => setDialog(null)} onSaved={refresh} showToast={showToast} />}
      {dialog === "cierre" && (
        <CierreModal
          project={project}
          desdeSugerido={ultimo ? nextDay(ultimo.hasta) : range?.desde ?? todayIso()}
          hastaSugerido={range?.hasta ?? todayIso()}
          onClose={() => setDialog(null)}
          onClosed={() => {
            setDialog(null);
            refresh();
          }}
          showToast={showToast}
        />
      )}
      {detail && range && <HechosDrawer project={project} row={detail} range={range} onClose={() => setDetail(null)} onChanged={refresh} showToast={showToast} />}
      {snapshotOf && <SnapshotModal cierre={snapshotOf} onClose={() => setSnapshotOf(null)} />}
    </div>
  );
};

// ─── Tabla de filas (preview de cierre y snapshot) ─────────────────────────

function OfficialTable({ rows }: { rows: ProgressRow[] }) {
  const shown = rows.filter((r) => r.ejecutado !== 0 || r.planificado !== 0);
  return (
    <div className="max-h-[45vh] overflow-auto border border-slate-300">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-slate-300 text-left font-semibold">
            <th className="px-2 py-1.5">Ítem</th>
            <th className="px-2 py-1.5">Descripción</th>
            <th className="px-2 py-1.5 text-right">Anterior</th>
            <th className="px-2 py-1.5 text-right">Plan</th>
            <th className="px-2 py-1.5 text-right">Medido</th>
            <th className="px-2 py-1.5 text-right">Acum.</th>
            <th className="px-2 py-1.5 text-right">VG</th>
            <th className="px-2 py-1.5 text-right">Certificable s/IVA</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.budgetItemId} className="border-b border-slate-100">
              <td className="px-2 py-1 font-mono">{r.code}</td>
              <td className="max-w-[260px] truncate px-2 py-1">{r.name}</td>
              <td className={num}>{formatQty(r.anterior)}</td>
              <td className={num}>{r.planificado ? formatQty(r.planificado) : ""}</td>
              <td className={num}>{formatQty(r.ejecutado)}</td>
              <td className={cx(num, r.excedeContrato && "font-semibold text-red-600")}>{formatQty(r.acumulado)}</td>
              <td className={num}>{r.vg === null ? "—" : formatGs(r.vg)}</td>
              <td className={num}>{formatGs(r.ventaSinIva)}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={8} className="px-2 py-4 text-center text-slate-500">
                Sin medición oficial ni plan en el rango.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Parte diario ─────────────────────────────────────────────────────────

function ParteDiarioModal({ project, rows, onClose, onSaved, showToast }: { project: Project; rows: ProgressRow[]; onClose: () => void; onSaved: () => void; showToast: Toast }) {
  const [fecha, setFecha] = useState(todayIso());
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<number, number>>({});
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  const t = q.trim().toLowerCase();
  const visible = rows.filter((r) => !t || `${r.code} ${r.name}`.toLowerCase().includes(t));
  const lineas = Object.entries(qty)
    .filter(([, v]) => v)
    .map(([id, v]) => ({ budgetItemId: Number(id), cantidad: v, nota: nota || null }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.savePartes(project.id, { fecha, lineas });
      showToast(`Parte del ${fmtDate(fecha)}: ${r.creados} ítem(s)`, "success");
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar el parte", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="lg"
      title="Parte diario de avance"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || !lineas.length || !fecha}>
            Guardar {lineas.length ? `${lineas.length} ítem(s)` : ""}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3 text-slate-900">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={fecha} max={todayIso()} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Buscar ítem">
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </Field>
        <Field label="Nota (frente, cuadrilla…)">
          <input className={inputClass} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
      <div className="max-h-[50vh] overflow-y-auto border border-slate-300">
        <table className="w-full text-sm text-slate-900">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-300 text-left text-xs font-semibold">
              <th className="px-2 py-1.5">Ítem</th>
              <th className="px-2 py-1.5">Descripción</th>
              <th className="px-2 py-1.5 text-right">Acum.</th>
              <th className="w-28 px-2 py-1.5 text-right">Hoy</th>
              <th className="px-2 py-1.5">Un.</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.budgetItemId} className="border-b border-slate-100">
                <td className="px-2 py-1 font-mono text-xs">{r.code}</td>
                <td className="px-2 py-1">{r.name}</td>
                <td className={num}>
                  {formatQty(r.acumulado)} / {formatQty(r.contrato)}
                </td>
                <td className="border-x border-slate-200 p-0">
                  <NumCell
                    className="w-full bg-transparent px-2 py-1.5 text-right tabular-nums focus:outline-2 focus:outline-slate-900"
                    value={qty[r.budgetItemId] ?? 0}
                    onValue={(n) => setQty((prev) => ({ ...prev, [r.budgetItemId]: n }))}
                  />
                </td>
                <td className="px-2 py-1 text-slate-600">{r.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Cantidad ejecutada en el día (negativa para corregir). Es provisoria hasta la medición oficial.</p>
    </Modal>
  );
}

// ─── Cronograma ───────────────────────────────────────────────────────────

function CronogramaModal({ project, onClose, onSaved, showToast }: { project: Project; onClose: () => void; onSaved: () => void; showToast: Toast }) {
  const [texto, setTexto] = useState("");
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [modo, setModo] = useState<"REEMPLAZAR" | "COMBINAR">("REEMPLAZAR");
  const [busy, setBusy] = useState(false);
  const validas = preview?.filas.filter((f) => !f.error && f.budgetItemId) ?? [];
  const conError = preview?.filas.filter((f) => f.error) ?? [];

  const leer = async () => {
    setBusy(true);
    try {
      setPreview(await api.previewPlan(project.id, texto));
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const guardar = async () => {
    setBusy(true);
    try {
      const r = await api.savePlan(project.id, { modo, lineas: validas.map((f) => ({ budgetItemId: f.budgetItemId!, fecha: f.fecha, cantidad: f.cantidad })) });
      showToast(`Cronograma guardado: ${r.guardados} valores`, "success");
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      size="lg"
      title="Cronograma (avance planificado)"
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button onClick={() => setPreview(null)}>Volver</Button>
            <Button variant="primary" onClick={guardar} disabled={busy || !validas.length}>
              Guardar {validas.length} valores
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={leer} disabled={busy || !texto.trim()}>
              Leer
            </Button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="space-y-2 text-slate-900">
          <p className="text-sm text-slate-600">
            Copiá del Excel del plan de trabajo y pegá acá: primera columna el <b>código del ítem</b>, encabezados con el <b>período</b> (mar-26, 03/2026 o
            31/03/2026) y en cada celda la <b>cantidad</b> del período o un <b>%</b> del contrato. Cada mes se toma a su último día.
          </p>
          <textarea className={cx(inputClass, "h-56 font-mono text-xs")} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"Ítem\tfeb-26\tmar-26\n3.3\t10\t20\n3.2\t\t50%"} />
        </div>
      ) : (
        <div className="space-y-3 text-slate-900">
          <p className="text-sm">
            {preview.periodos.length} períodos ({preview.periodos.map(fmtDate).join(", ")}) · {validas.length} valores
            {conError.length > 0 && <span className="font-semibold text-red-600"> · {conError.length} con error (no se guardan)</span>}
          </p>
          {preview.errores.map((e) => (
            <p key={e} className="text-xs text-slate-600">
              {e}
            </p>
          ))}
          {conError.length > 0 && (
            <ul className="max-h-40 overflow-y-auto text-xs text-red-600">
              {conError.map((f, i) => (
                <li key={i}>
                  Fila {f.fila} · {f.codigo} · {fmtDate(f.fecha)}: {f.error}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={modo === "REEMPLAZAR"} onChange={() => setModo("REEMPLAZAR")} />
              Reemplazar todo el cronograma de la obra
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={modo === "COMBINAR"} onChange={() => setModo("COMBINAR")} />
              Solo actualizar lo pegado
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Cierre oficial ───────────────────────────────────────────────────────

function CierreModal({
  project,
  desdeSugerido,
  hastaSugerido,
  onClose,
  onClosed,
  showToast,
}: {
  project: Project;
  desdeSugerido: string;
  hastaSugerido: string;
  onClose: () => void;
  onClosed: () => void;
  showToast: Toast;
}) {
  const [desde, setDesde] = useState(desdeSugerido);
  const [hasta, setHasta] = useState(hastaSugerido < desdeSugerido ? desdeSugerido : hastaSugerido);
  const [notas, setNotas] = useState("");
  const [preview, setPreview] = useState<{ blockers: string[]; avisos: string[]; report: ProgressReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!desde || !hasta) return;
    const t = setTimeout(() => {
      api
        .previewCierre(project.id, { desde, hasta })
        .then(setPreview)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [project.id, desde, hasta]);

  const cerrar = async () => {
    if (!window.confirm(`¿Cerrar oficialmente ${fmtDate(desde)} – ${fmtDate(hasta)}? Todo lo fechado hasta el ${fmtDate(hasta)} queda congelado.`)) return;
    setBusy(true);
    try {
      await api.closePeriodo(project.id, { desde, hasta, notas: notas || undefined });
      showToast("Período cerrado", "success");
      onClosed();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const bloqueado = !preview || preview.blockers.length > 0 || Boolean(error);
  return (
    <Modal
      size="lg"
      title="Cierre oficial del período"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={cerrar} disabled={busy || bloqueado}>
            Cerrar período
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3 text-slate-900">
        <Field label="Desde">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <input type="date" className={inputClass} value={hasta} max={todayIso()} onChange={(e) => setHasta(e.target.value)} />
        </Field>
        <Field label="Notas">
          <input className={inputClass} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-1 text-sm text-slate-900">
        {error && <p className="font-semibold text-red-600">{error}</p>}
        {preview?.blockers.map((b) => (
          <p key={b} className="font-semibold text-red-600">
            {b}
          </p>
        ))}
        {preview?.avisos.map((a) => (
          <p key={a}>{a}</p>
        ))}
        {preview && (
          <p>
            Certificable s/IVA <b>{formatGs(preview.report.totales.ventaSinIva)}</b> · VG {formatGs(preview.report.totales.vg)} · VP {formatGs(preview.report.totales.vp)}
          </p>
        )}
      </div>
      {preview && <OfficialTable rows={preview.report.rows} />}
      <p className="text-xs text-slate-500">
        El cierre guarda esta foto (solo medición oficial) y congela todo lo fechado hasta el “hasta”: avance, stock, conteos y compras. Los
        certificados al cliente de este período se pueden aprobar después del cierre.
      </p>
    </Modal>
  );
}

/** Factura al cliente desde la medición oficial congelada en el cierre. */
function FacturaCierreModal({ cierre, onClose, onDone, showToast }: { cierre: CierreResumen; onClose: () => void; onDone: () => void; showToast: Toast }) {
  const [p, setP] = useState<ClientInvoicePreview | null>(null);
  const [numero, setNumero] = useState("");
  const [timbrado, setTimbrado] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .getFacturaCierre(cierre.id)
      .then(setP)
      .catch((e) => showToast(e.message, "error"));
  }, [cierre.id, showToast]);

  const emitir = async () => {
    setSaving(true);
    try {
      const inv = await api.createFacturaCierre(cierre.id, { numeroFactura: numero || null, timbrado: timbrado || null, fechaEmision: fecha });
      showToast(`Factura ${inv.numeroFactura} emitida`, "success");
      onDone();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };
  const d = p?.draft;

  return (
    <Modal
      size="lg"
      title={`Factura al cliente · ${fmtDate(cierre.desde)} – ${fmtDate(cierre.hasta)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={emitir} disabled={saving || !d?.lineas.length || Boolean(p?.facturada)}>
            Emitir factura
          </Button>
        </>
      }
    >
      {!p || !d ? (
        <p className="text-sm">Cargando…</p>
      ) : (
        <div className="space-y-3 text-sm text-slate-900">
          <p className="text-xs text-slate-600">
            Sale de la medición oficial congelada en el cierre: cantidad del período × PU del presupuesto (con IVA). IVA {d.ivaPct} % desglosado.
          </p>
          {p.avisos.map((a) => (
            <p key={a} className="text-red-600">
              {a}
            </p>
          ))}
          <div className="max-h-72 overflow-y-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                  <th className="px-2 py-1.5">Ítem</th>
                  <th className={num}>Cantidad</th>
                  <th className={num}>PU c/IVA</th>
                  <th className={num}>Total</th>
                </tr>
              </thead>
              <tbody>
                {d.lineas.map((l) => (
                  <tr key={l.budgetItemId} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">
                      {l.code} {l.name}
                    </td>
                    <td className={num}>
                      {formatQty(l.cantidad)} {l.unit}
                    </td>
                    <td className={num}>{formatGs(l.puConIva)}</td>
                    <td className={num}>{formatGs(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="ml-auto text-sm">
            <tbody>
              <tr>
                <td className="pr-4">Sin IVA</td>
                <td className="text-right tabular-nums">{formatGs(d.sinIva)}</td>
              </tr>
              <tr>
                <td className="pr-4">IVA {d.ivaPct} %</td>
                <td className="text-right tabular-nums">{formatGs(d.iva)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="pr-4">Total factura</td>
                <td className="text-right tabular-nums">{formatGs(d.total)}</td>
              </tr>
              {d.retencion > 0 && (
                <>
                  <tr>
                    <td className="pr-4">Fondo de reparo {d.retencionPct} %</td>
                    <td className="text-right tabular-nums">−{formatGs(d.retencion)}</td>
                  </tr>
                  <tr>
                    <td className="pr-4">Neto a cobrar</td>
                    <td className="text-right tabular-nums">{formatGs(d.netoACobrar)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3">
            <Field label="N° de factura">
              <input className={inputClass} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Automático" />
            </Field>
            <Field label="Timbrado">
              <input className={inputClass} value={timbrado} onChange={(e) => setTimbrado(e.target.value)} placeholder="Pendiente" />
            </Field>
            <Field label="Fecha de emisión">
              <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReabrirCierreModal({ cierre, onClose, onDone, showToast }: { cierre: CierreResumen; onClose: () => void; onDone: () => void; showToast: Toast }) {
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const reabrir = async () => {
    setSaving(true);
    try {
      const r = await api.reabrirCierre(cierre.id, motivo);
      showToast(`Cierre ${fmtDate(r.cierre.desde)} – ${fmtDate(r.cierre.hasta)} reabierto`, "success");
      r.avisos.forEach((a) => showToast(a, "info"));
      onDone();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={`Reabrir cierre ${fmtDate(cierre.desde)} – ${fmtDate(cierre.hasta)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={reabrir} disabled={saving || motivo.trim().length < 10}>
            Reabrir
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-900">
        <p>
          El período vuelve a quedar abierto: se pueden corregir partes, mediciones y documentos. El snapshot actual queda guardado y la reapertura
          queda en la auditoría. Los cierres anteriores no se pueden reabrir.
        </p>
        {cierre.factura && <p className="text-red-600">La factura {cierre.factura.numeroFactura} sigue vigente: al volver a cerrar se factura solo la diferencia.</p>}
        <Field label="Motivo (obligatorio)">
          <textarea className={inputClass} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la fiscalización corrigió la medición del ítem 3.2" />
        </Field>
      </div>
    </Modal>
  );
}

function SnapshotModal({ cierre, onClose }: { cierre: CierreResumen; onClose: () => void }) {
  const [snap, setSnap] = useState<any>(null);
  useEffect(() => {
    api.getCierre(cierre.id).then((c) => setSnap(c.snapshot));
  }, [cierre.id]);
  return (
    <Modal size="lg" title={`Cierre ${fmtDate(cierre.desde)} – ${fmtDate(cierre.hasta)}`} onClose={onClose}>
      {!snap ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-2 text-slate-900">
          <p className="text-xs text-slate-500">Foto guardada el {new Date(snap.generadoEl).toLocaleString("es-PY")}. No cambia aunque cambien precios o ACU.</p>
          {(snap.avisos ?? []).map((a: string) => (
            <p key={a} className="text-sm">
              {a}
            </p>
          ))}
          <OfficialTable rows={snap.avance?.rows ?? []} />
        </div>
      )}
    </Modal>
  );
}

// ─── Hechos de un ítem ────────────────────────────────────────────────────

function HechosDrawer({
  project,
  row,
  range,
  onClose,
  onChanged,
  showToast,
}: {
  project: Project;
  row: ProgressRow;
  range: { desde: string; hasta: string };
  onClose: () => void;
  onChanged: () => void;
  showToast: Toast;
}) {
  const [hechos, setHechos] = useState<AvanceHecho[] | null>(null);
  const load = useCallback(() => {
    api.getAvanceHechos(project.id, "2000-01-01", range.hasta, row.budgetItemId).then(setHechos).catch((e) => showToast(e.message, "error"));
  }, [project.id, range.hasta, row.budgetItemId, showToast]);
  useEffect(load, [load]);

  return (
    <Drawer title={`${row.code} · ${row.name}`} onClose={onClose}>
      <p className="text-sm">
        Contrato {formatQty(row.contrato)} {row.unit} · acumulado al {fmtDate(range.hasta)} {formatQty(row.acumulado)} (oficial {formatQty(row.acumuladoOficial)}
        {row.ultimaOficial ? `, última medición ${fmtDate(row.ultimaOficial)}` : ""})
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-xs font-semibold">
            <th className="py-1.5">Fecha</th>
            <th className="py-1.5">Origen</th>
            <th className="py-1.5 text-right">Cantidad</th>
            <th className="py-1.5 pl-3">Nota</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {hechos?.map((h) => {
            const reemplazado = h.origen === "PARTE_DIARIO" && row.ultimaOficial && h.fecha <= row.ultimaOficial;
            return (
              <tr key={h.id} className={cx("border-b border-slate-100", reemplazado && "text-slate-400 line-through")}>
                <td className="py-1.5 tabular-nums">{fmtDate(h.fecha)}</td>
                <td className="py-1.5">{h.origen === "MEDICION_OFICIAL" ? "Medición oficial" : "Parte diario"}</td>
                <td className="py-1.5 text-right tabular-nums">{formatQty(h.cantidad)}</td>
                <td className="py-1.5 pl-3 text-xs">{h.nota}</td>
                <td className="w-8 text-center">
                  {h.origen === "PARTE_DIARIO" && (
                    <button
                      className="p-1 text-slate-400 hover:text-slate-900"
                      title="Borrar parte"
                      onClick={async () => {
                        try {
                          await api.deleteAvance(h.id);
                          load();
                          onChanged();
                        } catch (e: any) {
                          showToast(e.message, "error");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">Tachado: parte diario reemplazado por una medición oficial posterior.</p>
    </Drawer>
  );
}
