import React, { useState } from "react";
import {
  Package,
  Plus,
  Search,
  Upload,
  Trash2,
  Edit2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  Filter,
  Layers,
} from "lucide-react";
import { Material, WarehouseStock } from "../types";
import { api } from "../api";
import { formatMoney } from "../utils/format";

interface MaterialsListTabProps {
  materials: Material[];
  stock: WarehouseStock[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const MaterialsListTab: React.FC<MaterialsListTabProps> = ({
  materials,
  stock,
  currency,
  onRefresh,
  showToast,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formState, setFormState] = useState({
    code: "",
    description: "",
    unit: "un",
    category: "MATERIALES",
    estimatedCost: 0,
  });

  // Bulk paste text state
  const [bulkText, setBulkText] = useState("");

  const categories = Array.from(new Set(materials.map((m) => m.category).filter(Boolean)));

  const filteredMaterials = materials.filter((m) => {
    const matchesSearch =
      m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === "ALL" || m.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleOpenCreate = () => {
    setFormState({
      code: `MAT-${String(materials.length + 1).padStart(3, "0")}`,
      description: "",
      unit: "un",
      category: "MATERIALES",
      estimatedCost: 0,
    });
    setShowCreateModal(true);
  };

  const handleOpenEdit = (m: Material) => {
    setEditingMaterial(m);
    setFormState({
      code: m.code,
      description: m.description,
      unit: m.unit,
      category: m.category,
      estimatedCost: Number(m.estimatedCost || 0),
    });
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.code.trim() || !formState.description.trim()) {
      showToast("El código y la descripción son obligatorios", "error");
      return;
    }

    setSubmitting(true);
    try {
      if (editingMaterial) {
        await api.updateMaterial(editingMaterial.id, {
          code: formState.code.trim(),
          description: formState.description.trim(),
          unit: formState.unit.trim(),
          category: formState.category.trim().toUpperCase(),
          estimatedCost: Number(formState.estimatedCost),
        });
        showToast("Material actualizado exitosamente");
        setEditingMaterial(null);
      } else {
        await api.createMaterial({
          code: formState.code.trim(),
          description: formState.description.trim(),
          unit: formState.unit.trim(),
          category: formState.category.trim().toUpperCase(),
          estimatedCost: Number(formState.estimatedCost),
        });
        showToast("Material creado exitosamente");
        setShowCreateModal(false);
      }
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al guardar el material", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!materialToDelete) return;
    setSubmitting(true);
    try {
      await api.deleteMaterial(materialToDelete.id);
      showToast(`Material ${materialToDelete.code} eliminado`);
      setMaterialToDelete(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar material", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) {
      showToast("Ingresa o pega las filas de materiales a importar", "error");
      return;
    }

    const lines = bulkText.split("\n").filter((l) => l.trim().length > 0);
    const parsed: Array<{ code: string; description: string; unit: string; category: string; estimatedCost: number }> = [];

    for (const line of lines) {
      // Split by tab or semicolon or comma
      const parts = line.includes("\t")
        ? line.split("\t")
        : line.includes(";")
        ? line.split(";")
        : line.split(",");

      if (parts.length >= 2) {
        const code = parts[0]?.trim() || `MAT-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const description = parts[1]?.trim() || "";
        const unit = parts[2]?.trim() || "un";
        const category = parts[3]?.trim() || "MATERIALES";
        const estimatedCost = Number(parts[4]?.replace(/[^\d.-]/g, "") || 0);

        if (description) {
          parsed.push({ code, description, unit, category, estimatedCost });
        }
      }
    }

    if (parsed.length === 0) {
      showToast("No se pudieron detectar filas válidas. Formato: Código | Descripción | Unidad | Categoría | Costo", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.bulkCreateMaterials(parsed);
      showToast(`${res.count} materiales importados correctamente`);
      setShowBulkModal(false);
      setBulkText("");
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al importar materiales en lote", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Catálogo de Materiales e Insumos</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              {materials.length} materiales registrados
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gestioná tu base maestra de materiales con códigos, unidades, categorías y costos unitarios de referencia.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-blue-700 border border-slate-200 text-xs font-bold transition shadow-2xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            <span>Subir Lista (Excel/CSV)</span>
          </button>

          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Material</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 p-3 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 w-full sm:w-auto flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por código o descripción de material..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500 transition"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 transition"
          >
            <option value="ALL">Todas las Categorías ({materials.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-slate-500">
          Mostrando <strong className="text-slate-900">{filteredMaterials.length}</strong> materiales
        </span>
      </div>

      {/* Materials Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="p-3 w-28">CÓDIGO</th>
                <th className="p-3">DESCRIPCIÓN DEL MATERIAL</th>
                <th className="p-3 text-center">CATEGORÍA</th>
                <th className="p-3 text-center">UNIDAD</th>
                <th className="p-3 text-right">COSTO ESTIMADO</th>
                <th className="p-3 text-right">STOCK DISPONIBLE</th>
                <th className="p-3 text-center w-28">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No se encontraron materiales. Hacé clic en "Nuevo Material" o "Subir Lista" para agregar.
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((m) => {
                  const stockItem = stock.find((s) => s.materialId === m.id);
                  const currentStock = stockItem ? Number(stockItem.currentStock || 0) : 0;

                  return (
                    <tr key={m.id} className="hover:bg-blue-50/30 transition">
                      <td className="p-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                        {m.code}
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-slate-900">{m.description}</p>
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {m.category || "GENERAL"}
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono text-slate-600">
                        {m.unit}
                      </td>
                      <td className="p-3 text-right font-mono font-semibold text-slate-800">
                        {formatMoney(Number(m.estimatedCost || 0), currency)}
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        <span className={currentStock > 5 ? "text-emerald-700" : "text-amber-700"}>
                          {currentStock.toLocaleString("es-PY")} {m.unit}
                        </span>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(m)}
                            title="Modificar Material"
                            className="p-1.5 rounded-lg bg-slate-50 hover:bg-blue-50 text-blue-600 hover:text-blue-800 border border-slate-200 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setMaterialToDelete(m)}
                            title="Eliminar Material"
                            className="p-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* Modal: Create or Edit Material */}
      {(showCreateModal || editingMaterial) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => {
                setShowCreateModal(false);
                setEditingMaterial(null);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Package className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                {editingMaterial ? "Modificar Material" : "Crear Nuevo Material / Ítem"}
              </h3>
            </div>

            <form onSubmit={handleSaveMaterial} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Código de Material *</label>
                  <input
                    type="text"
                    required
                    value={formState.code}
                    onChange={(e) => setFormState({ ...formState, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. MAT-001 o CEM-01"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unidad de Medida *</label>
                  <input
                    type="text"
                    required
                    value={formState.unit}
                    onChange={(e) => setFormState({ ...formState, unit: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. un, m3, kg, bolsa"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Descripción del Material *</label>
                <input
                  type="text"
                  required
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                  placeholder="Ej. Cemento Portland Tipo I en bolsas de 50 kg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Categoría / Rubro</label>
                  <input
                    type="text"
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. AGLOMERANTES, HIERROS"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Costo Estimado ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formState.estimatedCost}
                    onChange={(e) => setFormState({ ...formState, estimatedCost: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingMaterial(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  {submitting ? "Guardando..." : editingMaterial ? "Guardar Cambios" : "Crear Material"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Bulk Upload Materials */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => setShowBulkModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Upload className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Subir Lista de Materiales (Excel / CSV / Texto)</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Pegá tus filas de Excel copiadas directamente (Ctrl+C / Ctrl+V).
              Columnas esperadas: <strong>Código [TAB] Descripción [TAB] Unidad [TAB] Categoría [TAB] Costo Estimado</strong>
            </p>

            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="MAT-01&#9;Cemento Portland 50kg&#9;bolsa&#9;AGLOMERANTES&#9;65000&#10;MAT-02&#9;Varilla de Acero 12mm&#9;barra&#9;ACEROS&#9;92000&#10;MAT-03&#9;Arena lavada triturada&#9;m3&#9;AGREGADOS&#9;150000"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500"
            />

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {bulkText.split("\n").filter((l) => l.trim()).length} filas detectadas
              </span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={submitting || !bulkText.trim()}
                  onClick={handleBulkImport}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  {submitting ? "Importando..." : "Importar Materiales"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {materialToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-900">¿Eliminar Material?</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              ¿Estás seguro de que querés borrar el material <strong>{materialToDelete.code}</strong> - {materialToDelete.description}? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMaterialToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={submitting}
                onClick={handleDeleteMaterial}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {submitting ? "Borrando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
