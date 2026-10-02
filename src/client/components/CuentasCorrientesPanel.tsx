import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Settings, FileText, Layers, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Anticipo, CuentaFinanciera, FacturaCuentaCorriente, Partner, Project, RetencionFondo, AgingBucket } from "../types";
import { formatDate } from "../utils/format";
import { formatGs } from "../utils/numbers";
import { todayIso } from "../insumos/labels";

interface Props {
  project?: Project | null;
  tipo: "EMITIDA" | "RECIBIDA";
  partners: Partner[];
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const BUCKET_LABEL: Record<AgingBucket, { label: string; style: string }> = {
  A_VENCER: { label: "A vencer", style: "bg-slate-100 text-slate-700 border-slate-200" },
  "0-30": { label: "0-30 días", style: "bg-amber-50 text-amber-800 border-amber-200" },
  "31-60": { label: "31-60 días", style: "bg-orange-50 text-orange-800 border-orange-200" },
  "61-90": { label: "61-90 días", style: "bg-rose-50 text-rose-800 border-rose-200" },
  "+90": { label: "+90 días", style: "bg-rose-100 text-rose-900 border-rose-300 font-black" },
};

const inputClass = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs";

export const CuentasCorrientesPanel: React.FC<Props> = ({ project, tipo, partners, showToast }) => {
  const [facturas, setFacturas] = useState<FacturaCuentaCorriente[]>([]);
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [showPayModal, setShowPayModal] = useState(false);
  const [partnerFiltro, setPartnerFiltro] = useState<number | "">("");
  const [showEstadoCuenta, setShowEstadoCuenta] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const load = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await api.getFacturasCuentaCorriente(project.id, tipo);
      setFacturas(res.facturas);
      setBuckets(res.buckets);
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar las facturas", "error");
    }
  }, [project?.id, tipo, showToast]);

  useEffect(() => {
    load();
    setSelected({});
  }, [load]);

  const filtered = useMemo(
    () => facturas.filter((f) => !partnerFiltro || f.partner?.id === partnerFiltro),
    [facturas, partnerFiltro]
  );

  const selectedList = useMemo(
    () => Object.entries(selected).filter(([, m]) => m > 0).map(([id, monto]) => ({ invoiceId: Number(id), monto })),
    [selected]
  );
  const selectedTotal = selectedList.reduce((acc, s) => acc + s.monto, 0);

  const toggleSelect = (f: FacturaCuentaCorriente) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = f.saldo;
      return next;
    });
  };

  const label = tipo === "EMITIDA" ? "A cobrar" : "A pagar";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">{label} · con saldo y antigüedad</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <select value={partnerFiltro} onChange={(e) => setPartnerFiltro(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
            <option value="">Todos los terceros</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowEstadoCuenta(true)}
            disabled={!partnerFiltro}
            className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileText className="h-4 w-4" /> Estado de cuenta
          </button>
          <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50">
            <Settings className="h-4 w-4" /> % Configurables
          </button>
          <button
            onClick={() => setShowPayModal(true)}
            disabled={selectedList.length < 2}
            className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-40"
            title="Elegí 2 o más facturas para cancelarlas con un solo pago"
          >
            <Layers className="h-4 w-4" /> Pago múltiple ({selectedList.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(["A_VENCER", "0-30", "31-60", "61-90", "+90"] as AgingBucket[]).map((b) => (
          <div key={b} className={`rounded-xl border p-3 text-center ${BUCKET_LABEL[b].style}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide">{BUCKET_LABEL[b].label}</p>
            <p className="mt-1 font-mono text-sm font-black">{formatGs(buckets[b] ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Factura</th>
              <th className="px-3 py-2 text-left">Tercero</th>
              <th className="px-3 py-2 text-left">Vencimiento</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Retenido</th>
              <th className="px-3 py-2 text-right">Pagado</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2 text-center">Antigüedad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Sin facturas con saldo pendiente.
                </td>
              </tr>
            )}
            {filtered.map((f) => (
              <tr key={f.id} className={selected[f.id] ? "bg-blue-50/40" : ""}>
                <td className="px-2 py-2 text-center">
                  <input type="checkbox" checked={Boolean(selected[f.id])} onChange={() => toggleSelect(f)} />
                </td>
                <td className="px-3 py-2 font-mono font-bold text-slate-900">{f.numeroFactura}</td>
                <td className="px-3 py-2">{f.partner?.name ?? "Comitente"}</td>
                <td className="px-3 py-2">{formatDate(f.fechaVencimiento)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatGs(f.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">{f.montoRetenido ? formatGs(f.montoRetenido) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">{formatGs(f.totalPagado)}</td>
                <td className="px-3 py-2 text-right font-mono font-black text-slate-900">{formatGs(f.saldo)}</td>
                <td className="px-3 py-2 text-center">
                  {f.bucket && (
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${BUCKET_LABEL[f.bucket].style}`}>
                      {BUCKET_LABEL[f.bucket].label}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPayModal && (
        <PagoMultipleModal
          project={project!}
          selected={selectedList}
          facturas={facturas}
          onClose={() => setShowPayModal(false)}
          onPaid={() => {
            setShowPayModal(false);
            setSelected({});
            load();
          }}
          showToast={showToast}
        />
      )}

      {showEstadoCuenta && partnerFiltro && (
        <EstadoCuentaModal
          project={project!}
          partnerId={partnerFiltro}
          partnerName={partners.find((p) => p.id === partnerFiltro)?.name ?? ""}
          onClose={() => setShowEstadoCuenta(false)}
          showToast={showToast}
        />
      )}

      {showConfig && project?.id && <ConfigModal projectId={project.id} onClose={() => setShowConfig(false)} showToast={showToast} />}
    </div>
  );
};

function PagoMultipleModal({
  project,
  selected,
  facturas,
  onClose,
  onPaid,
  showToast,
}: {
  project: Project;
  selected: { invoiceId: number; monto: number }[];
  facturas: FacturaCuentaCorriente[];
  onClose: () => void;
  onPaid: () => void;
  showToast: Props["showToast"];
}) {
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [cuentaFinancieraId, setCuentaFinancieraId] = useState<number | "">("");
  const [fecha, setFecha] = useState(todayIso());
  const [metodo, setMetodo] = useState<"TRANSFERENCIA" | "CHEQUE" | "EFECTIVO">("TRANSFERENCIA");
  const [referenciaBanco, setReferenciaBanco] = useState("");
  const [notas, setNotas] = useState("");
  const [montos, setMontos] = useState<Record<number, number>>(() => Object.fromEntries(selected.map((s) => [s.invoiceId, s.monto])));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getCuentasFinancieras(project.id).then((data) => {
      setCuentas(data.filter((c) => c.active));
      setCuentaFinancieraId((prev) => prev || data.find((c) => c.active)?.id || "");
    });
  }, [project.id]);

  const total = Object.values(montos).reduce((acc, m) => acc + (m || 0), 0);

  const save = async () => {
    if (!cuentaFinancieraId) return showToast("Elegí la cuenta financiera", "error");
    if (!referenciaBanco.trim()) return showToast("Indicá la referencia del pago", "error");
    setLoading(true);
    try {
      await api.pagarFacturasMultiples({
        cuentaFinancieraId: Number(cuentaFinancieraId),
        fecha,
        metodo,
        referenciaBanco,
        notas,
        aplicaciones: selected.map((s) => ({ invoiceId: s.invoiceId, monto: montos[s.invoiceId] })),
      });
      showToast(`Pago registrado: ${selected.length} facturas por ₲ ${formatGs(total)}`);
      onPaid();
    } catch (err: any) {
      showToast(err.message || "No se pudo registrar el pago múltiple", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Pago múltiple" onClose={onClose}>
      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {selected.map((s) => {
          const f = facturas.find((x) => x.id === s.invoiceId);
          return (
            <div key={s.invoiceId} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono font-bold">{f?.numeroFactura}</span>
              <span className="text-slate-500">Saldo {formatGs(f?.saldo ?? 0)}</span>
              <input
                type="number"
                value={montos[s.invoiceId] ?? 0}
                max={f?.saldo}
                min={0}
                onChange={(e) => setMontos((prev) => ({ ...prev, [s.invoiceId]: Number(e.target.value) }))}
                className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-right font-mono"
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-2 text-xs font-bold">
        <span>Total del pago</span>
        <span className="font-mono">{formatGs(total)}</span>
      </div>
      <select value={cuentaFinancieraId} onChange={(e) => setCuentaFinancieraId(Number(e.target.value))} className={inputClass}>
        <option value="">Cuenta financiera…</option>
        {cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre} · Saldo {formatGs(c.saldoActual)}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select value={metodo} onChange={(e) => setMetodo(e.target.value as any)} className={inputClass}>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="EFECTIVO">Efectivo</option>
        </select>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
      </div>
      <input value={referenciaBanco} onChange={(e) => setReferenciaBanco(e.target.value)} placeholder="Referencia / N° de comprobante" className={inputClass} />
      <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas (opcional)" className={inputClass} />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 font-semibold text-slate-600">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={loading || !cuentaFinancieraId || total <= 0}
          className="rounded-lg bg-blue-600 px-4 py-1.5 font-bold text-white disabled:opacity-50"
        >
          {loading ? "Guardando…" : "Confirmar pago"}
        </button>
      </div>
    </Modal>
  );
}

function EstadoCuentaModal({
  project,
  partnerId,
  partnerName,
  onClose,
  showToast,
}: {
  project: Project;
  partnerId: number;
  partnerName: string;
  onClose: () => void;
  showToast: Props["showToast"];
}) {
  const [data, setData] = useState<{
    facturas: FacturaCuentaCorriente[];
    anticipos: Anticipo[];
    retenciones: RetencionFondo[];
    totales: { saldoFacturasPendientes: number; saldoAnticiposPendientes: number; saldoRetencionesPendientes: number };
  } | null>(null);

  useEffect(() => {
    api
      .getEstadoCuenta(project.id, partnerId)
      .then(setData)
      .catch((err) => showToast(err.message || "No se pudo cargar el estado de cuenta", "error"));
  }, [project.id, partnerId, showToast]);

  const liberar = async (id: number, saldoPendiente: number) => {
    try {
      await api.liberarRetencion(id, saldoPendiente);
      showToast("Retención liberada");
      setData(await api.getEstadoCuenta(project.id, partnerId));
    } catch (err: any) {
      showToast(err.message || "No se pudo liberar la retención", "error");
    }
  };

  return (
    <Modal title={`Estado de cuenta — ${partnerName}`} onClose={onClose} wide>
      {!data ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
              <p className="text-[10px] uppercase text-slate-500">Facturas pendientes</p>
              <p className="font-mono font-black">{formatGs(data.totales.saldoFacturasPendientes)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
              <p className="text-[10px] uppercase text-slate-500">Anticipos pendientes</p>
              <p className="font-mono font-black">{formatGs(data.totales.saldoAnticiposPendientes)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
              <p className="text-[10px] uppercase text-slate-500">Retenciones pendientes</p>
              <p className="font-mono font-black">{formatGs(data.totales.saldoRetencionesPendientes)}</p>
            </div>
          </div>

          <Section title="Facturas">
            {data.facturas.map((f) => (
              <Row key={f.id} left={`${f.numeroFactura} (${f.tipo})`} right={`Saldo ${formatGs(f.saldo)}`} />
            ))}
            {data.facturas.length === 0 && <Empty />}
          </Section>

          <Section title="Anticipos">
            {data.anticipos.map((a) => (
              <Row key={a.id} left={`${a.tipo} · ${formatDate(a.fecha)}`} right={`Pendiente ${formatGs(a.saldoPendiente)}`} />
            ))}
            {data.anticipos.length === 0 && <Empty />}
          </Section>

          <Section title="Fondo de reparo / Retenciones">
            {data.retenciones.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-xs last:border-0">
                <span>
                  {r.tipo} · {formatDate(r.fecha)}
                </span>
                <span className="font-mono">Pendiente {formatGs(r.saldoPendiente)}</span>
                {r.saldoPendiente > 0 && (
                  <button
                    onClick={() => liberar(r.id, r.saldoPendiente)}
                    className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    Liberar
                  </button>
                )}
              </div>
            ))}
            {data.retenciones.length === 0 && <Empty />}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function ConfigModal({ projectId, onClose, showToast }: { projectId: number; onClose: () => void; showToast: Props["showToast"] }) {
  const [pctFondoReparo, setPctFondoReparo] = useState("5");
  const [pctRetencionGarantia, setPctRetencionGarantia] = useState("0");
  const [pctAnticipo, setPctAnticipo] = useState("0");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfigRetencionesAnticipos(projectId).then((c) => {
      setPctFondoReparo(String(c.pctFondoReparo));
      setPctRetencionGarantia(String(c.pctRetencionGarantia));
      setPctAnticipo(String(c.pctAnticipo));
      setLoading(false);
    });
  }, [projectId]);

  const save = async () => {
    try {
      await api.updateConfigRetencionesAnticipos({
        projectId,
        pctFondoReparo: Number(pctFondoReparo),
        pctRetencionGarantia: Number(pctRetencionGarantia),
        pctAnticipo: Number(pctAnticipo),
      });
      showToast("Porcentajes actualizados");
      onClose();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar la configuración", "error");
    }
  };

  return (
    <Modal title="Porcentajes configurables de la obra" onClose={onClose}>
      {loading ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <Field label="Fondo de reparo (%)" value={pctFondoReparo} onChange={setPctFondoReparo} />
          <Field label="Retención de garantía (%)" value={pctRetencionGarantia} onChange={setPctRetencionGarantia} />
          <Field label="Anticipo (%)" value={pctAnticipo} onChange={setPctAnticipo} />
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 font-semibold text-slate-600">
              Cancelar
            </button>
            <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-1.5 font-bold text-white">
              Guardar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-700">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700">
        <ShieldCheck className="h-3.5 w-3.5 text-slate-400" /> {title}
      </p>
      <div className="rounded-xl border border-slate-200 p-2">{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs last:border-0">
      <span>{left}</span>
      <span className="font-mono">{right}</span>
    </div>
  );
}

function Empty() {
  return <p className="py-1.5 text-center text-[11px] text-slate-400">Sin registros.</p>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}
