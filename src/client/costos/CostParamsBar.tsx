import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Button, cx } from "../ui";
import { NumCell } from "../components/certifications/sheetGrid";

/** K de pase (con IVA) e IVA incluido en los PU de la obra. Definen costo de oferta y venta sin IVA. */
export const CostParamsBar: React.FC<{
  projectId: number;
  coeficienteK: number | null;
  ivaPct: number;
  onSaved: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}> = ({ projectId, coeficienteK, ivaPct, onSaved, showToast }) => {
  const [k, setK] = useState(coeficienteK ?? 0);
  const [iva, setIva] = useState(ivaPct);
  const [saving, setSaving] = useState(false);
  useEffect(() => setK(coeficienteK ?? 0), [coeficienteK]);
  useEffect(() => setIva(ivaPct), [ivaPct]);

  const dirty = k !== (coeficienteK ?? 0) || iva !== ivaPct;
  const save = async () => {
    if (k !== 0 && (k < 0.5 || k > 5)) {
      showToast("K fuera de rango: suele estar entre 1 y 2 (ej. 1,3454)", "error");
      return;
    }
    setSaving(true);
    try {
      await api.saveCostParams(projectId, { coeficienteK: k > 0 ? k : null, ivaPct: iva });
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
      <Button size="sm" variant="primary" className="ml-auto" onClick={save} disabled={!dirty || saving}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
};
