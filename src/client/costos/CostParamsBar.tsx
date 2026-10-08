import React, { useEffect, useState } from "react";
import { api } from "../api";
import { ControlMedicionSub } from "../types";
import { Button, cx } from "../ui";
import { NumCell } from "../components/certifications/sheetGrid";

const CONTROL_LABEL: Record<ControlMedicionSub, string> = { AVISAR: "Avisar", BLOQUEAR: "Bloquear", NO_CONTROLAR: "No controlar" };

/**
 * K de pase (con IVA) e IVA incluido en los PU de la obra (costo de oferta y venta sin IVA), y qué
 * hacer cuando los subcontratistas certifican más que la medición oficial.
 */
export const CostParamsBar: React.FC<{
  projectId: number;
  coeficienteK: number | null;
  ivaPct: number;
  controlMedicionSub: ControlMedicionSub;
  onSaved: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}> = ({ projectId, coeficienteK, ivaPct, controlMedicionSub, onSaved, showToast }) => {
  const [k, setK] = useState(coeficienteK ?? 0);
  const [iva, setIva] = useState(ivaPct);
  const [control, setControl] = useState(controlMedicionSub);
  const [saving, setSaving] = useState(false);
  useEffect(() => setK(coeficienteK ?? 0), [coeficienteK]);
  useEffect(() => setIva(ivaPct), [ivaPct]);
  useEffect(() => setControl(controlMedicionSub), [controlMedicionSub]);

  const dirty = k !== (coeficienteK ?? 0) || iva !== ivaPct || control !== controlMedicionSub;
  const save = async () => {
    if (k !== 0 && (k < 0.5 || k > 5)) {
      showToast("K fuera de rango: suele estar entre 1 y 2 (ej. 1,3454)", "error");
      return;
    }
    setSaving(true);
    try {
      await api.saveCostParams(projectId, { coeficienteK: k > 0 ? k : null, ivaPct: iva, controlMedicionSub: control });
      showToast("Parámetros de costo guardados", "success");
      onSaved();
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const box = "w-24 border border-slate-300 bg-white px-2 py-1 text-right tabular-nums text-slate-900 focus:outline-2 focus:outline-slate-900";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-slate-300 px-3 py-2 text-sm text-slate-900">
      <label className="flex items-center gap-2">
        <span className="font-semibold">K de la obra</span>
        <NumCell className={cx(box, !coeficienteK && "border-red-600")} value={k} onValue={setK} placeholder="1,3454" />
      </label>
      <label className="flex items-center gap-2">
        <span>IVA en los PU</span>
        <NumCell className={box} value={iva} onValue={setIva} />
        <span>%</span>
      </label>
      <span className="text-xs text-slate-500">Costo de la oferta = PU ÷ K · Venta sin IVA = PU ÷ (1 + IVA) · Ítems sin ACU: costo meta = PU ÷ K</span>
      {!coeficienteK && <span className="text-xs font-semibold text-red-600">Sin K: los ítems sin ACU no tienen costo meta.</span>}
      <label className="flex basis-full items-center gap-2">
        <span>Control de medición de subcontratistas</span>
        <select
          className="border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:outline-2 focus:outline-slate-900"
          value={control}
          onChange={(e) => setControl(e.target.value as ControlMedicionSub)}
        >
          {(Object.keys(CONTROL_LABEL) as ControlMedicionSub[]).map((m) => (
            <option key={m} value={m}>
              {CONTROL_LABEL[m]}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">Si certifican más que la medición oficial acumulada (lo pendiente de certificar al cliente)</span>
      </label>
      <Button size="sm" variant="primary" className="ml-auto" onClick={save} disabled={!dirty || saving}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
};
