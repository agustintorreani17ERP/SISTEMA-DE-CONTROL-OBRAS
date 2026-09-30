import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Plus, ArrowRightLeft, Banknote } from "lucide-react";
import { api } from "../api";
import { Cheque, CuentaFinanciera, MovimientoCuentaFinanciera, Project } from "../types";
import { formatDate, parseFlexibleNumber } from "../utils/format";
import { formatGs } from "../utils/numbers";
import { todayIso } from "../insumos/labels";

interface BancosCajasPanelProps {
  project?: Project | null;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const CHEQUE_ESTADO_LABEL: Record<Cheque["estado"], { label: string; style: string }> = {
  PENDIENTE: { label: "Pendiente", style: "bg-amber-50 text-amber-800 border-amber-200" },
  DEPOSITADO: { label: "Depositado", style: "bg-blue-50 text-blue-800 border-blue-200" },
  ACREDITADO: { label: "Acreditado", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  RECHAZADO: { label: "Rechazado", style: "bg-rose-50 text-rose-800 border-rose-200" },
  ANULADO: { label: "Anulado", style: "bg-slate-100 text-slate-500 border-slate-200" },
};

const firstDayOfMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

/**
 * Bancos y cajas de la obra: saldos por cuenta, movimientos por rango de fechas, transferencias
 * entre cuentas y cheques con fecha diferida (solo impactan el saldo cuando se acreditan).
 */
export const BancosCajasPanel: React.FC<BancosCajasPanelProps> = ({ project, showToast }) => {
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [desde, setDesde] = useState(firstDayOfMonthIso());
  const [hasta, setHasta] = useState(todayIso());
  const [saldoInicialRango, setSaldoInicialRango] = useState(0);
  const [movimientos, setMovimientos] = useState<MovimientoCuentaFinanciera[]>([]);
  const [saldoFinalRango, setSaldoFinalRango] = useState(0);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [showCuentaForm, setShowCuentaForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadCuentas = useCallback(async () => {
    if (!project?.id) return;
    try {
      const data = await api.getCuentasFinancieras(project.id);
      setCuentas(data);
      setCuentaId((prev) => (prev && data.some((c) => c.id === prev) ? prev : data[0]?.id ?? null));
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar las cuentas financieras", "error");
    }
  }, [project?.id, showToast]);

  const loadCheques = useCallback(async () => {
    if (!project?.id) return;
    try {
      setCheques(await api.getCheques(project.id));
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar los cheques", "error");
    }
  }, [project?.id, showToast]);

  useEffect(() => {
    loadCuentas();
    loadCheques();
  }, [loadCuentas, loadCheques]);

  const loadMovimientos = useCallback(async () => {
    if (!cuentaId) return;
    setLoading(true);
    try {
      const res = await api.getMovimientosCuenta(cuentaId, desde, hasta);
      setSaldoInicialRango(res.saldoInicialRango);
      setMovimientos(res.movimientos);
      setSaldoFinalRango(res.saldoFinalRango);
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar los movimientos", "error");
    } finally {
      setLoading(false);
    }
  }, [cuentaId, desde, hasta, showToast]);

  useEffect(() => {
    loadMovimientos();
  }, [loadMovimientos]);

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? null;
  const changed = () => {
    loadCuentas();
    loadMovimientos();
    loadCheques();
  };

  const chequesPendientes = useMemo(() => cheques.filter((c) => c.estado === "PENDIENTE" || c.estado === "DEPOSITADO"), [cheques]);

  const setChequeEstado = async (id: number, estado: Cheque["estado"]) => {
    try {
      await api.updateChequeEstado(id, estado);
      showToast(`Cheque actualizado a ${CHEQUE_ESTADO_LABEL[estado].label}`);
      changed();
    } catch (err: any) {
      showToast(err.message || "No se pudo actualizar el cheque", "error");
    }
  };

  if (!project) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Bancos y cajas</h3>
        </div>
        <div className="flex gap-2 text-xs font-bold">
          <button onClick={() => setShowCuentaForm(true)} className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Nueva cuenta
          </button>
          <button
            onClick={() => setShowTransferForm(true)}
            disabled={cuentas.length < 2}
            className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <ArrowRightLeft className="h-4 w-4" /> Transferencia
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cuentas.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
            La obra no tiene cuentas financieras. Creá un banco o una caja para registrar pagos y movimientos.
          </p>
        )}
        {cuentas.map((c) => (
          <button
            key={c.id}
            onClick={() => setCuentaId(c.id)}
            className={`rounded-2xl border p-3.5 text-left shadow-xs transition ${
              c.id === cuentaId ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
            } ${!c.active ? "opacity-50" : ""}`}
          >
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-slate-500" />
              <p className="text-xs font-bold text-slate-900">{c.nombre}</p>
            </div>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
              {c.tipo === "BANCO" ? "Banco" : "Caja"} · {c.moneda}
              {c.numeroCuenta ? ` · ${c.numeroCuenta}` : ""}
              {!c.active ? " · Inactiva" : ""}
            </p>
            <p className="mt-2 font-mono text-sm font-black text-slate-900">{formatGs(c.saldoActual)}</p>
          </button>
        ))}
      </div>

      {cuenta && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-3.5">
            <div>
              <p className="text-xs font-bold text-slate-900">{cuenta.nombre} · Movimientos</p>
              <p className="text-[11px] text-slate-500">Saldo al inicio del rango: <strong className="font-mono">{formatGs(saldoInicialRango)}</strong></p>
            </div>
            <div className="flex items-end gap-2 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-600">Desde</label>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-600">Hasta</label>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Concepto</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && movimientos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      Sin movimientos en el rango seleccionado.
                    </td>
                  </tr>
                )}
                {movimientos.map((m) => (
                  <tr key={m.id} className={!m.confirmado ? "opacity-50" : ""}>
                    <td className="px-3 py-2">{formatDate(m.fecha)}</td>
                    <td className="px-3 py-2">
                      {m.concepto}
                      {!m.confirmado && <span className="ml-1 text-[10px] text-amber-600">(pendiente de acreditar)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${m.tipo === "INGRESO" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                        {m.tipo === "INGRESO" ? "Ingreso" : "Egreso"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{formatGs(m.monto)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatGs(m.saldoAcumulado)}</td>
                  </tr>
                ))}
              </tbody>
              {movimientos.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                    <td colSpan={4} className="px-3 py-2 text-right">Saldo al final del rango</td>
                    <td className="px-3 py-2 text-right font-mono">{formatGs(saldoFinalRango)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 p-3.5">
          <p className="text-xs font-bold text-slate-900">Cheques</p>
          <p className="text-[11px] text-slate-500">
            {chequesPendientes.length} en cartera / depositados sin acreditar. Solo al acreditarse impactan el saldo de la cuenta.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N°</th>
                <th className="px-3 py-2 text-left">Cuenta</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Beneficiario / Librador</th>
                <th className="px-3 py-2 text-left">Fecha de pago</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cheques.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Sin cheques registrados.
                  </td>
                </tr>
              )}
              {cheques.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono">{c.numero}</td>
                  <td className="px-3 py-2">{c.cuenta?.nombre}</td>
                  <td className="px-3 py-2">{c.tipo === "EMITIDO" ? "Emitido" : "Recibido"}</td>
                  <td className="px-3 py-2">{c.partner?.name ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(c.fechaPago)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{formatGs(c.monto)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${CHEQUE_ESTADO_LABEL[c.estado].style}`}>
                      {CHEQUE_ESTADO_LABEL[c.estado].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(c.estado === "PENDIENTE" || c.estado === "DEPOSITADO") && (
                      <div className="flex justify-end gap-1">
                        {c.estado === "PENDIENTE" && (
                          <button onClick={() => setChequeEstado(c.id, "DEPOSITADO")} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800 hover:bg-blue-100">
                            Depositar
                          </button>
                        )}
                        <button onClick={() => setChequeEstado(c.id, "ACREDITADO")} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100">
                          Acreditar
                        </button>
                        <button onClick={() => setChequeEstado(c.id, "RECHAZADO")} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-800 hover:bg-rose-100">
                          Rechazar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCuentaForm && (
        <CuentaForm
          projectId={project.id}
          onClose={() => setShowCuentaForm(false)}
          onSaved={() => {
            setShowCuentaForm(false);
            changed();
          }}
          showToast={showToast}
        />
      )}
      {showTransferForm && (
        <TransferForm
          cuentas={cuentas}
          onClose={() => setShowTransferForm(false)}
          onSaved={() => {
            setShowTransferForm(false);
            changed();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

const inputClass = "w-full rounded-lg border border-slate-300 px-2 py-1.5";

function CuentaForm({
  projectId,
  onClose,
  onSaved,
  showToast,
}: {
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
  showToast: BancosCajasPanelProps["showToast"];
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"BANCO" | "CAJA">("BANCO");
  const [moneda, setMoneda] = useState("PYG");
  const [banco, setBanco] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");

  const save = async () => {
    try {
      await api.createCuentaFinanciera({
        projectId,
        nombre,
        tipo,
        moneda,
        banco: banco || undefined,
        numeroCuenta: numeroCuenta || undefined,
        saldoInicial: parseFlexibleNumber(saldoInicial),
      });
      showToast("Cuenta financiera creada");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo crear la cuenta", "error");
    }
  };

  return (
    <Modal title="Nueva cuenta financiera" onClose={onClose}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Banco Itaú cta cte)" className={inputClass} />
      <div className="grid grid-cols-2 gap-2">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as "BANCO" | "CAJA")} className={inputClass}>
          <option value="BANCO">Banco</option>
          <option value="CAJA">Caja</option>
        </select>
        <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={inputClass}>
          <option value="PYG">PYG</option>
          <option value="USD">USD</option>
        </select>
      </div>
      {tipo === "BANCO" && (
        <div className="grid grid-cols-2 gap-2">
          <input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Banco" className={inputClass} />
          <input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} placeholder="N° de cuenta" className={inputClass} />
        </div>
      )}
      <input value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} placeholder="Saldo inicial (ej. 5.000.000)" className={inputClass} />
      <Actions onClose={onClose} onSave={save} disabled={nombre.trim().length < 2} />
    </Modal>
  );
}

function TransferForm({
  cuentas,
  onClose,
  onSaved,
  showToast,
}: {
  cuentas: CuentaFinanciera[];
  onClose: () => void;
  onSaved: () => void;
  showToast: BancosCajasPanelProps["showToast"];
}) {
  const [cuentaOrigenId, setCuentaOrigenId] = useState<number | "">(cuentas[0]?.id ?? "");
  const [cuentaDestinoId, setCuentaDestinoId] = useState<number | "">(cuentas[1]?.id ?? "");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [concepto, setConcepto] = useState("");
  const amount = parseFlexibleNumber(monto);

  const save = async () => {
    try {
      await api.createTransferencia({
        cuentaOrigenId: Number(cuentaOrigenId),
        cuentaDestinoId: Number(cuentaDestinoId),
        monto: amount,
        fecha,
        concepto: concepto || undefined,
      });
      showToast("Transferencia registrada");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo registrar la transferencia", "error");
    }
  };

  return (
    <Modal title="Transferencia entre cuentas" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <select value={cuentaOrigenId} onChange={(e) => setCuentaOrigenId(Number(e.target.value))} className={inputClass}>
          <option value="">Cuenta origen…</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select value={cuentaDestinoId} onChange={(e) => setCuentaDestinoId(Number(e.target.value))} className={inputClass}>
          <option value="">Cuenta destino…</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
      <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Monto" className={inputClass} />
      <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto (opcional)" className={inputClass} />
      {cuentaOrigenId && cuentaOrigenId === cuentaDestinoId && (
        <p className="text-[11px] font-semibold text-red-600">La cuenta de origen y destino no pueden ser la misma.</p>
      )}
      <Actions onClose={onClose} onSave={save} disabled={!cuentaOrigenId || !cuentaDestinoId || cuentaOrigenId === cuentaDestinoId || amount <= 0} />
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Actions({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onClose} className="rounded-lg px-3 py-1.5 font-semibold text-slate-600">
        Cancelar
      </button>
      <button onClick={onSave} disabled={disabled} className="rounded-lg bg-blue-600 px-4 py-1.5 font-bold text-white disabled:opacity-50">
        Guardar
      </button>
    </div>
  );
}
