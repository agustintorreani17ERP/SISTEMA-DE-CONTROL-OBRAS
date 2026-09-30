import React, { useMemo, useState } from "react";
import { Ban, Eye, Plus, Printer, ShoppingCart, Trash2 } from "lucide-react";
import { api } from "../api";
import { Project, PurchaseOrder } from "../types";
import { Badge, Button, Card, Drawer, EmptyState, Field, Modal, inputClass } from "../ui";
import { todayIso } from "../insumos/labels";
import { ActionBar, MoreMenu, Timeline } from "../ui/actions";
import { formatMoney } from "../utils/format";
import { PrintableDocument } from "./PrintableDocument";
import { DocStatus, fmtDate, fmtQty, ORDER_STATUS } from "./status";

type Filter = "ALL" | DocStatus;

interface OrdersViewProps {
  project: Project;
  orders: PurchaseOrder[];
  currency: "PYG" | "USD";
  onNew: () => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function OrdersView({ project, orders, currency, onNew, onRefresh, showToast }: OrdersViewProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [printing, setPrinting] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receipt, setReceipt] = useState({ fecha: todayIso(), remito: "" });
  const money = (v: unknown) => formatMoney(Number(v || 0), currency);

  const count = (s: DocStatus) => orders.filter((o) => o.status === s).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (filter === "ALL" || o.status === filter) &&
        (!q || `${o.number} ${o.partner?.name ?? ""} ${o.materialRequest?.number ?? ""}`.toLowerCase().includes(q))
    );
  }, [orders, filter, search]);

  const run = async (id: number, fn: () => Promise<any>, msg: string) => {
    setBusy(id);
    try {
      const res = await fn();
      showToast(msg);
      res?.budgetWarnings?.forEach((w: { message: string }) => showToast(`Sobrecosto: ${w.message}`, "info"));
      onRefresh();
      setDetail(null);
    } catch (err: any) {
      showToast(err.message || "No se pudo completar la acción", "error");
    } finally {
      setBusy(null);
    }
  };

  /** Siguiente paso lógico según el estado: Aprobar → Emitir → Recibir. */
  const nextAction = (o: PurchaseOrder) => {
    const step: Partial<Record<DocStatus, { label: string; fn: () => Promise<unknown>; msg: string }>> = {
      BORRADOR: { label: "Aprobar", fn: () => api.approvePurchaseOrder(o.id), msg: `${o.number} aprobada` },
      APROBADO_PARA_COMPRA: { label: "Emitir", fn: () => api.issuePurchaseOrder(o.id), msg: `${o.number} emitida y descontada del presupuesto` },
    };
    if (o.status === "EMITIDA") {
      return (
        <Button
          size="sm"
          variant="primary"
          disabled={busy === o.id}
          onClick={() => {
            setReceipt({ fecha: todayIso(), remito: "" });
            setReceiving(o);
          }}
        >
          Recibir
        </Button>
      );
    }
    const s = step[o.status];
    return s ? (
      <Button size="sm" variant="primary" disabled={busy === o.id} onClick={() => run(o.id, s.fn, s.msg)}>
        {s.label}
      </Button>
    ) : null;
  };

  const secondary = (o: PurchaseOrder) => [
    { label: "Ver detalle", icon: <Eye className="h-4 w-4" />, onClick: () => setDetail(o) },
    { label: "Imprimir", icon: <Printer className="h-4 w-4" />, onClick: () => setPrinting(o) },
    ...(o.status !== "RECIBIDO" && o.status !== "ANULADO"
      ? [
          {
            label: "Anular",
            icon: <Ban className="h-4 w-4" />,
            danger: true,
            onClick: () =>
              window.confirm(`¿Anular la orden ${o.number}? Si estaba emitida se libera el presupuesto.`) &&
              run(o.id, () => api.cancelPurchaseOrder(o.id), `${o.number} anulada`),
          },
        ]
      : []),
    ...(o.status === "BORRADOR"
      ? [
          {
            label: "Eliminar",
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            onClick: () => window.confirm(`¿Eliminar la orden ${o.number}?`) && run(o.id, () => api.deletePurchaseOrder(o.id), `${o.number} eliminada`),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <ActionBar
        chips={[
          { value: "ALL", label: "Todas", count: orders.length },
          { value: "BORRADOR", label: "Por aprobar", count: count("BORRADOR") },
          { value: "APROBADO_PARA_COMPRA", label: "Por emitir", count: count("APROBADO_PARA_COMPRA") },
          { value: "EMITIDA", label: "Por recibir", count: count("EMITIDA") },
          { value: "RECIBIDO", label: "Recibidas", count: count("RECIBIDO") },
          { value: "ANULADO", label: "Anuladas", count: count("ANULADO") },
        ]}
        chip={filter}
        onChip={setFilter}
        search={search}
        onSearch={setSearch}
        primary={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew}>
            Nueva OC
          </Button>
        }
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-10 w-10" />}
          title="Todavía no hay órdenes de compra"
          help="Se crean a partir de un pedido aprobado. Al emitirlas se descuentan del rubro elegido."
          action={
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew}>
              Nueva OC
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">Orden</th>
                  <th className="px-3 py-3">Proveedor</th>
                  <th className="px-3 py-3">Pedido</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const st = ORDER_STATUS[o.status];
                  return (
                    <tr key={o.id} onClick={() => setDetail(o)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{o.number}</p>
                        <p className="text-xs text-slate-500">{fmtDate(o.issueDate ?? o.createdAt)}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{o.partner?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-500">{o.materialRequest?.number ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{money(o.totalAmount)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {nextAction(o)}
                          <MoreMenu items={secondary(o)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No hay órdenes con ese filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detail && (
        <Drawer title={`Orden ${detail.number}`} onClose={() => setDetail(null)}>
          <div className="flex items-center justify-between">
            <Badge tone={ORDER_STATUS[detail.status].tone}>{ORDER_STATUS[detail.status].label}</Badge>
            {nextAction(detail)}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Proveedor</dt>
              <dd>{detail.partner?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Pedido</dt>
              <dd>{detail.materialRequest?.number ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Fecha de la orden</dt>
              <dd>{fmtDate(detail.fecha)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Entrega estimada</dt>
              <dd>{fmtDate(detail.expectedDate)}</dd>
            </div>
            {detail.receivedDate && (
              <div>
                <dt className="text-xs text-slate-500">Recibida</dt>
                <dd>
                  {fmtDate(detail.receivedDate)}
                  {detail.receiptNumber ? ` · remito ${detail.receiptNumber}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">Total</dt>
              <dd className="font-semibold">{money(detail.totalAmount)}</dd>
            </div>
          </dl>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {(detail.details ?? []).map((d) => (
              <div key={d.id} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
                <div>
                  <p className="text-slate-800">{d.material?.description}</p>
                  <p className="text-xs text-slate-500">
                    {fmtQty(d.quantity)} {d.material?.unit} × {money(d.unitPrice)} ·{" "}
                    {d.budgetItem ? `${d.budgetItem.code} ${d.budgetItem.name}` : d.tipo === "TIEMPO" ? "Tiempo: a distribuir" : "Stock de obra"}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{money(d.subtotal)}</span>
              </div>
            ))}
          </div>
          <Timeline
            steps={[
              { label: "Creada", done: true, date: detail.createdAt },
              { label: "Aprobada", done: detail.status !== "BORRADOR" && detail.status !== "ANULADO" },
              { label: "Emitida al proveedor (descuenta presupuesto)", done: detail.status === "EMITIDA" || detail.status === "RECIBIDO", date: detail.issueDate },
              { label: "Recibida", done: detail.status === "RECIBIDO", date: detail.receivedDate },
            ]}
          />
          <div className="flex gap-2">
            {secondary(detail)
              .filter((a) => a.label !== "Ver detalle")
              .map((a) => (
                <Button key={a.label} size="sm" variant={a.danger ? "ghost" : "secondary"} icon={a.icon} onClick={a.onClick}>
                  {a.label}
                </Button>
              ))}
          </div>
        </Drawer>
      )}

      {receiving && (
        <Modal
          size="sm"
          title={`Recibir ${receiving.number}`}
          onClose={() => setReceiving(null)}
          footer={
            <>
              <Button onClick={() => setReceiving(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={!receipt.fecha || busy === receiving.id}
                onClick={() => {
                  const o = receiving;
                  setReceiving(null);
                  run(o.id, () => api.receivePurchaseOrder(o.id, { fecha: receipt.fecha, remito: receipt.remito.trim() || undefined }), `${o.number} recibida`);
                }}
              >
                Registrar recepción
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de recepción">
              <input type="date" required value={receipt.fecha} max={todayIso()} onChange={(e) => setReceipt({ ...receipt, fecha: e.target.value })} className={inputClass} />
            </Field>
            <Field label="N° de remito (opcional)">
              <input value={receipt.remito} onChange={(e) => setReceipt({ ...receipt, remito: e.target.value })} className={inputClass} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Los insumos COMUNES entran al stock de la obra. Los DIRECTOS entran y salen en el acto a su ítem. Los de TIEMPO no pasan por el depósito.
          </p>
        </Modal>
      )}

      {printing && (
        <PrintableDocument
          title="Orden de compra"
          number={printing.number}
          onClose={() => setPrinting(null)}
          meta={[
            { label: "Obra", value: `${project.code} · ${project.name}` },
            { label: "Proveedor", value: `${printing.partner?.name ?? "—"}${printing.partner?.taxId ? ` (RUC ${printing.partner.taxId})` : ""}` },
            { label: "Pedido", value: printing.materialRequest?.number ?? "—" },
            { label: "Fecha", value: fmtDate(printing.fecha) },
            { label: "Entrega", value: fmtDate(printing.expectedDate) },
          ]}
          lines={(printing.details ?? []).map((d) => ({
            code: d.material?.code,
            description: d.material?.description ?? "",
            unit: d.material?.unit,
            quantity: fmtQty(d.quantity),
            unitPrice: money(d.unitPrice),
            subtotal: money(d.subtotal),
            budget: d.budgetItem ? `${d.budgetItem.code} ${d.budgetItem.name}` : undefined,
          }))}
          total={money(printing.totalAmount)}
          signatures={["Compras", "Aprobó", "Proveedor"]}
        />
      )}
    </div>
  );
}
