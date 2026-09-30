import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api";
import { InsumoTipo, MaterialRequest, Partner, Project, PurchaseOrder } from "../types";
import { Button, EmptyState, Field, inputClass, Modal } from "../ui";
import { Stepper } from "../ui/actions";
import { useImputableItems } from "../components/BudgetItemSelect";
import { ImputacionCell, itemAllowed, itemRequired } from "./ImputacionCell";
import { todayIso } from "../insumos/labels";
import { formatMoney } from "../utils/format";
import { fmtQty } from "./status";

interface OrderLine {
  requestDetailId: number;
  material: string;
  unit: string;
  requested: number;
  pending: number;
  quantity: string;
  unitPrice: string;
  budgetItemId: number | "";
  tipo?: InsumoTipo;
}

interface OrderFormProps {
  project: Project;
  requests: MaterialRequest[];
  orders: PurchaseOrder[];
  partners: Partner[];
  initialRequestId?: number | null;
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: () => void;
  onGoToRequests: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Orden de compra desde un pedido aprobado: todas sus líneas, precio y rubro por línea. */
export function OrderForm({
  project,
  requests,
  orders,
  partners,
  initialRequestId,
  currency,
  onClose,
  onSaved,
  onGoToRequests,
  showToast,
}: OrderFormProps) {
  const eligible = requests.filter((r) => r.status === "APROBADO_PARA_COMPRA");
  const [step, setStep] = useState(initialRequestId ? 1 : 0);
  const [requestId, setRequestId] = useState<number | "">(initialRequestId ?? eligible[0]?.id ?? "");
  const [suppliers, setSuppliers] = useState(partners.filter((p) => p.kind !== "SUBCONTRACTOR"));
  const [partnerId, setPartnerId] = useState<number | "">(suppliers[0]?.id ?? "");
  const [newSupplier, setNewSupplier] = useState<{ name: string; taxId: string } | null>(null);
  const [expectedDate, setExpectedDate] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [saving, setSaving] = useState(false);
  const { items: imputable } = useImputableItems(project.id);

  const request = eligible.find((r) => r.id === requestId);

  // Cantidad ya pedida en otras OC (no anuladas) por línea del pedido
  const ordered = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of orders) {
      if (o.status === "ANULADO") continue;
      for (const d of o.details ?? []) {
        const key = (d as any).requestDetailId ?? d.requestDetail?.id;
        if (key) map.set(key, (map.get(key) ?? 0) + Number(d.quantity));
      }
    }
    return map;
  }, [orders]);

  useEffect(() => {
    if (!request) return setLines([]);
    setLines(
      (request.details ?? []).map((d) => {
        const requested = Number(d.quantity);
        const pending = Math.max(0, requested - (ordered.get(d.id) ?? 0));
        return {
          requestDetailId: d.id,
          material: d.material?.description ?? `Material ${d.materialId}`,
          unit: d.material?.unit ?? "",
          requested,
          pending,
          quantity: String(pending),
          unitPrice: String(Number(d.material?.estimatedCost || 0) || ""),
          // Un insumo COMÚN va al stock: el rubro que traía el pedido no se usa.
          budgetItemId: itemAllowed(d.material?.tipo) ? d.budgetItemId ?? "" : "",
          tipo: d.material?.tipo,
        };
      })
    );
  }, [request, ordered]);

  const active = lines.filter((l) => Number(l.quantity) > 0);
  const total = active.reduce((acc, l) => acc + Number(l.quantity) * Number(l.unitPrice || 0), 0);
  const missing = active.filter((l) => !Number(l.unitPrice) || (itemRequired(l.tipo) && !l.budgetItemId)).length;
  const update = (id: number, patch: Partial<OrderLine>) => setLines((prev) => prev.map((l) => (l.requestDetailId === id ? { ...l, ...patch } : l)));

  const createSupplier = async () => {
    if (!newSupplier?.name.trim() || !newSupplier.taxId.trim()) return showToast("Poné nombre y RUC del proveedor", "error");
    try {
      const partner = await api.createPartner({ kind: "SUPPLIER", name: newSupplier.name.trim(), taxId: newSupplier.taxId.trim() });
      setSuppliers((prev) => [...prev, partner]);
      setPartnerId(partner.id);
      setNewSupplier(null);
      showToast(`Proveedor "${partner.name}" creado`);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el proveedor", "error");
    }
  };

  const save = async (approve: boolean) => {
    if (!request || !partnerId) return;
    if (!fecha) return showToast("Indicá la fecha de la orden", "error");
    if (missing) return showToast(`Falta precio o ítem (insumo DIRECTO) en ${missing} línea(s)`, "error");
    setSaving(true);
    try {
      const order = await api.createPurchaseOrder({
        materialRequestId: request.id,
        partnerId: Number(partnerId),
        fecha,
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        details: active.map((l) => ({
          requestDetailId: l.requestDetailId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          budgetItemId: l.budgetItemId && itemAllowed(l.tipo) ? Number(l.budgetItemId) : null,
        })),
      });
      if (approve) await api.approvePurchaseOrder(order.id);
      showToast(`Orden ${order.number} ${approve ? "creada y aprobada" : "guardada como borrador"}`);
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo crear la orden", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!eligible.length) {
    return (
      <Modal title="Nueva orden de compra" onClose={onClose}>
        <EmptyState
          title="No hay pedidos aprobados para comprar"
          help="La orden de compra sale de un pedido aprobado. Creá o aprobá un pedido primero."
          action={
            <Button variant="primary" onClick={onGoToRequests}>
              Ir a Pedidos
            </Button>
          }
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="Nueva orden de compra"
      size="lg"
      onClose={onClose}
      footer={
        step === 0 ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={() => setStep(1)} disabled={!request}>
              Siguiente
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep(0)}>Atrás</Button>
            <Button onClick={() => save(false)} disabled={saving || !active.length || !partnerId || missing > 0}>
              Guardar borrador
            </Button>
            <Button variant="primary" onClick={() => save(true)} disabled={saving || !active.length || !partnerId || missing > 0}>
              Crear y aprobar
            </Button>
          </>
        )
      }
    >
      <Stepper steps={["Pedido", "Líneas y proveedor"]} current={step} />

      {step === 0 && (
        <div className="space-y-2">
          {eligible.map((r) => (
            <label
              key={r.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${requestId === r.id ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}
            >
              <input type="radio" checked={requestId === r.id} onChange={() => setRequestId(r.id)} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {r.number}
                  {r.workFront ? ` · ${r.workFront.name}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {(r.details ?? []).map((d) => d.material?.description).filter(Boolean).slice(0, 3).join(", ")}
                  {(r.details?.length ?? 0) > 3 ? ` y ${(r.details?.length ?? 0) - 3} más` : ""}
                </p>
              </div>
              <span className="text-xs text-slate-400">{r.details?.length ?? 0} línea(s)</span>
            </label>
          ))}
        </div>
      )}

      {step === 1 && request && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proveedor">
              {newSupplier === null ? (
                <div className="flex gap-2">
                  <select value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
                    <option value="">{suppliers.length ? "Elegí un proveedor…" : "No hay proveedores: creá uno"}</option>
                    {suppliers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.taxId}
                      </option>
                    ))}
                  </select>
                  <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewSupplier({ name: "", taxId: "" })} title="Nuevo proveedor" />
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    placeholder="Razón social"
                    className={inputClass}
                  />
                  <input
                    value={newSupplier.taxId}
                    onChange={(e) => setNewSupplier({ ...newSupplier, taxId: e.target.value })}
                    placeholder="RUC"
                    className={`${inputClass} w-32`}
                  />
                  <Button variant="primary" onClick={createSupplier}>
                    Crear
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Fecha de la orden">
              <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Entrega estimada">
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2 text-right">Pendiente</th>
                  <th className="w-24 px-3 py-2">Cantidad</th>
                  <th className="w-32 px-3 py-2">P. unitario</th>
                  <th className="w-56 px-3 py-2">Imputación</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.requestDetailId} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{l.material}</p>
                      <p className="text-xs text-slate-400">
                        Pedido {fmtQty(l.requested)} {l.unit}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtQty(l.pending)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={l.pending}
                        step="any"
                        value={l.quantity}
                        onChange={(e) => update(l.requestDetailId, { quantity: e.target.value })}
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.unitPrice}
                        onChange={(e) => update(l.requestDetailId, { unitPrice: e.target.value })}
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <ImputacionCell
                        tipo={l.tipo}
                        projectId={project.id}
                        items={imputable}
                        value={l.budgetItemId}
                        onChange={(v) => update(l.requestDetailId, { budgetItemId: v })}
                        currency={currency}
                        showError={Number(l.quantity) > 0}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(l.quantity) * Number(l.unitPrice || 0), currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={5} className="px-3 py-2 text-right font-medium">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(total, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {missing > 0 && <p className="text-xs font-semibold text-red-600">Falta precio o ítem (insumo DIRECTO) en {missing} línea(s).</p>}
          <p className="text-xs text-slate-500">
            Al emitir: los DIRECTOS se descuentan de su ítem; los COMUNES van a "Costos a distribuir › stock de obra"; los de TIEMPO sin ítem, a
            "Costos a distribuir › tiempo".
          </p>
        </>
      )}
    </Modal>
  );
}
