import React, { useState } from "react";
import {
  Package,
  ArrowUpRight,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  Layers,
  Clock,
  HardHat,
  X,
} from "lucide-react";
import {
  WarehouseStock,
  StockMovement,
  Material,
  WorkFront,
  Project,
} from "../types";
import { formatDateTime } from "../utils/format";
import { getMovementBadge } from "../utils/statusBadges";
import { api } from "../api";

interface StockWarehouseTabProps {
  project?: Project | null;
  stock: WarehouseStock[];
  movements: StockMovement[];
  materials: Material[];
  workFronts: WorkFront[];
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const StockWarehouseTab: React.FC<StockWarehouseTabProps> = ({
  project,
  stock,
  movements,
  materials,
  workFronts,
  onRefresh,
  showToast,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [movementFilter, setMovementFilter] = useState<string>("ALL");
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Consumption Form state
  const [consumptionForm, setConsumptionForm] = useState({
    materialId: materials[0]?.id || 1,
    quantity: 5,
    workFrontId: workFronts[0]?.id || 1,
    note: "",
  });

  // Adjustment Form state
  const [adjustmentForm, setAdjustmentForm] = useState({
    materialId: materials[0]?.id || 1,
    quantity: 0,
    note: "",
  });

  const filteredStock = stock.filter((item) => {
    const matName = item.material?.description || "";
    const matCode = item.material?.code || "";
    return (
      matName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      matCode.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const filteredMovements = movements.filter((mov) => {
    const matchesType = movementFilter === "ALL" || mov.movementType === movementFilter;
    const matName = mov.material?.description || "";
    const matchesSearch =
      matName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (mov.note || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleConsumptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra primero", "error");
      return;
    }
    if (consumptionForm.quantity <= 0) {
      showToast("La cantidad debe ser mayor a 0", "error");
      return;
    }

    setSubmitting(true);
    try {
      const selectedWf = workFronts.find((wf) => wf.id === Number(consumptionForm.workFrontId));
      const fullNote = `${selectedWf ? `[${selectedWf.name}] ` : ""}${consumptionForm.note || "Despacho a obra"}`;

      await api.registerConsumption(project.id, {
        materialId: Number(consumptionForm.materialId),
        quantity: Number(consumptionForm.quantity),
        note: fullNote,
      });
      showToast("Salida de material a sector de obra registrada");
      setShowConsumptionModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al registrar salida", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra primero", "error");
      return;
    }
    if (adjustmentForm.quantity === 0) {
      showToast("El ajuste debe ser distinto de 0", "error");
      return;
    }
    if (!adjustmentForm.note.trim()) {
      showToast("Indica el motivo del ajuste físico", "error");
      return;
    }

    setSubmitting(true);
    try {
      await api.registerAdjustment({
        projectId: project.id,
        materialId: Number(adjustmentForm.materialId),
        quantity: Number(adjustmentForm.quantity),
        note: adjustmentForm.note,
      });
      showToast("Ajuste de inventario aplicado");
      setShowAdjustmentModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al aplicar ajuste", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Almacén Central & Stock de Obra
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Control físico de inventario, despacho a sectores de trabajo y ajustes de balance.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            id="btn-open-consumption-modal"
            onClick={() => setShowConsumptionModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Salida a Sector de Obra</span>
          </button>
          <button
            id="btn-open-adjustment-modal"
            onClick={() => setShowAdjustmentModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 shadow-xs transition cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            <span>Ajuste de Stock</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código o descripción en almacén..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
          />
        </div>
      </div>

      {/* Stock Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredStock.length === 0 ? (
          <div className="col-span-4 bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs shadow-xs">
            No hay existencias registradas en el almacén central.
          </div>
        ) : (
          filteredStock.map((item) => {
            const current = Number(item.currentStock || 0);
            const reserved = Number(item.reservedStock || 0);
            const isLow = current <= 5;

            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col justify-between hover:border-blue-500/50 transition"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-blue-700 px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                      {item.material?.code}
                    </span>
                    {isLow ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> Stock Bajo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Disponible
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm mt-2.5 line-clamp-2">
                    {item.material?.description || "Material de Obra"}
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Categoría: {item.material?.category}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-baseline justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500">
                      Stock en Almacén
                    </span>
                    <div className="font-mono text-xl font-black text-slate-900">
                      {current}{" "}
                      <span className="text-xs font-normal text-slate-500">
                        {item.material?.unit}
                      </span>
                    </div>
                  </div>
                  {reserved > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-500">
                        Reservado
                      </span>
                      <div className="font-mono text-xs font-semibold text-amber-700">
                        {reserved} {item.material?.unit}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Movements Ledger */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Libro de Movimientos de Inventario
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={movementFilter}
              onChange={(e) => setMovementFilter(e.target.value)}
              className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="ALL">Todos los Movimientos</option>
              <option value="RECEIPT">Ingresos (Órdenes de Compra)</option>
              <option value="CONSUMPTION">Salidas a Sector de Obra</option>
              <option value="ADJUSTMENT">Ajustes de Inventario</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="p-3">Fecha & Hora</th>
                <th className="p-3">Tipo Movimiento</th>
                <th className="p-3">Material</th>
                <th className="p-3 text-right">Cantidad</th>
                <th className="p-3">Destino / Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
                    No se registran movimientos en el historial.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((mov) => {
                  const qty = Number(mov.quantity);

                  return (
                    <tr key={mov.id} className="hover:bg-blue-50/30 transition">
                      <td className="p-3 text-slate-500 font-mono">
                        {formatDateTime(mov.createdAt)}
                      </td>
                      <td className="p-3">{getMovementBadge(mov.movementType)}</td>
                      <td className="p-3">
                        <span className="font-semibold text-slate-900">
                          {mov.material?.description || "Material"}
                        </span>
                        <span className="ml-1.5 font-mono text-[10px] text-blue-700">
                          ({mov.material?.code})
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        <span
                          className={
                            mov.movementType === "RECEIPT"
                              ? "text-emerald-700"
                              : mov.movementType === "CONSUMPTION"
                              ? "text-amber-700"
                              : "text-blue-700"
                          }
                        >
                          {mov.movementType === "CONSUMPTION" ? "-" : "+"}
                          {Math.abs(qty)} {mov.material?.unit}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 text-[11px]">
                        {mov.note || (mov.sourceType ? `Origen: ${mov.sourceType} #${mov.sourceId}` : "—")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consumption Modal */}
      {showConsumptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Registrar Salida / Despacho a Obra
                </h3>
              </div>
              <button
                onClick={() => setShowConsumptionModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConsumptionSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Insumo / Material a Despachar
                </label>
                <select
                  value={consumptionForm.materialId}
                  onChange={(e) =>
                    setConsumptionForm({ ...consumptionForm, materialId: Number(e.target.value) })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.description} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Cantidad a Retirar
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={consumptionForm.quantity}
                    onChange={(e) =>
                      setConsumptionForm({
                        ...consumptionForm,
                        quantity: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-mono font-bold outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Sector / Frente Receptor
                  </label>
                  <select
                    value={consumptionForm.workFrontId}
                    onChange={(e) =>
                      setConsumptionForm({
                        ...consumptionForm,
                        workFrontId: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {workFronts.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.code} — {wf.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Destino / Observaciones de Salida
                </label>
                <input
                  type="text"
                  value={consumptionForm.note}
                  onChange={(e) => setConsumptionForm({ ...consumptionForm, note: e.target.value })}
                  placeholder="Ej: Despachado para fundaciones del Bloque B..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowConsumptionModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Registrando..." : "Confirmar Salida"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Ajuste de Inventario Físico
                </h3>
              </div>
              <button
                onClick={() => setShowAdjustmentModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustmentSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Material a Ajustar
                </label>
                <select
                  value={adjustmentForm.materialId}
                  onChange={(e) =>
                    setAdjustmentForm({ ...adjustmentForm, materialId: Number(e.target.value) })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium outline-none focus:border-blue-500 cursor-pointer"
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.description} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Cantidad del Ajuste (+ para sumar, - para restar)
                </label>
                <input
                  type="number"
                  step="any"
                  value={adjustmentForm.quantity}
                  onChange={(e) =>
                    setAdjustmentForm({
                      ...adjustmentForm,
                      quantity: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-mono font-bold outline-none focus:border-blue-500"
                  placeholder="Ej: -2.5 o 5"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Motivo del Ajuste (Conteo físico, merma, rotura)
                </label>
                <textarea
                  rows={2}
                  value={adjustmentForm.note}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
                  placeholder="Justificación del conteo físico..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Aplicando..." : "Aplicar Ajuste"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
