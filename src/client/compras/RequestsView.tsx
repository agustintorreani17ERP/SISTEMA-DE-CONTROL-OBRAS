import React, { useMemo, useState } from "react";
import { ClipboardList, Eye, Plus, Printer, Trash2 } from "lucide-react";
import { api } from "../api";
import { MaterialRequest, Project } from "../types";
import { Button, Card, Drawer, EmptyState, StatusPill } from "../ui";
import { ActionBar, MoreMenu, Timeline } from "../ui/actions";
import { PrintableDocument } from "./PrintableDocument";
import { fmtDate, fmtQty, pedidoEtapa, REQUEST_STATUS } from "./status";

type Filter = "ALL" | "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO";

interface RequestsViewProps {
  project: Project;
  requests: MaterialRequest[];
  /** Vista "todas las obras": agrega la columna Obra. */
  showProject?: boolean;
  onNew: () => void;
  onCreateOrder: (request: MaterialRequest) => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function RequestsView({ project, requests, showProject, onNew, onCreateOrder, onRefresh, showToast }: RequestsViewProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<MaterialRequest | null>(null);
  const [printing, setPrinting] = useState<MaterialRequest | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const count = (s: Filter) => requests.filter((r) => r.status === s).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(
      (r) =>
        (filter === "ALL" || r.status === filter) &&
        (!q ||
          `${r.number} ${r.project?.name ?? ""} ${r.workFront?.name ?? ""} ${(r.details ?? []).map((d) => d.material?.description).join(" ")}`
            .toLowerCase()
            .includes(q))
    );
  }, [requests, filter, search]);

  const run = async (id: number, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    try {
      await fn();
      showToast(msg);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "No se pudo completar la acción", "error");
    } finally {
      setBusy(null);
    }
  };

  const nextAction = (r: MaterialRequest) => {
    if (r.status === "BORRADOR")
      return (
        <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => run(r.id, () => api.approveMaterialRequest(r.id), `Pedido ${r.number} aprobado`)}>
          Aprobar
        </Button>
      );
    // La OC se arma dentro de la obra seleccionada
    if (r.status === "APROBADO_PARA_COMPRA" && r.projectId === project.id)
      return (
        <Button size="sm" variant="primary" onClick={() => onCreateOrder(r)}>
          Crear OC
        </Button>
      );
    return null;
  };

  return (
    <div className="space-y-4">
      <ActionBar
        chips={[
          { value: "ALL", label: "Todos", count: requests.length },
          { value: "BORRADOR", label: "Borrador", count: count("BORRADOR"), tone: REQUEST_STATUS.BORRADOR.tone },
          { value: "APROBADO_PARA_COMPRA", label: "Por comprar", count: count("APROBADO_PARA_COMPRA"), tone: REQUEST_STATUS.APROBADO_PARA_COMPRA.tone },
          { value: "EMITIDA", label: "Con OC", count: count("EMITIDA"), tone: REQUEST_STATUS.EMITIDA.tone },
          { value: "RECIBIDO", label: "Recibidos", count: count("RECIBIDO"), tone: REQUEST_STATUS.RECIBIDO.tone },
        ]}
        chip={filter}
        onChip={setFilter}
        search={search}
        onSearch={setSearch}
        primary={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew}>
            Nuevo pedido
          </Button>
        }
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title="Todavía no hay pedidos"
          help="El pedido es lo que obra necesita. Después se aprueba y se convierte en orden de compra."
          action={
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew}>
              Nuevo pedido
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">Pedido</th>
                  {showProject && <th className="px-3 py-3">Obra</th>}
                  <th className="px-3 py-3">Frente</th>
                  <th className="px-3 py-3">Materiales</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const st = pedidoEtapa(r);
                  const first = r.details?.[0];
                  return (
                    <tr key={r.id} onClick={() => setDetail(r)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{r.number}</p>
                        <p className="text-xs text-slate-500">{fmtDate(r.requestedDate ?? r.createdAt)}</p>
                      </td>
                      {showProject && <td className="px-3 py-3 text-slate-700">{r.project?.name ?? "—"}</td>}
                      <td className="px-3 py-3 text-slate-600">{r.workFront?.name ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3 text-slate-700">
                        {first ? `${first.material?.description ?? "Material"} · ${fmtQty(first.quantity)} ${first.material?.unit ?? ""}` : "—"}
                        {(r.details?.length ?? 0) > 1 && <span className="text-slate-400"> +{(r.details?.length ?? 0) - 1}</span>}
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {nextAction(r)}
                          <MoreMenu
                            items={[
                              { label: "Ver detalle", icon: <Eye className="h-4 w-4" />, onClick: () => setDetail(r) },
                              { label: "Imprimir", icon: <Printer className="h-4 w-4" />, onClick: () => setPrinting(r) },
                              ...(r.status === "BORRADOR"
                                ? [
                                    {
                                      label: "Eliminar",
                                      icon: <Trash2 className="h-4 w-4" />,
                                      danger: true,
                                      onClick: () =>
                                        window.confirm(`¿Eliminar el pedido ${r.number}?`) &&
                                        run(r.id, () => api.deleteMaterialRequest(r.id), `Pedido ${r.number} eliminado`),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={showProject ? 6 : 5} className="px-5 py-8 text-center text-slate-400">
                      No hay pedidos con ese filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detail && (
        <Drawer title={`Pedido ${detail.number}`} onClose={() => setDetail(null)}>
          <div className="flex items-center justify-between">
            <StatusPill tone={pedidoEtapa(detail).tone}>{pedidoEtapa(detail).label}</StatusPill>
            {nextAction(detail)}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Frente</dt>
              <dd>{detail.workFront?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Solicitado por</dt>
              <dd>{detail.requestedBy?.fullName ?? "—"}</dd>
            </div>
          </dl>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {(detail.details ?? []).map((d) => (
              <div key={d.id} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
                <div>
                  <p className="text-slate-800">{d.material?.description}</p>
                  <p className="text-xs text-slate-500">{d.budgetItem ? `${d.budgetItem.code} · ${d.budgetItem.name}` : "Sin rubro asignado"}</p>
                </div>
                <span className="shrink-0 tabular-nums">
                  {fmtQty(d.quantity)} {d.material?.unit}
                </span>
              </div>
            ))}
          </div>
          {detail.notes && <p className="text-sm text-slate-600">{detail.notes}</p>}
          <Timeline
            steps={[
              { label: "Creado", done: true, date: detail.createdAt },
              { label: "Aprobado", done: detail.status !== "BORRADOR" && detail.status !== "ANULADO" },
              { label: "Orden de compra emitida", done: detail.status === "EMITIDA" || detail.status === "RECIBIDO" },
              { label: "Recibido en obra", done: detail.status === "RECIBIDO" },
            ]}
          />
          {(detail.purchaseOrders?.length ?? 0) > 0 && (
            <p className="text-sm text-slate-600">Órdenes: {detail.purchaseOrders!.map((o) => o.number).join(", ")}</p>
          )}
        </Drawer>
      )}

      {printing && (
        <PrintableDocument
          title="Pedido de materiales"
          number={printing.number}
          onClose={() => setPrinting(null)}
          meta={[
            { label: "Obra", value: `${(printing.project ?? project).code} · ${(printing.project ?? project).name}` },
            { label: "Frente", value: printing.workFront?.name ?? "—" },
            { label: "Fecha", value: fmtDate(printing.requestedDate ?? printing.createdAt) },
            { label: "Solicitado por", value: printing.requestedBy?.fullName ?? "—" },
          ]}
          lines={(printing.details ?? []).map((d) => ({
            code: d.material?.code,
            description: d.material?.description ?? "",
            unit: d.material?.unit,
            quantity: fmtQty(d.quantity),
            budget: d.budgetItem ? `${d.budgetItem.code} ${d.budgetItem.name}` : undefined,
          }))}
          signatures={["Solicitó", "Aprobó", "Compras"]}
        />
      )}
    </div>
  );
}
