import React, { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { api } from "../api";
import { Project } from "../types";
import { Button, Field, inputClass, Modal } from "../ui";

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProject: Project, initialMode: "excel" | "manual") => void;
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/**
 * Alta de obra. No pide montos: el monto contractual y el presupuesto salen del Excel que
 * se importa en el paso siguiente.
 */
export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
  currency,
  showToast,
}) => {
  const [form, setForm] = useState({
    name: "",
    code: "",
    clientName: "",
    location: "",
    contractNumber: "",
    months: "12",
    currency,
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  if (!isOpen) return null;

  const create = async () => {
    if (!form.name.trim()) return showToast("Poné el nombre de la obra", "error");
    setSaving(true);
    try {
      const project = await api.createProject({
        code: form.code.trim() || `OBR-${Date.now().toString().slice(-4)}`,
        name: form.name.trim(),
        location: form.location.trim() || "Paraguay",
        clientName: form.clientName.trim() || "Comitente",
        executionMonths: Math.max(1, Number(form.months) || 12),
        contractNumber: form.contractNumber.trim() || undefined,
        currency: form.currency as "PYG" | "USD",
      });
      onProjectCreated(project, "excel");
    } catch (err: any) {
      showToast(err.message || "No se pudo crear la obra", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nueva obra"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={create} disabled={saving || !form.name.trim()}>
            Crear y cargar presupuesto
          </Button>
        </>
      }
    >
      <Field label="Nombre de la obra">
        <input autoFocus value={form.name} onChange={set("name")} placeholder="Ej. Colegio Técnico Nacional" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Código" hint="Si lo dejás vacío se genera uno">
          <input value={form.code} onChange={set("code")} placeholder="CTN-01" className={inputClass} />
        </Field>
        <Field label="N° de contrato">
          <input value={form.contractNumber} onChange={set("contractNumber")} className={inputClass} />
        </Field>
        <Field label="Comitente">
          <input value={form.clientName} onChange={set("clientName")} placeholder="Ministerio / cliente privado" className={inputClass} />
        </Field>
        <Field label="Ubicación">
          <input value={form.location} onChange={set("location")} className={inputClass} />
        </Field>
        <Field label="Plazo (meses)">
          <input type="number" min={1} value={form.months} onChange={set("months")} className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select value={form.currency} onChange={set("currency")} className={inputClass}>
            <option value="PYG">Guaraníes (₲)</option>
            <option value="USD">Dólares (US$)</option>
          </select>
        </Field>
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
        <p>El monto del contrato se toma del presupuesto que importes a continuación.</p>
      </div>
    </Modal>
  );
};
