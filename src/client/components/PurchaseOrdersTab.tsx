import React, { useState } from "react";
import {
  Receipt,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Package,
  XCircle,
  Eye,
  Building2,
  Printer,
  Calendar,
  AlertTriangle,
  ArrowRight,
  Truck,
  Check,
  X,
} from "lucide-react";
import {
  PurchaseOrder,
  MaterialRequest,
  Partner,
  Project,
} from "../types";
import { formatMoney, formatDate, formatDateTime } from "../utils/format";
import { getStatusBadge } from "../utils/statusBadges";
import { api } from "../api";

interface PurchaseOrdersTabProps {
  project?: Project | null;
  purchaseOrders: PurchaseOrder[];
  materialRequests: MaterialRequest[];
  partners: Partner[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  selectedRequestForNewPO?: MaterialRequest | null;
  onClearSelectedRequestForPO: () => void;
}

export const PurchaseOrdersTab: React.FC<PurchaseOrdersTabProps> = ({
  project,
  purchaseOrders,
  materialRequests,
  partners,
  currency,
  onRefresh,
  showToast,
  selectedRequestForNewPO,
  onClearSelectedRequestForPO,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [partnerFilter, setPartnerFilter] = useState<string>("ALL");
  const [showNewModal, setShowNewModal] = useState(Boolean(selectedRequestForNewPO));
  const [inspectOrder, setInspectOrder] = useState<PurchaseOrder | null>(null);
  const [printOrder, setPrintOrder] = useState<PurchaseOrder | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Eligible requests for new PO
  const eligibleRequests = materialRequests.filter(
    (r) => r.status === "APROBADO_PARA_COMPRA" || r.id === selectedRequestForNewPO?.id
  );

  // Form state
  const [selectedRequestId, setSelectedRequestId] = useState<number>(
    selectedRequestForNewPO?.id || eligibleRequests[0]?.id || 1
  );
  const [partnerId, setPartnerId] = useState<number>(partners[0]?.id || 1);
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<number>(150000);

  // Active target request
  const currentReq = eligibleRequests.find((r) => r.id === selectedRequestId) || selectedRequestForNewPO;
  const currentDetail = currentReq?.details?.[0];

  const filteredOrders = purchaseOrders.filter((po) => {
    const matchesSearch =
      po.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (po.partner?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (po.details || []).some((d) =>
        (d.material?.description || "").toLowerCase().includes(searchTerm.toLowerCase())
      );
    const matchesStatus = statusFilter === "ALL" || po.status === statusFilter;
    const matchesPartner = partnerFilter === "ALL" || String(po.partnerId) === partnerFilter;
    return matchesSearch && matchesStatus && matchesPartner;
  });

  const handleApprove = async (id: number) => {
    setActionLoading(id);
    try {
      await api.approvePurchaseOrder(id);
      showToast(`Orden #${id} aprobada exitosamente`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al aprobar orden", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleIssue = async (id: number) => {
    setActionLoading(id);
    try {
      await api.issuePurchaseOrder(id);
      showToast(`Orden #${id} emitida al proveedor y comprometida`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al emitir orden", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReceive = async (id: number) => {
    setActionLoading(id);
    try {
      await api.receivePurchaseOrder(id);
      showToast(`Recepción confirmada. Stock ingresado al almacén.`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al recibir orden", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas anular esta orden de compra?")) return;
    setActionLoading(id);
    try {
      await api.cancelPurchaseOrder(id);
      showToast(`Orden #${id} anulada`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al anular orden", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentReq || !currentDetail) {
      showToast("Selecciona un pedido de material válido", "error");
      return;
    }
    if (unitPrice <= 0) {
      showToast("El precio unitario debe ser mayor a 0", "error");
      return;
    }

    setSubmitting(true);
    try {
      await api.createPurchaseOrder({
        materialRequestId: currentReq.id,
        partnerId: Number(partnerId),
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        details: [
          {
            requestDetailId: currentDetail.id,
            quantity: Number(currentDetail.quantity),
            unitPrice: Number(unitPrice),
          },
        ],
      });
      showToast("Orden de compra creada exitosamente en borrador");
      setShowNewModal(false);
      onClearSelectedRequestForPO();
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al crear orden de compra", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-900">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Órdenes de Compra a Proveedores
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Emisión contractual a proveedores, fijación de precios y recepción en obra.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          disabled={eligibleRequests.length === 0}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition disabled:opacity-40 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Orden de Compra</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por N° OC, proveedor o material..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-500 bg-slate-50 cursor-pointer"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="BORRADOR">Borrador</option>
            <option value="APROBADO_PARA_COMPRA">Aprobado para Emisión</option>
            <option value="EMITIDA">Emitida (Comprometido)</option>
            <option value="RECIBIDO">Recibido en Obra</option>
            <option value="ANULADO">Anulado</option>
          </select>

          <select
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-500 bg-slate-50 cursor-pointer"
          >
            <option value="ALL">Todos los Proveedores</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="p-3.5">N° Orden</th>
                <th className="p-3.5">Proveedor</th>
                <th className="p-3.5">Requisición Origen</th>
                <th className="p-3.5">Material & Cantidad</th>
                <th className="p-3.5 text-right">Monto Total</th>
                <th className="p-3.5 text-center">Estado</th>
                <th className="p-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400">
                    No hay órdenes de compra registradas.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const detail = order.details?.[0];
                  const isLoading = actionLoading === order.id;

                  return (
                    <tr key={order.id} className="hover:bg-blue-50/30 transition">
                      <td className="p-3.5 font-mono font-bold text-blue-700">
                        {order.number}
                        <div className="text-[10px] text-slate-500 font-sans font-normal">
                          {formatDate(order.createdAt)}
                        </div>
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900">
                          {order.partner?.name || "Proveedor"}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          RUC: {order.partner?.taxId || "—"}
                        </div>
                      </td>
                      <td className="p-3.5 font-mono text-blue-600 font-semibold">
                        {order.materialRequest?.number || `PM #${order.materialRequestId}`}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900">
                          {detail?.material?.description || "Material"}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {detail?.quantity} {detail?.material?.unit} @{" "}
                          {formatMoney(detail?.unitPrice, currency)}
                        </div>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-slate-900">
                        {formatMoney(order.totalAmount, currency)}
                      </td>
                      <td className="p-3.5 text-center">{getStatusBadge(order.status)}</td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Print PDF CCC */}
                          <button
                            onClick={() => setPrintOrder(order)}
                            title="Imprimir OC en Formato Oficial CCC S.A."
                            className="p-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5 text-red-600" />
                            <span className="hidden sm:inline">PDF CCC</span>
                          </button>

                          {order.status === "BORRADOR" && (
                            <button
                              disabled={isLoading}
                              onClick={() => handleApprove(order.id)}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>Aprobar</span>
                            </button>
                          )}

                          {order.status === "APROBADO_PARA_COMPRA" && (
                            <button
                              disabled={isLoading}
                              onClick={() => handleIssue(order.id)}
                              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[11px] font-bold transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                            >
                              <Clock className="w-3 h-3" />
                              <span>Emitir</span>
                            </button>
                          )}

                          {order.status === "EMITIDA" && (
                            <button
                              disabled={isLoading}
                              onClick={() => handleReceive(order.id)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                            >
                              <Package className="w-3 h-3" />
                              <span>Recibir en Obra</span>
                            </button>
                          )}

                          <button
                            onClick={() => setInspectOrder(order)}
                            className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                            title="Ver Detalle"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE PURCHASE ORDER MODAL - SIMPLIFIED, DIRECT */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Nueva Orden de Compra (OC)
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowNewModal(false);
                  onClearSelectedRequestForPO();
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Requisición de Material Aprobada
                </label>
                <select
                  value={selectedRequestId}
                  onChange={(e) => {
                    const reqId = Number(e.target.value);
                    setSelectedRequestId(reqId);
                    const sel = eligibleRequests.find((r) => r.id === reqId);
                    if (sel?.details?.[0]?.material?.estimatedCost) {
                      setUnitPrice(Number(sel.details[0].material.estimatedCost));
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500"
                >
                  {eligibleRequests.length === 0 ? (
                    <option value="">No hay requisiciones aprobadas disponibles</option>
                  ) : (
                    eligibleRequests.map((req) => (
                      <option key={req.id} value={req.id}>
                        {req.number} — {req.workFront?.name} (
                        {req.details?.[0]?.material?.description || "Material"})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {currentDetail && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="font-semibold text-slate-500">Material a Adquirir:</div>
                  <div className="font-bold text-slate-900 mt-0.5 text-sm">
                    {currentDetail.material?.description} ({currentDetail.quantity}{" "}
                    {currentDetail.material?.unit})
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-1">
                    Código: <span className="text-blue-600 font-bold">{currentDetail.material?.code}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Proveedor Adjudicado
                </label>
                <select
                  value={partnerId}
                  onChange={(e) => setPartnerId(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500"
                  required
                >
                  {partners
                    .filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (RUC: {p.taxId})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Precio Unitario ({currency === "PYG" ? "₲" : "USD"})
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-bold outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Fecha Estimada de Entrega
                  </label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-900 font-medium outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {currentDetail && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-center justify-between">
                  <span className="font-semibold text-blue-900">Total de la Orden:</span>
                  <span className="font-mono font-bold text-blue-700 text-sm">
                    {formatMoney(Number(currentDetail.quantity) * Number(unitPrice), currency)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewModal(false);
                    onClearSelectedRequestForPO();
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !currentReq}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Creando..." : "Generar Orden de Compra"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT ORDER MODAL */}
      {inspectOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 text-slate-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-blue-700">
                  {inspectOrder.number}
                </span>
                {getStatusBadge(inspectOrder.status)}
              </div>
              <button
                onClick={() => setInspectOrder(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500">Obra / Proyecto</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">
                    {inspectOrder.project?.name || project?.name}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500">Proveedor</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">
                    {inspectOrder.partner?.name}
                  </div>
                  <div className="text-slate-500 font-mono mt-0.5">RUC: {inspectOrder.partner?.taxId}</div>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Material</th>
                      <th className="p-2.5 text-right">Cantidad</th>
                      <th className="p-2.5 text-right">P. Unitario</th>
                      <th className="p-2.5 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {inspectOrder.details?.map((item) => (
                      <tr key={item.id}>
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900">{item.material?.description}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            Cód: {item.material?.code}
                          </div>
                        </td>
                        <td className="p-2.5 text-right font-mono font-semibold text-slate-900">
                          {item.quantity} {item.material?.unit}
                        </td>
                        <td className="p-2.5 text-right font-mono text-slate-600">
                          {formatMoney(item.unitPrice, currency)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-blue-700">
                          {formatMoney(item.subtotal, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                    <tr>
                      <td colSpan={3} className="p-2.5 text-right text-slate-600">
                        TOTAL ORDEN:
                      </td>
                      <td className="p-2.5 text-right font-mono text-sm text-slate-900">
                        {formatMoney(inspectOrder.totalAmount, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => {
                  setPrintOrder(inspectOrder);
                  setInspectOrder(null);
                }}
                className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-red-600" />
                <span>Imprimir con Membrete CCC</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInspectOrder(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cerrar
                </button>
                {inspectOrder.status === "EMITIDA" && (
                  <button
                    onClick={() => {
                      handleReceive(inspectOrder.id);
                      setInspectOrder(null);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Recibir en Obra
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE COMPROBANTE ORDEN DE COMPRA CON MEMBRETE CCC */}
      {printOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full p-6 sm:p-8 relative my-8 print:p-0 print:m-0 print:shadow-none print:w-full print:max-w-none">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-200 print:hidden">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-red-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Orden de Compra Oficial CCC S.A.
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir / Guardar en PDF</span>
                </button>
                <button
                  onClick={() => setPrintOrder(null)}
                  className="p-1.5 rounded-xl border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Document Body */}
            <div className="space-y-6 font-sans">
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
                <div className="flex items-center gap-3">
                  <img
                    src="/logo-ccc.svg"
                    alt="CCC S.A. Logo"
                    className="h-12 sm:h-14 w-auto object-contain"
                  />
                  <div className="border-l border-slate-300 pl-3">
                    <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wide">
                      Construcciones y Canteras del Chaco S.A.
                    </div>
                    <div className="text-[9px] text-slate-500">
                      R.U.C. 80012345-6 | Departamento de Compras
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="inline-block bg-slate-900 text-white font-mono font-bold text-xs px-2.5 py-1 rounded">
                    ORDEN DE COMPRA
                  </div>
                  <div className="text-sm font-mono font-extrabold text-slate-900 mt-1">
                    N° {printOrder.number}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Fecha: {formatDate(printOrder.createdAt)}
                  </div>
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Obra / Destino
                  </span>
                  <span className="font-bold text-slate-900 text-sm">
                    {project?.name || "CTN - COLEGIO TECNICO NACIONAL"}
                  </span>
                  <div className="text-slate-600 mt-1">
                    Ubicación: {project?.location || "Asunción, Paraguay"}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Proveedor Adjudicado
                  </span>
                  <span className="font-bold text-slate-900 text-sm">
                    {printOrder.partner?.name}
                  </span>
                  <div className="font-mono text-slate-700 mt-0.5">
                    RUC: {printOrder.partner?.taxId}
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="border border-slate-300 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-[11px]">
                    <tr>
                      <th className="p-2.5 w-12 text-center">Ítem</th>
                      <th className="p-2.5 w-24">Código</th>
                      <th className="p-2.5">Descripción del Insumo</th>
                      <th className="p-2.5 text-center w-20">Unidad</th>
                      <th className="p-2.5 text-right w-24">Cantidad</th>
                      <th className="p-2.5 text-right w-28">P. Unitario</th>
                      <th className="p-2.5 text-right w-32">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {printOrder.details?.map((det, idx) => (
                      <tr key={det.id} className="text-slate-800">
                        <td className="p-2.5 text-center font-mono font-bold text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-red-700">
                          {det.material?.code || "S/C"}
                        </td>
                        <td className="p-2.5 font-medium">
                          {det.material?.description}
                        </td>
                        <td className="p-2.5 text-center font-mono">
                          {det.material?.unit}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {det.quantity}
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {formatMoney(det.unitPrice, currency)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                          {formatMoney(det.subtotal, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                    <tr>
                      <td colSpan={6} className="p-3 text-right text-slate-800 uppercase tracking-wider">
                        Total Facturable ({currency}):
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-slate-950 font-extrabold">
                        {formatMoney(printOrder.totalAmount, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatures */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold text-slate-900">Departamento de Compras CCC S.A.</div>
                  <div className="text-[10px] text-slate-500">Emisión y Autorización</div>
                </div>

                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold text-slate-900">{printOrder.partner?.name}</div>
                  <div className="text-[10px] text-slate-500">Aceptación Proveedor / Firma y Sello</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
