import React, { useCallback, useEffect, useState } from "react";
import { Banknote, CheckCircle2, Plus, XCircle } from "lucide-react";
import { api } from "../api";
import { PettyCashFund, Project } from "../types";
import { formatDate, formatMoney, parseFlexibleNumber } from "../utils/format";
import { BudgetItemSelect, useImputableItems } from "./BudgetItemSelect";

interface PettyCashPanelProps {
  project?: Project | null;
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onChanged?: () => void;
}

const STATUS_LABEL = {
  PENDIENTE_RENDICION: { label: "Pendiente de rendición", style: "bg-amber-50 text-amber-800 border-amber-200" },
  RENDIDO: { label: "Rendido", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  RECHAZADO: { label: "Rechazado", style: "bg-rose-50 text-rose-800 border-rose-200" },
} as const;

/**
 * Caja chica (fondo fijo) de obra. Cada comprobante se imputa a una partida del presupuesto
 * (o a Gastos Generales) y descuenta del Centro de Costos al registrarse.
 */
export const PettyCashPanel: React.FC<PettyCashPanelProps> = ({ project, currency, showToast, onChanged }) => {
  const [funds, setFunds] = useState<PettyCashFund[]>([]);
  const [fundId, setFundId] = useState<number | null>(null);
  const [showFundForm, setShowFundForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const { items, reload: reloadItems } = useImputableItems(project?.id);

  const load = useCallback(async () => {
    if (!project?.id) return;
    try {
      const data = await api.getPettyCash(project.id);
      setFunds(data);
      setFundId((prev) => (prev && data.some((f) => f.id === prev) ? prev : data[0]?.id ?? null));
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar la caja chica", "error");
    }
  }, [project?.id, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const fund = funds.find((f) => f.id === fundId) ?? null;
  const changed = () => {
    load();
    reloadItems();
    onChanged?.();
  };

  const settle = async () => {
    if (!fund) return;
    if (!window.confirm(`¿Cerrar la rendición? ${fund.expenses.filter((e) => e.status === "PENDIENTE_RENDICION").length} comprobante(s) quedan rendidos y el fondo se repone.`)) return;
    try {
      const res = await api.settlePettyCashFund(fund.id);
      showToast(`Rendición cerrada: ${res.settled} comprobante(s)`);
      changed();
    } catch (err: any) {
      showToast(err.message || "No se pudo cerrar la rendición", "error");
    }
  };

  const reject = async (id: number) => {
    const reason = window.prompt("Motivo del rechazo (se revierte el descuento del presupuesto):");
    if (!reason) return;
    try {
      await api.rejectPettyCashExpense(id, reason);
      showToast("Comprobante rechazado y descuento revertido");
      changed();
    } catch (err: any) {
      showToast(err.message || "No se pudo rechazar", "error");
    }
  };

  if (!project) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs md:flex-row md:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">Caja chica</h3>
            {funds.length > 1 && (
              <select value={fundId ?? ""} onChange={(e) => setFundId(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-0.5 text-xs">
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {fund ? (
            <p className="text-xs text-slate-500">
              {fund.name} · Responsable: <strong>{fund.responsibleName}</strong> · Asignado {formatMoney(fund.assignedAmount, currency)} ·
              Disponible <strong className="font-mono">{formatMoney(fund.currentBalance, currency)}</strong>
            </p>
          ) : (
            <p className="text-xs text-slate-500">La obra no tiene un fondo de caja chica. Creá uno para registrar gastos menores.</p>
          )}
        </div>
        <div className="flex gap-2 text-xs font-bold">
          <button onClick={() => setShowFundForm(true)} className="rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50">
            Nuevo fondo
          </button>
          {fund && (
            <>
              <button onClick={() => setShowExpenseForm(true)} className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> Registrar gasto
              </button>
              <button
                onClick={settle}
                disabled={!fund.expenses.some((e) => e.status === "PENDIENTE_RENDICION")}
                className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 disabled:opacity-40"
              >
                <CheckCircle2 className="h-4 w-4" /> Cerrar rendición
              </button>
            </>
          )}
        </div>
      </div>

      {fund && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Comprobante</th>
                <th className="px-3 py-2 text-left">Proveedor / Concepto</th>
                <th className="px-3 py-2 text-left">Imputado a</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fund.expenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Sin gastos registrados.
                  </td>
                </tr>
              )}
              {fund.expenses.map((e) => (
                <tr key={e.id} className={e.status === "RECHAZADO" ? "opacity-60" : ""}>
                  <td className="px-3 py-2">{formatDate(e.date)}</td>
                  <td className="px-3 py-2 font-mono">{e.receiptNumber}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{e.supplierName}</p>
                    <p className="text-slate-500">{e.concept}</p>
                  </td>
                  <td className="px-3 py-2">{e.budgetItem ? `${e.budgetItem.code} · ${e.budgetItem.name}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{formatMoney(e.amount, currency)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${STATUS_LABEL[e.status].style}`} title={e.rejectionReason ?? undefined}>
                      {STATUS_LABEL[e.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {e.status !== "RECHAZADO" && (
                      <button onClick={() => reject(e.id)} className="text-slate-400 hover:text-rose-600" title="Rechazar y revertir">
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showFundForm && (
        <FundForm
          projectId={project.id}
          onClose={() => setShowFundForm(false)}
          onSaved={() => {
            setShowFundForm(false);
            changed();
          }}
          showToast={showToast}
        />
      )}
      {showExpenseForm && fund && (
        <ExpenseForm
          fund={fund}
          projectId={project.id}
          currency={currency}
          items={items}
          onClose={() => setShowExpenseForm(false)}
          onSaved={() => {
            setShowExpenseForm(false);
            changed();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

const inputClass = "w-full rounded-lg border border-slate-300 px-2 py-1.5";

function FundForm({
  projectId,
  onClose,
  onSaved,
  showToast,
}: {
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
  showToast: PettyCashPanelProps["showToast"];
}) {
  const [name, setName] = useState("Fondo fijo de obra");
  const [responsibleName, setResponsibleName] = useState("");
  const [assigned, setAssigned] = useState("");
  const save = async () => {
    try {
      await api.createPettyCashFund({ projectId, name, responsibleName, assignedAmount: parseFlexibleNumber(assigned) });
      showToast("Fondo creado");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el fondo", "error");
    }
  };
  return (
    <Modal title="Nuevo fondo de caja chica" onClose={onClose}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del fondo" className={inputClass} />
      <input value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} placeholder="Responsable" className={inputClass} />
      <input value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Monto asignado (ej. 5.000.000)" className={inputClass} />
      <Actions onClose={onClose} onSave={save} disabled={!responsibleName.trim() || parseFlexibleNumber(assigned) <= 0} />
    </Modal>
  );
}

function ExpenseForm({
  fund,
  projectId,
  currency,
  items,
  onClose,
  onSaved,
  showToast,
}: {
  fund: PettyCashFund;
  projectId: number;
  currency: "PYG" | "USD";
  items: ReturnType<typeof useImputableItems>["items"];
  onClose: () => void;
  onSaved: () => void;
  showToast: PettyCashPanelProps["showToast"];
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    receiptNumber: "",
    supplierName: "",
    concept: "",
    amount: "",
    responsibleName: fund.responsibleName,
  });
  const [budgetItemId, setBudgetItemId] = useState<number | "">("");
  const amount = parseFlexibleNumber(form.amount);

  const save = async () => {
    if (!budgetItemId) return;
    try {
      const res = await api.createPettyCashExpense({ fundId: fund.id, budgetItemId, ...form, amount });
      res.budgetWarnings.forEach((w) => showToast(w.message, "info"));
      showToast("Gasto registrado y descontado del presupuesto");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo registrar el gasto", "error");
    }
  };

  return (
    <Modal title="Registrar gasto de caja chica" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
        <input value={form.receiptNumber} onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })} placeholder="N° de comprobante" className={inputClass} />
      </div>
      <input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} placeholder="Proveedor" className={inputClass} />
      <input value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} placeholder="Concepto" className={inputClass} />
      <div>
        <p className="mb-1 font-semibold text-slate-700">Rubro al que se imputa</p>
        <BudgetItemSelect projectId={projectId} items={items} value={budgetItemId} onChange={setBudgetItemId} currency={currency} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Monto" className={inputClass} />
        <input value={form.responsibleName} onChange={(e) => setForm({ ...form, responsibleName: e.target.value })} placeholder="Quién gastó" className={inputClass} />
      </div>
      {amount > fund.currentBalance && (
        <p className="text-[11px] font-semibold text-amber-700">El monto supera el disponible del fondo ({formatMoney(fund.currentBalance, currency)}).</p>
      )}
      <Actions
        onClose={onClose}
        onSave={save}
        disabled={!budgetItemId || amount <= 0 || !form.receiptNumber.trim() || !form.supplierName.trim() || form.concept.trim().length < 2}
      />
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
