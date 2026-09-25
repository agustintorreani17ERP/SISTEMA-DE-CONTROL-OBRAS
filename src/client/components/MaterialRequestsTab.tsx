import React, { useState, useMemo } from "react";
import {
  Package,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ChevronRight,
  Receipt,
  FileText,
  UserCheck,
  AlertCircle,
  Eye,
  Trash2,
  Printer,
  X,
  Layers,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  MaterialRequest,
  WorkFront,
  Personnel,
  Material,
  BudgetItem,
  Project,
} from "../types";
import { formatDate, formatDateTime } from "../utils/format";
import { getStatusBadge } from "../utils/statusBadges";
import { api } from "../api";

interface MaterialRequestsTabProps {
  project?: Project | null;
  materialRequests: MaterialRequest[];
  workFronts: WorkFront[];
  personnel: Personnel[];
  materials: Material[];
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onOpenCreatePOForRequest: (req: MaterialRequest) => void;
}

export const MaterialRequestsTab: React.FC<MaterialRequestsTabProps> = ({
  project,
  materialRequests,
  workFronts,
  personnel,
  materials,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  onOpenCreatePOForRequest,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [frontFilter, setFrontFilter] = useState<string>("ALL");
  const [showNewModal, setShowNewModal] = useState(false);
  const [inspectRequest, setInspectRequest] = useState<MaterialRequest | null>(null);
  const [printRequest, setPrintRequest] = useState<MaterialRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // New material inline creation state
  const [showAddMaterialModal, setShowAddMaterialModal] = useState(false);
  const [materialSearchQuery, setMaterialSearchQuery] = useState("");
  const [newMaterialForm, setNewMaterialForm] = useState({
    code: "",
    description: "",
    unit: "un",
    category: "GENERAL",
  });
  const [creatingMaterial, setCreatingMaterial] = useState(false);

  // Simplified Form state (no mandatory budget item requirement!)
  const [formData, setFormData] = useState({
    workFrontId: workFronts[0]?.id || 1,
    requestedById: personnel[0]?.id || 1,
    materialId: materials[0]?.id || 1,
    quantity: 10,
    notes: "",
  });

  // Filtered materials by search query
  const filteredMaterials = useMemo(() => {
    if (!materialSearchQuery.trim()) return materials;
    const q = materialSearchQuery.toLowerCase();
    return materials.filter(
      (m) => m.code.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    );
  }, [materials, materialSearchQuery]);

  const filteredRequests = materialRequests.filter((req) => {
    const matchesSearch =
      req.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (req.workFront?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (req.notes || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (req.details || []).some(
        (d) =>
          (d.material?.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
          (d.material?.code || "").toLowerCase().includes(searchTerm.toLowerCase())
      );
    const matchesStatus = statusFilter === "ALL" || req.status === statusFilter;
    const matchesFront = frontFilter === "ALL" || String(req.workFrontId) === frontFilter;
    return matchesSearch && matchesStatus && matchesFront;
  });

  const handleApprove = async (id: number) => {
    try {
      await api.approveMaterialRequest(id);
      showToast(`Pedido #${id} aprobado para compra`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este pedido en borrador?")) return;
    try {
      await api.deleteMaterialRequest(id);
      showToast("Pedido eliminado correctamente");
      onRefresh();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  // Quick Material Creation handler
  const handleCreateNewMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterialForm.code.trim() || !newMaterialForm.description.trim()) {
      showToast("Completa el código y la descripción del material", "error");
      return;
    }

    setCreatingMaterial(true);
    try {
      const created = await api.createMaterial({
        code: newMaterialForm.code.trim().toUpperCase(),
        description: newMaterialForm.description.trim(),
        unit: newMaterialForm.unit.trim(),
        category: newMaterialForm.category.trim().toUpperCase(),
        estimatedCost: 0,
      });

      showToast(`Material ${created.code} agregado al catálogo`);
      // Update form selection with the newly created material
      setFormData((prev) => ({ ...prev, materialId: created.id }));
      setShowAddMaterialModal(false);
      setNewMaterialForm({ code: "", description: "", unit: "un", category: "GENERAL" });
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al registrar nuevo material", "error");
    } finally {
      setCreatingMaterial(false);
    }
  };

  // Create Request handler
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra válida primero", "error");
      return;
    }
    if (formData.quantity <= 0) {
      showToast("La cantidad debe ser mayor a 0", "error");
      return;
    }

    setSubmitting(true);
    try {
      await api.createMaterialRequest({
        projectId: project.id,
        workFrontId: Number(formData.workFrontId),
        requestedById: Number(formData.requestedById),
        notes: formData.notes,
        details: [
          {
            materialId: Number(formData.materialId),
            quantity: Number(formData.quantity),
          },
        ],
      });
      showToast("Pedido de material generado exitosamente en borrador");
      setShowNewModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al crear el pedido", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintVoucher = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Top Banner with White & Blue Aesthetic */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Requisiciones de Materiales de Obra
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Solicitudes de campo para abastecimiento de sectores, frentes y acopios de obra.
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-open-new-request-modal"
          onClick={() => {
            setFormData({
              workFrontId: workFronts[0]?.id || 1,
              requestedById: personnel[0]?.id || 1,
              materialId: materials[0]?.id || 1,
              quantity: 10,
              notes: "",
            });
            setShowNewModal(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Requisición de Material</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            id="search-requests-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por N° Requisición, código, material, sector o notas..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            id="status-requests-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 bg-slate-50 cursor-pointer"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="BORRADOR">Borrador</option>
            <option value="APROBADO_PARA_COMPRA">Aprobado para Compra</option>
            <option value="EMITIDA">Emitida (OC Generada)</option>
            <option value="RECIBIDO">Recibido en Obra</option>
          </select>

          <select
            id="front-requests-filter"
            value={frontFilter}
            onChange={(e) => setFrontFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 bg-slate-50 cursor-pointer"
          >
            <option value="ALL">Todos los Sectores / Frentes</option>
            {workFronts.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Material Requests Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="p-3.5">N° Pedido</th>
                <th className="p-3.5">Sector / Frente</th>
                <th className="p-3.5">Solicitante</th>
                <th className="p-3.5">Material & Cantidad</th>
                <th className="p-3.5 text-center">Estado</th>
                <th className="p-3.5 text-right">Acciones & Membrete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-400">
                    No se encontraron requisiciones que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => {
                  const detail = req.details?.[0];
                  const hasOrders = req.purchaseOrders && req.purchaseOrders.length > 0;

                  return (
                    <tr key={req.id} className="hover:bg-blue-50/30 transition">
                      <td className="p-3.5 font-mono font-bold text-blue-700">
                        {req.number}
                        <div className="text-[10px] text-slate-500 font-sans font-normal">
                          {formatDate(req.requestedDate)}
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-800 font-medium">
                        {req.workFront?.name || "Sector de Obra"}
                      </td>
                      <td className="p-3.5 text-slate-600">
                        {req.requestedBy?.fullName || "Responsable"}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900">
                          {detail?.material?.description || "Material de Obra"}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-700 font-bold border border-slate-200">
                            {detail?.material?.code || "S/C"}
                          </span>
                          <span>
                            Cant: <strong className="text-slate-900">{detail?.quantity}</strong>{" "}
                            {detail?.material?.unit}
                          </span>
                        </div>
                      </td>
                      <td className="p-3.5 text-center">
                        {getStatusBadge(req.status)}
                        {hasOrders && (
                          <div className="text-[10px] text-emerald-700 font-mono mt-1 font-semibold flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Con Orden
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-right space-x-1.5">
                        {/* Imprimir en formato CCC con membrete */}
                        <button
                          onClick={() => setPrintRequest(req)}
                          title="Imprimir Pedido en Formato Oficial CCC S.A."
                          className="p-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:text-white hover:bg-red-600 transition inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5 text-red-600" />
                          <span className="hidden sm:inline">PDF CCC</span>
                        </button>

                        <button
                          onClick={() => setInspectRequest(req)}
                          title="Ver Detalle"
                          className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition inline-flex items-center cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {req.status === "BORRADOR" && (
                          <>
                            <button
                              onClick={() => handleApprove(req.id)}
                              title="Aprobar para Compra"
                              className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white transition inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Aprobar</span>
                            </button>
                            <button
                              onClick={() => handleDelete(req.id)}
                              title="Eliminar borrador"
                              className="p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-600 hover:text-white transition inline-flex items-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {req.status === "APROBADO_PARA_COMPRA" && (
                          <button
                            onClick={() => onOpenCreatePOForRequest(req)}
                            title="Generar Orden de Compra"
                            className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition inline-flex items-center gap-1 text-[11px] cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Crear OC</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW MATERIAL REQUEST MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-600" />
                  Nueva Requisición de Materiales
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ingreso simplificado y directo para abastecimiento de obra.
                </p>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 mt-4 text-xs">
              {/* Sector / Frente */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Sector / Frente de Trabajo
                </label>
                <select
                  value={formData.workFrontId}
                  onChange={(e) => setFormData({ ...formData, workFrontId: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  required
                >
                  {workFronts.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Responsable Solicitante */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Solicitado por (Responsable de Obra / Frente)
                </label>
                <select
                  value={formData.requestedById}
                  onChange={(e) => setFormData({ ...formData, requestedById: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  required
                >
                  {personnel.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.role})
                    </option>
                  ))}
                </select>
              </div>

              {/* Material Selector with Instant Add & Filter */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    Material Requerido
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddMaterialModal(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 text-[11px] font-bold transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Agregar Nuevo Material con Código</span>
                  </button>
                </div>

                {/* Filter search in materials */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={materialSearchQuery}
                    onChange={(e) => setMaterialSearchQuery(e.target.value)}
                    placeholder="Filtrar por código o nombre de material..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500"
                  />
                </div>

                {/* Dropdown with material codes */}
                <div>
                  <select
                    value={formData.materialId}
                    onChange={(e) => setFormData({ ...formData, materialId: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-semibold outline-none focus:border-blue-500 cursor-pointer"
                    required
                  >
                    {filteredMaterials.map((m) => (
                      <option key={m.id} value={m.id}>
                        [{m.code}] — {m.description} ({m.unit})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Selected Material Info Badge */}
                {(() => {
                  const selectedMat = materials.find((m) => m.id === formData.materialId);
                  return (
                    selectedMat && (
                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-[11px]">
                        <div>
                          <span className="font-mono font-bold text-blue-700 mr-2">
                            {selectedMat.code}
                          </span>
                          <span className="text-slate-800 font-medium">{selectedMat.description}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono border border-slate-200">
                          Unidad: {selectedMat.unit}
                        </span>
                      </div>
                    )
                  );
                })()}

                {/* Cantidad Solicitada */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Cantidad Requerida
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-bold outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Observaciones / Notas */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Notas de Campo / Destino Específico (Opcional)
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Ej: Para fundaciones del Bloque B6, entrega prioritaria el lunes..."
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Generando..." : "Generar Requisición (Borrador)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL TO ADD A NEW MATERIAL WITH CODE TO THE CATALOG */}
      {showAddMaterialModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-slate-900">Registrar Nuevo Material</h4>
              </div>
              <button
                onClick={() => setShowAddMaterialModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewMaterial} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Código de Material (Identificador único)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: MAT-018, CEM-50, VAR-12"
                  value={newMaterialForm.code}
                  onChange={(e) => setNewMaterialForm({ ...newMaterialForm, code: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-mono uppercase font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Descripción / Nombre del Material
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Cemento Portland Tipo I x 50kg"
                  value={newMaterialForm.description}
                  onChange={(e) => setNewMaterialForm({ ...newMaterialForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unidad</label>
                  <select
                    value={newMaterialForm.unit}
                    onChange={(e) => setNewMaterialForm({ ...newMaterialForm, unit: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="un">un (unidad)</option>
                    <option value="bolsa">bolsa</option>
                    <option value="kg">kg (kilogramo)</option>
                    <option value="tn">tn (tonelada)</option>
                    <option value="m³">m³ (metro cúbico)</option>
                    <option value="m²">m² (metro cuadrado)</option>
                    <option value="m">m (metro lineal)</option>
                    <option value="ltr">ltr (litro)</option>
                    <option value="rollo">rollo</option>
                    <option value="barra">barra</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Categoría</label>
                  <select
                    value={newMaterialForm.category}
                    onChange={(e) => setNewMaterialForm({ ...newMaterialForm, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="GENERAL">GENERAL</option>
                    <option value="ALBAÑILERÍA">ALBAÑILERÍA</option>
                    <option value="ESTRUCTURAS">ESTRUCTURAS</option>
                    <option value="HIERROS">HIERROS</option>
                    <option value="SANITARIOS">SANITARIOS</option>
                    <option value="ELÉCTRICOS">ELÉCTRICOS</option>
                    <option value="TERMINACIONES">TERMINACIONES</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddMaterialModal(false)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-700 rounded-xl text-xs hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingMaterial}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  {creatingMaterial ? "Guardando..." : "Guardar y Seleccionar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT MODAL */}
      {inspectRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-blue-700">
                  {inspectRequest.number}
                </span>
                {getStatusBadge(inspectRequest.status)}
              </div>
              <button
                onClick={() => setInspectRequest(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-semibold text-slate-500">Sector / Frente de Obra:</div>
                <div className="text-slate-900 mt-0.5 font-medium">
                  {inspectRequest.workFront?.name || "Sector General"}
                </div>
                <div className="font-semibold text-slate-500 mt-2">Solicitado por:</div>
                <div className="text-slate-900 mt-0.5">
                  {inspectRequest.requestedBy?.fullName || "Responsable"} (
                  {inspectRequest.requestedBy?.role || "JEFE_FRENTE"})
                </div>
                {inspectRequest.notes && (
                  <>
                    <div className="font-semibold text-slate-500 mt-2">Notas / Justificación:</div>
                    <div className="text-slate-700 mt-0.5 italic">{inspectRequest.notes}</div>
                  </>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 font-bold text-slate-800 border-b border-slate-200">
                  Ítems Requeridos
                </div>
                <div className="p-3 space-y-2 bg-white">
                  {inspectRequest.details?.map((d) => (
                    <div key={d.id} className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {d.material?.description || "Material"}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Código: {d.material?.code}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-blue-700 text-sm">
                        {d.quantity} {d.material?.unit}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => {
                  setPrintRequest(inspectRequest);
                  setInspectRequest(null);
                }}
                className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 hover:text-white hover:bg-red-600 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-red-600" />
                <span>Imprimir con Membrete CCC</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectRequest(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cerrar
                </button>
                {inspectRequest.status === "BORRADOR" && (
                  <button
                    type="button"
                    onClick={() => {
                      handleApprove(inspectRequest.id);
                      setInspectRequest(null);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    Aprobar para Compra
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE COMPROBANTE CCC CON MEMBRETE MODAL */}
      {printRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full p-6 sm:p-8 relative my-8 print:p-0 print:m-0 print:shadow-none print:w-full print:max-w-none">
            {/* Top Toolbar (Hidden when printing) */}
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-200 print:hidden">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-red-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Vista Previa para Impresión / PDF Oficial CCC S.A.
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintVoucher}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir / Guardar en PDF</span>
                </button>
                <button
                  onClick={() => setPrintRequest(null)}
                  className="p-1.5 rounded-xl border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Print Document Body */}
            <div className="space-y-6 print:space-y-4 font-sans" id="ccc-voucher-print-area">
              {/* Membrete Header CCC S.A. */}
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
                      R.U.C. 80012345-6 | Asunción, Paraguay
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="inline-block bg-red-600 text-white font-mono font-bold text-xs px-2.5 py-1 rounded">
                    REQUISICIÓN DE MATERIALES
                  </div>
                  <div className="text-sm font-mono font-extrabold text-slate-900 mt-1">
                    N° {printRequest.number}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Fecha: {formatDate(printRequest.requestedDate)}
                  </div>
                </div>
              </div>

              {/* Data Information Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Obra / Proyecto
                  </span>
                  <span className="font-bold text-slate-900">
                    {project?.name || "CTN - COLEGIO TECNICO NACIONAL"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Sector / Frente de Trabajo
                  </span>
                  <span className="font-bold text-slate-900">
                    {printRequest.workFront?.name || "Sector de Obra"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Solicitado por
                  </span>
                  <span className="font-bold text-slate-900">
                    {printRequest.requestedBy?.fullName || "Responsable"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Contrato
                  </span>
                  <span className="font-medium text-slate-800">
                    {project?.contractNumber || "MEC-2024-EDIF-012"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Cliente / Mandante
                  </span>
                  <span className="font-medium text-slate-800">
                    {project?.clientName || "Ministerio de Educación y Ciencias"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Estado de Requisición
                  </span>
                  <span className="font-mono font-bold text-slate-800">
                    {printRequest.status}
                  </span>
                </div>
              </div>

              {/* Table of Materials */}
              <div className="border border-slate-300 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-[11px]">
                    <tr>
                      <th className="p-2.5 w-12 text-center">Ítem</th>
                      <th className="p-2.5 w-24">Código</th>
                      <th className="p-2.5">Descripción del Insumo / Material</th>
                      <th className="p-2.5 text-center w-20">Unidad</th>
                      <th className="p-2.5 text-right w-24">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {printRequest.details?.map((det, idx) => (
                      <tr key={det.id} className="text-slate-800">
                        <td className="p-2.5 text-center font-mono font-bold text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-red-700">
                          {det.material?.code || "S/C"}
                        </td>
                        <td className="p-2.5 font-medium">
                          {det.material?.description || "Material de Obra"}
                        </td>
                        <td className="p-2.5 text-center font-mono">
                          {det.material?.unit || "un"}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                          {det.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Observaciones */}
              {printRequest.notes && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-slate-800">
                  <span className="font-bold text-amber-900 block mb-0.5">
                    Observaciones y Justificación de Uso:
                  </span>
                  <p className="italic">{printRequest.notes}</p>
                </div>
              )}

              {/* Official Triple Signature Boxes */}
              <div className="pt-8 sm:pt-12 grid grid-cols-3 gap-4 text-center text-xs">
                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold text-slate-900">
                    {printRequest.requestedBy?.fullName || "Solicitante de Campo"}
                  </div>
                  <div className="text-[10px] text-slate-500">Solicitado en Frente</div>
                </div>

                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold text-slate-900">Ing. Jefatura de Obra</div>
                  <div className="text-[10px] text-slate-500">Aprobación Técnica</div>
                </div>

                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold text-slate-900">Almacén / Compras CCC</div>
                  <div className="text-[10px] text-slate-500">Recepción & Despacho</div>
                </div>
              </div>

              {/* Footer Note */}
              <div className="text-[9px] text-slate-400 text-center pt-3 border-t border-slate-200">
                Documento de control interno emitido por el sistema ERP InfraTrack — CCC S.A.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
