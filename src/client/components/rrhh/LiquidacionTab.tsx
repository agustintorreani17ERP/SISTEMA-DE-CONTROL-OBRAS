import React, { useState, useEffect, useRef } from "react";
import { Plus, CheckCircle2, Wallet, Printer, RefreshCw, Eye, AlertTriangle } from "lucide-react";
import { api } from "../../api";
import {
  Project, Empleado, LiquidacionPersonal, LiquidacionEstado, ImputableItem, RRHHConfig,
} from "../../types";
import {
  Page, Button, Card, Field, inputClass, Modal, EmptyState, Badge, Stat, StatGrid,
} from "../../ui";
import { formatGs, formatQty } from "../../utils/numbers";

const ESTADO_TONE: Record<LiquidacionEstado, string> = {
  BORRADOR: "bg-slate-100 text-slate-600",
  APROBADA: "bg-blue-50 text-blue-700",
  PAGADA: "bg-emerald-50 text-emerald-700",
};

interface Props {
  project: Project;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

// Genera lista de periodos últimos 12 meses
function periodOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
    opts.push({ val, label });
  }
  return opts;
}

const PERIODOS = periodOptions();

const defaultForm = () => ({
  empleadoId: 0,
  periodo: PERIODOS[0].val,
  diasTrabajados: 30,
  horasNormales: 240,
  horasExtra: 0,
  bonificacionFamiliar: 0,
  otrosBonos: 0,
  anticipos: 0,
  otrosDescuentos: 0,
  budgetItemId: null as number | null,
  notas: "",
});

export const LiquidacionTab: React.FC<Props> = ({ project, showToast }) => {
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionPersonal[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [items, setItems] = useState<ImputableItem[]>([]);
  const [config, setConfig] = useState<RRHHConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodoFilter, setPeriodoFilter] = useState(PERIODOS[0].val);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [preview, setPreview] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recibo, setRecibo] = useState<LiquidacionPersonal | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [liqs, emps, its, cfg] = await Promise.all([
        api.getLiquidaciones({ projectId: project.id }),
        api.getEmpleados(project.id),
        api.getImputableItems(project.id),
        api.getRRHHConfig(project.id),
      ]);
      setLiquidaciones(liqs);
      setEmpleados(emps.filter((e: Empleado) => e.activo));
      setItems(its);
      setConfig(cfg);
    } catch (e: any) {
      showToast(e.message || "Error al cargar", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [project.id]);

  const filteredLiqs = liquidaciones.filter((l) => !periodoFilter || l.periodo === periodoFilter);

  const totalNeto = filteredLiqs.reduce((s, l) => s + Number(l.netoAPagar), 0);
  const totalCosto = filteredLiqs.reduce((s, l) => s + Number(l.costoTotal), 0);
  const totalIPS = filteredLiqs.reduce((s, l) => s + Number(l.ipsPatronal), 0);

  // Calcular preview en tiempo real
  const calcPreview = async (f = form) => {
    if (!f.empleadoId) return;
    setCalculating(true);
    try {
      const res = await api.calcularLiquidacion({ ...f, projectId: project.id });
      setPreview(res);
    } catch {
      // silencioso
    } finally {
      setCalculating(false);
    }
  };

  const updateForm = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (next.empleadoId) calcPreview(next);
  };

  const handleCreate = async () => {
    if (!form.empleadoId) { showToast("Seleccioná un empleado", "error"); return; }
    setSaving(true);
    try {
      await api.createLiquidacion({ ...form, projectId: project.id });
      showToast("Liquidación creada", "success");
      setFormOpen(false);
      setForm(defaultForm());
      setPreview(null);
      load();
    } catch (e: any) {
      showToast(e.message || "Error al crear", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAprobar = async (id: number) => {
    if (!window.confirm("¿Aprobar esta liquidación? Se registrará el costo en el presupuesto de la obra.")) return;
    try {
      await api.aprobarLiquidacion(id);
      showToast("Liquidación aprobada y costo registrado", "success");
      load();
    } catch (e: any) {
      showToast(e.message || "Error al aprobar", "error");
    }
  };

  const handlePagar = async (id: number) => {
    if (!window.confirm("¿Marcar como pagada?")) return;
    try {
      await api.pagarLiquidacion(id);
      showToast("Marcada como pagada");
      load();
    } catch (e: any) {
      showToast(e.message || "Error", "error");
    }
  };

  return (
    <div className="space-y-4">
      {/* KPIs del período */}
      <StatGrid>
        <Stat label="Neto a pagar" value={`${formatGs(totalNeto)} Gs.`} tone={totalNeto > 0 ? "neutral" : "neutral"} />
        <Stat label="Costo total (inc. IPS patronal)" value={`${formatGs(totalCosto)} Gs.`} tone="warn" />
        <Stat label="IPS patronal (16,5%)" value={`${formatGs(totalIPS)} Gs.`} />
        <Stat label="Liquidaciones" value={filteredLiqs.length} hint={periodoFilter ? PERIODOS.find(p => p.val === periodoFilter)?.label : "Todos los períodos"} />
      </StatGrid>

      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Período:</label>
          <select
            className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
            value={periodoFilter}
            onChange={(e) => setPeriodoFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {PERIODOS.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => { setForm(defaultForm()); setPreview(null); setFormOpen(true); }}
          >
            Nueva liquidación
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : filteredLiqs.length === 0 ? (
        <EmptyState title="Sin liquidaciones" help="Creá la primera liquidación del período." />
      ) : (
        <Card padded={false}>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Empleado</th>
                <th className="px-3 py-3 text-left">Período</th>
                <th className="px-3 py-3 text-right">Días</th>
                <th className="px-3 py-3 text-right">Salario base</th>
                <th className="px-3 py-3 text-right">Subtotal</th>
                <th className="px-3 py-3 text-right">IPS obr.</th>
                <th className="px-3 py-3 text-right">IPS patr.</th>
                <th className="px-3 py-3 text-right">Anticipos</th>
                <th className="px-3 py-3 text-right font-bold text-slate-800">Neto</th>
                <th className="px-3 py-3 text-center">Estado</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLiqs.map((liq) => (
                <tr key={liq.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{liq.empleado?.fullName || `#${liq.empleadoId}`}</td>
                  <td className="px-3 py-3 font-mono text-slate-600">{liq.periodo}</td>
                  <td className="px-3 py-3 text-right">{Number(liq.diasTrabajados)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatGs(Number(liq.salarioBase))}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatGs(Number(liq.subTotal))}</td>
                  <td className="px-3 py-3 text-right font-mono text-red-600">{formatGs(Number(liq.ipsObrero))}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-600">{formatGs(Number(liq.ipsPatronal))}</td>
                  <td className="px-3 py-3 text-right font-mono text-red-600">{formatGs(Number(liq.anticipos))}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">{formatGs(Number(liq.netoAPagar))} Gs.</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_TONE[liq.estado]}`}>
                      {liq.estado}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        title="Ver recibo"
                        onClick={() => setRecibo(liq)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {liq.estado === "BORRADOR" && (
                        <>
                          {!liq.budgetItemId && (
                            <span title="Sin rubro asignado — no se podrá aprobar" className="text-amber-500">
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <button
                            title="Aprobar (registra costo en presupuesto)"
                            onClick={() => handleAprobar(liq.id)}
                            className="p-1 text-slate-400 hover:text-emerald-600 rounded"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {liq.estado === "APROBADA" && (
                        <button
                          title="Marcar como pagada"
                          onClick={() => handlePagar(liq.id)}
                          className="p-1 text-slate-400 hover:text-emerald-700 rounded"
                        >
                          <Wallet className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal nueva liquidación */}
      {formOpen && (
        <Modal
          title="Nueva liquidación de personal"
          onClose={() => setFormOpen(false)}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button variant="primary" onClick={handleCreate} disabled={saving || !form.empleadoId}>
                {saving ? "Guardando…" : "Crear liquidación"}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Empleado *">
              <select className={inputClass} value={form.empleadoId} onChange={(e) => updateForm({ empleadoId: Number(e.target.value) })}>
                <option value={0}>Seleccioná un empleado…</option>
                {empleados.map(e => (
                  <option key={e.id} value={e.id}>{e.fullName} — {e.oficio}</option>
                ))}
              </select>
            </Field>
            <Field label="Período *">
              <select className={inputClass} value={form.periodo} onChange={(e) => updateForm({ periodo: e.target.value })}>
                {PERIODOS.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Días trabajados">
              <input type="number" className={inputClass} value={form.diasTrabajados} onChange={(e) => updateForm({ diasTrabajados: Number(e.target.value) })} />
            </Field>
            <Field label="Horas normales">
              <input type="number" className={inputClass} value={form.horasNormales} onChange={(e) => updateForm({ horasNormales: Number(e.target.value) })} />
            </Field>
            <Field label="Horas extra">
              <input type="number" className={inputClass} value={form.horasExtra} onChange={(e) => updateForm({ horasExtra: Number(e.target.value) })} />
            </Field>
            <Field label="Bonificación familiar (Gs.)">
              <input type="number" className={inputClass} value={form.bonificacionFamiliar} onChange={(e) => updateForm({ bonificacionFamiliar: Number(e.target.value) })} />
            </Field>
            <Field label="Otros bonos (Gs.)">
              <input type="number" className={inputClass} value={form.otrosBonos} onChange={(e) => updateForm({ otrosBonos: Number(e.target.value) })} />
            </Field>
            <Field label="Anticipos (Gs.)">
              <input type="number" className={inputClass} value={form.anticipos} onChange={(e) => updateForm({ anticipos: Number(e.target.value) })} />
            </Field>
            <Field label="Otros descuentos (Gs.)">
              <input type="number" className={inputClass} value={form.otrosDescuentos} onChange={(e) => updateForm({ otrosDescuentos: Number(e.target.value) })} />
            </Field>
            <Field label="Rubro presupuestario (para el asiento)">
              <select className={inputClass} value={form.budgetItemId || ""} onChange={(e) => updateForm({ budgetItemId: Number(e.target.value) || null })}>
                <option value="">Sin asignación</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </Field>
            <Field label="Notas" className="sm:col-span-2">
              <input className={inputClass} value={form.notas} onChange={(e) => updateForm({ notas: e.target.value })} />
            </Field>
          </div>

          {/* Preview de cálculo */}
          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs mt-2">
              <p className="font-bold text-slate-700 text-sm">Vista previa</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                <span className="text-slate-500">Salario base:</span>
                <span>{formatGs(Number(preview.empleado?.salarioBase))} Gs.</span>
                <span className="text-slate-500">Salario proporcional:</span>
                <span>{formatGs(preview.salarioProporcional)} Gs.</span>
                <span className="text-slate-500">Hs. extra ({preview.horasExtra}h × {formatGs(preview.valorHoraExtra)}):</span>
                <span>{formatGs(preview.montoHorasExtra)} Gs.</span>
                <span className="text-slate-500">Bonif. familiar:</span>
                <span>{formatGs(preview.bonificacionFamiliar)} Gs.</span>
                <span className="text-slate-500">Otros bonos:</span>
                <span>{formatGs(preview.otrosBonos)} Gs.</span>
                <span className="font-semibold text-slate-700">Subtotal:</span>
                <span className="font-semibold">{formatGs(preview.subTotal)} Gs.</span>
                <span className="text-red-600">(−) IPS obrero 9%:</span>
                <span className="text-red-600">{formatGs(preview.ipsObrero)} Gs.</span>
                <span className="text-slate-500">(−) Anticipos:</span>
                <span className="text-red-600">{formatGs(preview.anticipos)} Gs.</span>
                <span className="text-slate-500">(−) Otros descuentos:</span>
                <span className="text-red-600">{formatGs(preview.otrosDescuentos)} Gs.</span>
                <span className="font-black text-emerald-800 text-sm border-t border-slate-200 pt-1">NETO A PAGAR:</span>
                <span className="font-black text-emerald-800 text-sm border-t border-slate-200 pt-1">{formatGs(preview.netoAPagar)} Gs.</span>
                <span className="text-orange-600 border-t border-slate-200 pt-1">(+) IPS patronal 16,5%:</span>
                <span className="text-orange-600 border-t border-slate-200 pt-1">{formatGs(preview.ipsPatronal)} Gs.</span>
                <span className="font-bold text-slate-700">Costo total empresa:</span>
                <span className="font-bold">{formatGs(preview.costoTotal)} Gs.</span>
                <span className="text-slate-500">Aguinaldo devengado (÷12):</span>
                <span>{formatGs(preview.aguinaldo)} Gs.</span>
              </div>
            </div>
          )}
          {calculating && <p className="text-xs text-slate-400">Calculando…</p>}
        </Modal>
      )}

      {/* Recibo imprimible */}
      {recibo && <ReciboModal liq={recibo} project={project} onClose={() => setRecibo(null)} />}
    </div>
  );
};

// ──────────────────────────────────────────────
// Recibo imprimible
// ──────────────────────────────────────────────

const ReciboModal: React.FC<{ liq: LiquidacionPersonal; project: Project; onClose: () => void }> = ({ liq, project, onClose }) => {
  const handlePrint = () => window.print();

  return (
    <Modal
      title="Recibo de liquidación"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" icon={<Printer className="w-4 h-4" />} onClick={handlePrint}>
            Imprimir / PDF
          </Button>
        </>
      }
    >
      <style>{`
        @media print {
          @page { size: A4; margin: 15mm; }
          body * { visibility: hidden; }
          #recibo-contenido, #recibo-contenido * { visibility: visible; }
          #recibo-contenido { position: fixed; left: 0; top: 0; width: 100%; }
        }
      `}</style>
      <div id="recibo-contenido" className="font-sans text-sm space-y-4">
        {/* Cabecera */}
        <div className="border-b-2 border-slate-800 pb-3">
          <h1 className="text-lg font-black text-slate-900">RECIBO DE HABERES</h1>
          <p className="text-xs text-slate-500">Obra: {project.name} — Período: {liq.periodo}</p>
        </div>

        {/* Datos empleado */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-slate-500">Empleado:</span> <strong>{liq.empleado?.fullName}</strong></div>
          <div><span className="text-slate-500">CI:</span> <span className="font-mono">{liq.empleado?.ci}</span></div>
          <div><span className="text-slate-500">Tipo:</span> {liq.empleado?.tipo}</div>
          <div><span className="text-slate-500">Días trabajados:</span> {Number(liq.diasTrabajados)}</div>
        </div>

        {/* Tabla de haberes y descuentos */}
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left px-3 py-1.5 border border-slate-200">Concepto</th>
              <th className="text-right px-3 py-1.5 border border-slate-200">Importe (Gs.)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Salario base", Number(liq.salarioBase)],
              ["Horas extra", Number(liq.montoHorasExtra)],
              ["Bonificación familiar", Number(liq.bonificacionFamiliar)],
              ["Otros bonos", Number(liq.otrosBonos)],
            ].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
              <tr key={label as string} className="border-b border-slate-100">
                <td className="px-3 py-1 border border-slate-200">{label}</td>
                <td className="px-3 py-1 text-right font-mono border border-slate-200">{formatGs(Number(val))}</td>
              </tr>
            ))}
            <tr className="font-bold bg-slate-50 border-b-2 border-slate-300">
              <td className="px-3 py-1.5 border border-slate-200">SUBTOTAL</td>
              <td className="px-3 py-1.5 text-right font-mono border border-slate-200">{formatGs(Number(liq.subTotal))}</td>
            </tr>
            {[
              ["(−) IPS obrero 9%", Number(liq.ipsObrero)],
              ["(−) Anticipos", Number(liq.anticipos)],
              ["(−) Otros descuentos", Number(liq.otrosDescuentos)],
            ].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
              <tr key={label as string} className="text-red-700 border-b border-slate-100">
                <td className="px-3 py-1 border border-slate-200">{label}</td>
                <td className="px-3 py-1 text-right font-mono border border-slate-200">({formatGs(Number(val))})</td>
              </tr>
            ))}
            <tr className="font-black bg-slate-900 text-white">
              <td className="px-3 py-2 border border-slate-700">NETO A PAGAR</td>
              <td className="px-3 py-2 text-right font-mono border border-slate-700 text-lg">{formatGs(Number(liq.netoAPagar))} Gs.</td>
            </tr>
          </tbody>
        </table>

        {/* Aguinaldo devengado */}
        <p className="text-xs text-slate-500 italic">
          Aguinaldo devengado del período: {formatGs(Number(liq.aguinaldo))} Gs.
          (IPS patronal: {formatGs(Number(liq.ipsPatronal))} Gs. — Costo total empresa: {formatGs(Number(liq.costoTotal))} Gs.)
        </p>

        {liq.notas && <p className="text-xs text-slate-600">Notas: {liq.notas}</p>}

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-8 pt-16 mt-8 border-t border-slate-200">
          <div className="text-center text-xs">
            <div className="border-t border-slate-400 pt-1 mt-8">
              <p className="font-bold">Firma del empleado</p>
              <p className="text-slate-400">{liq.empleado?.fullName}</p>
            </div>
          </div>
          <div className="text-center text-xs">
            <div className="border-t border-slate-400 pt-1 mt-8">
              <p className="font-bold">Responsable de Obra</p>
              <p className="text-slate-400">{project.name}</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
