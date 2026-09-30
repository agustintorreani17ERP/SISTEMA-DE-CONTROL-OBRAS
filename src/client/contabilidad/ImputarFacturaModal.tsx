import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Insumo, Project } from "../types";
import { Button, Modal } from "../ui";
import { formatGs, formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { BudgetItemSelect, useImputableItems } from "../components/BudgetItemSelect";
import { SearchPick } from "../partes/SearchPick";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;
const VAT_RATE: Record<string, number> = { IVA10: 0.1, IVA5: 0.05, EXENTA: 0 };
const TIPO_LABEL = { DIRECTO: "Directo", COMUN: "Común", TIEMPO: "Tiempo" } as const;

/**
 * Imputa una factura recibida sin OC ni certificado: cada renglón con insumo (e ítem si es
 * DIRECTO). Entra al libro mayor sin IVA con la fecha de la factura; lo COMÚN entra al stock.
 */
export function ImputarFacturaModal({ invoice, project, onClose, onDone, showToast }: { invoice: any; project: Project; onClose: () => void; onDone: () => void; showToast: Toast }) {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [sel, setSel] = useState<Record<number, { insumoId: number | null; budgetItemId: number | "" }>>({});
  const [saving, setSaving] = useState(false);
  const { items } = useImputableItems(project.id);
  useEffect(() => {
    api
      .getInsumos({})
      .then(setInsumos)
      .catch((e) => showToast(e.message, "error"));
  }, [showToast]);
  const opts = useMemo(() => insumos.map((i) => ({ id: i.id, code: i.code, label: i.description, sub: `${TIPO_LABEL[i.tipo]} · ${i.unit}` })), [insumos]);
  const byId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  const lines: any[] = invoice.items ?? [];

  const estado = lines.map((l) => {
    const s = sel[l.id] ?? { insumoId: null, budgetItemId: "" };
    const ins = s.insumoId ? byId.get(s.insumoId) : undefined;
    const sinIva = Math.round((Number(l.quantity) * Number(l.unitPrice)) / (1 + (VAT_RATE[l.vatType] ?? 0.1)));
    const error = !ins ? "Elegí el insumo" : ins.tipo === "DIRECTO" && !s.budgetItemId ? "DIRECTO: elegí el ítem" : null;
    return { l, s, ins, sinIva, error };
  });
  const listo = estado.length > 0 && estado.every((e) => !e.error);

  const guardar = async () => {
    setSaving(true);
    try {
      const r = await api.imputarFactura(
        invoice.id,
        estado.map((e) => ({ id: e.l.id, insumoId: e.s.insumoId!, budgetItemId: e.ins?.tipo === "COMUN" ? null : e.s.budgetItemId || null }))
      );
      showToast("Factura imputada: su costo entró al libro mayor", "success");
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
      size="lg"
      title={`Imputar factura ${invoice.numeroFactura}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={guardar} disabled={!listo || saving}>
            Imputar y registrar costo
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-900">
        <p className="text-xs text-slate-600">
          {invoice.partner?.name} · {fmtDate(String(invoice.fechaEmision).slice(0, 10))} · sin OC ni certificado. Cada renglón entra sin IVA a su ítem (DIRECTO), al stock de la obra
          (COMÚN) o a costos por tiempo (TIEMPO sin ítem).
        </p>
        {estado.map(({ l, s, ins, sinIva, error }) => (
          <div key={l.id} className="space-y-2 border border-slate-300 p-3">
            <div className="flex justify-between gap-2">
              <span>{l.description}</span>
              <span className="whitespace-nowrap tabular-nums">
                {formatQty(Number(l.quantity))} × {formatGs(Number(l.unitPrice))} · sin IVA {formatGs(sinIva)}
              </span>
            </div>
            <SearchPick options={opts} value={s.insumoId} onChange={(v) => setSel((m) => ({ ...m, [l.id]: { ...s, insumoId: v } }))} placeholder="Insumo…" />
            {ins && ins.tipo !== "COMUN" && (
              <BudgetItemSelect
                projectId={project.id}
                items={items}
                value={s.budgetItemId}
                onChange={(v) => setSel((m) => ({ ...m, [l.id]: { ...s, budgetItemId: v } }))}
                placeholder={ins.tipo === "DIRECTO" ? "Ítem (obligatorio)…" : "Ítem (opcional: sin ítem se reparte por tiempo)"}
              />
            )}
            {ins?.tipo === "COMUN" && <p className="text-xs text-slate-600">Entra al stock: {formatQty(Number(l.quantity))} {ins.unit}.</p>}
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
