import React, { useState, useMemo } from "react";
import {
  Layers,
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  Download,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  SlidersHorizontal,
  FileCheck,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Project, BudgetItem, PurchaseOrder } from "../types";
import { formatMoney, parseFlexibleNumber } from "../utils/format";
import { ExcelBudgetImporter } from "./ExcelBudgetImporter";
import { RubrosExtrasTab } from "./RubrosExtrasTab";
import { api } from "../api";

interface CentroCostosTabProps {
  project?: Project | null;
  budgetItems: BudgetItem[];
  purchaseOrders: PurchaseOrder[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  initialOpenImporter?: boolean;
}

type SubTab = "wbs" | "adendas" | "saldo-teorico" | "importer";

export const CentroCostosTab: React.FC<CentroCostosTabProps> = ({
  project,
  budgetItems,
  purchaseOrders,
  currency,
  onRefresh,
  showToast,
  initialOpenImporter = false,
}) => {
  const [subTab, setSubTab] = useState<SubTab>(initialOpenImporter ? "importer" : "wbs");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // CRUD Item modal
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<BudgetItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [itemForm, setItemForm] = useState({
    code: "",
    name: "",
    category: "GENERAL",
    unit: "un",
    quantity: "1",
    unitPrice: "0",
  });

  // Calculate committed amounts by budgetItem from purchase orders
  const committedByItem = useMemo(() => {
    const map: Record<number, number> = {};
    purchaseOrders.forEach((po) => {
      if (po.status !== "ANULADO") {
        (po.details || []).forEach((d) => {
          if (d.budgetItemId) {
            map[d.budgetItemId] = (map[d.budgetItemId] || 0) + Number(d.subtotal || 0);
          }
        });
      }
    });
    return map;
  }, [purchaseOrders]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    budgetItems.forEach((b) => {
      if (b.category) set.add(b.category);
    });
    return Array.from(set).sort();
  }, [budgetItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return budgetItems.filter((item) => {
      const matchesSearch =
        item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCat = selectedCategory === "ALL" || item.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [budgetItems, searchQuery, selectedCategory]);

  // Group by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, BudgetItem[]> = {};
    filteredItems.forEach((item) => {
      const cat = item.category || "GENERAL";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [filteredItems]);

  // Totals
  const totalBase = budgetItems.reduce((acc, b) => acc + Number(b.originalAmount || 0), 0);
  const totalComprometido = budgetItems.reduce((acc, b) => {
    const fromPO = committedByItem[b.id] || 0;
    const fromItem = Number(b.committedAmount || 0);
    return acc + Math.max(fromPO, fromItem);
  }, 0);
  const totalEjecutado = budgetItems.reduce((acc, b) => acc + Number(b.executedAmount || 0), 0);
  const saldoTeoricoTotal = Math.max(0, totalBase - totalComprometido);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleOpenCreate = () => {
    setEditingItem(null);
    setItemForm({
      code: `ITEM-${String(budgetItems.length + 1).padStart(2, "0")}`,
      name: "",
      category: categories[0] || "GENERAL",
      unit: "un",
      quantity: "1",
      unitPrice: "0",
    });
    setShowItemModal(true);
  };

  const handleOpenEdit = (item: BudgetItem) => {
    setEditingItem(item);
    setItemForm({
      code: item.code,
      name: item.name,
      category: item.category || "GENERAL",
      unit: item.unit || "un",
      quantity: String(item.totalQuantity || (item as any).plannedQuantity || 1),
      unitPrice: String(item.unitPrice || 0),
    });
    setShowItemModal(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) return;
    setSubmitting(true);
    try {
      const qty = parseFlexibleNumber(itemForm.quantity) || 0;
      const price = parseFlexibleNumber(itemForm.unitPrice) || 0;
      const originalAmount = Math.round(qty * price);

      if (editingItem) {
        await api.updateBudgetItem(editingItem.id, {
          code: itemForm.code.trim(),
          name: itemForm.name.trim(),
          category: itemForm.category.trim(),
          unit: itemForm.unit.trim(),
          totalQuantity: qty,
          unitPrice: price,
          originalAmount,
        });
        showToast(`Rubro ${itemForm.code} actualizado`);
      } else {
        await api.createBudgetItem({
          projectId: project.id,
          code: itemForm.code.trim(),
          name: itemForm.name.trim(),
          category: itemForm.category.trim(),
          unit: itemForm.unit.trim(),
          totalQuantity: qty,
          unitPrice: price,
          originalAmount,
        });
        showToast(`Rubro ${itemForm.code} creado exitosamente`);
      }
      setShowItemModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al guardar rubro", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: number, code: string) => {
    if (!window.confirm(`¿Seguro que deseas eliminar el rubro ${code}?`)) return;
    try {
      await api.deleteBudgetItem(id);
      showToast(`Rubro ${code} eliminado`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar rubro", "error");
    }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Top Banner Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Centro de Costos & WBS (Estructura de Desglose)
              </h1>
              <p className="text-xs text-slate-500">
                Presupuesto base de obra, adendas contractuales, control de compromisos y saldo teórico disponible.
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSubTab("importer")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-xs transition cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            <span>Cargar Planilla Excel</span>
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nuevo Rubro</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Presupuesto Base WBS
          </span>
          <p className="text-xl font-extrabold text-slate-900 font-mono">
            {formatMoney(totalBase, currency)}
          </p>
          <p className="text-[11px] text-slate-500">{budgetItems.length} rubros contractuales</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Comprometido (O.C.)
          </span>
          <p className="text-xl font-extrabold text-amber-700 font-mono">
            {formatMoney(totalComprometido, currency)}
          </p>
          <p className="text-[11px] text-slate-500">Reservado por compras aprobadas</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Ejecutado (Medido)
          </span>
          <p className="text-xl font-extrabold text-blue-700 font-mono">
            {formatMoney(totalEjecutado, currency)}
          </p>
          <p className="text-[11px] text-slate-500">Avance físico acumulado</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Saldo Teórico Disponible
          </span>
          <p className="text-xl font-extrabold text-emerald-700 font-mono">
            {formatMoney(saldoTeoricoTotal, currency)}
          </p>
          <p className="text-[11px] text-slate-500">Disponible para emitir nuevas compras</p>
        </div>
      </div>

      {/* Subtabs navigation */}
      <div className="bg-white border border-slate-200 p-2 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSubTab("wbs")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "wbs"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Estructura WBS & Presupuesto Base</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
              {budgetItems.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab("adendas")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "adendas"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Adendas & Modificaciones (Extras)</span>
          </button>

          <button
            onClick={() => setSubTab("saldo-teorico")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "saldo-teorico"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Control de Saldo Teórico y Desvíos</span>
          </button>

          <button
            onClick={() => setSubTab("importer")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "importer"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Importador de Excel</span>
          </button>
        </div>
      </div>

      {/* SUBVIEW 1: WBS TABLE */}
      {subTab === "wbs" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {/* Filter toolbar */}
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar rubro por código o nombre..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700"
                >
                  <option value="ALL">Todos los Capítulos ({categories.length})</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* WBS Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">CÓDIGO WBS</th>
                    <th className="p-3">DESCRIPCIÓN DEL RUBRO</th>
                    <th className="p-3 text-center">UNIDAD</th>
                    <th className="p-3 text-right">CANT. CONTRACTUAL</th>
                    <th className="p-3 text-right">PRECIO UNITARIO</th>
                    <th className="p-3 text-right">TOTAL PRESUPUESTADO</th>
                    <th className="p-3 text-right">COMPROMETIDO (O.C.)</th>
                    <th className="p-3 text-right">SALDO DISPONIBLE</th>
                    <th className="p-3 text-center">ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {Object.entries(groupedItems).map(([cat, items]) => {
                    const isCollapsed = collapsedCategories[cat];
                    const catTotal = items.reduce((acc, i) => acc + Number(i.originalAmount || 0), 0);

                    return (
                      <React.Fragment key={cat}>
                        <tr
                          onClick={() => toggleCategory(cat)}
                          className="bg-slate-100/70 hover:bg-slate-100 font-bold text-slate-800 cursor-pointer select-none transition"
                        >
                          <td colSpan={5} className="p-3">
                            <div className="flex items-center gap-2">
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-slate-500" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                              )}
                              <span>{cat}</span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                ({items.length} rubros)
                              </span>
                            </div>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">
                            {formatMoney(catTotal, currency)}
                          </td>
                          <td colSpan={3} />
                        </tr>

                        {!isCollapsed &&
                          items.map((item) => {
                            const committed = committedByItem[item.id] || Number(item.committedAmount || 0);
                            const orig = Number(item.originalAmount || 0);
                            const avail = Math.max(0, orig - committed);
                            const isOverBudget = committed > orig && orig > 0;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50 transition">
                                <td className="p-3 font-mono font-bold text-blue-700">{item.code}</td>
                                <td className="p-3 font-medium text-slate-800">{item.name}</td>
                                <td className="p-3 text-center font-mono text-slate-500">{item.unit || "un"}</td>
                                <td className="p-3 text-right font-mono text-slate-700">
                                  {Number(item.totalQuantity || (item as any).plannedQuantity || 1).toLocaleString()}
                                </td>
                                <td className="p-3 text-right font-mono text-slate-700">
                                  {formatMoney(Number(item.unitPrice || 0), currency)}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-slate-900">
                                  {formatMoney(orig, currency)}
                                </td>
                                <td className="p-3 text-right font-mono text-amber-700 font-bold">
                                  {formatMoney(committed, currency)}
                                </td>
                                <td className="p-3 text-right font-mono font-bold">
                                  <span className={isOverBudget ? "text-rose-600" : "text-emerald-700"}>
                                    {formatMoney(avail, currency)}
                                  </span>
                                </td>
                                <td className="p-3 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      onClick={() => handleOpenEdit(item)}
                                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                                      title="Editar rubro"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteItem(item.id, item.code)}
                                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                      title="Eliminar rubro"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: ADENDAS / EXTRAS */}
      {subTab === "adendas" && (
        <RubrosExtrasTab
          project={project}
          budgetItems={budgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {/* SUBVIEW 3: CONTROL DE SALDO TEORICO Y DESVIOS */}
      {subTab === "saldo-teorico" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-700">
            <strong className="text-blue-900">Control Preventivo de Saldo Teórico:</strong> El saldo disponible se
            calcula en tiempo real descontando las Órdenes de Compra (O.C.) aprobadas y las Actas de Medición. Esto
            impide comprometer el mismo rubro dos veces y dispara alertas tempranas de sobrecosto.
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">RUBRO WBS</th>
                    <th className="p-3">DESCRIPCIÓN</th>
                    <th className="p-3 text-right">PRESUPUESTO BASE</th>
                    <th className="p-3 text-right">COMPROMETIDO (O.C.)</th>
                    <th className="p-3 text-right">EJECUTADO</th>
                    <th className="p-3 text-right">SALDO DISPONIBLE</th>
                    <th className="p-3 text-center">ESTADO RUBRO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {budgetItems.map((item) => {
                    const committed = committedByItem[item.id] || Number(item.committedAmount || 0);
                    const orig = Number(item.originalAmount || 0);
                    const exec = Number(item.executedAmount || 0);
                    const avail = orig - committed;
                    const isExceeded = avail < 0;
                    const isWarning = avail >= 0 && avail < orig * 0.15;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition">
                        <td className="p-3 font-mono font-bold text-blue-700">{item.code}</td>
                        <td className="p-3 font-medium text-slate-800">{item.name}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          {formatMoney(orig, currency)}
                        </td>
                        <td className="p-3 text-right font-mono text-amber-700 font-bold">
                          {formatMoney(committed, currency)}
                        </td>
                        <td className="p-3 text-right font-mono text-blue-700">
                          {formatMoney(exec, currency)}
                        </td>
                        <td className="p-3 text-right font-mono font-extrabold">
                          <span className={isExceeded ? "text-rose-600" : "text-emerald-700"}>
                            {formatMoney(avail, currency)}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {isExceeded ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                              ⚠️ Excedido
                            </span>
                          ) : isWarning ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              ⚡ Crítico (&lt;15%)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              ✓ Normal
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 4: EXCEL BUDGET IMPORTER */}
      {subTab === "importer" && (
        <ExcelBudgetImporter
          project={project}
          currency={currency}
          onImportComplete={() => {
            onRefresh();
            setSubTab("wbs");
            showToast("Presupuesto base importado exitosamente desde Excel");
          }}
          onBack={() => setSubTab("wbs")}
          showToast={showToast}
        />
      )}

      {/* MODAL: CREATE / EDIT BUDGET ITEM */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowItemModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                {editingItem ? "Editar Rubro Presupuestario" : "Crear Nuevo Rubro"}
              </h3>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Código WBS *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. B6.1.1 o 01.02"
                    value={itemForm.code}
                    onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Capítulo / Categoría</label>
                  <input
                    type="text"
                    list="cat-suggestions"
                    value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium"
                  />
                  <datalist id="cat-suggestions">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Descripción del Rubro *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Hormigón Armado en Vigas y Losas"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unidad</label>
                  <input
                    type="text"
                    placeholder="m³, m², un, kg"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cantidad</label>
                  <input
                    type="text"
                    value={itemForm.quantity}
                    onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-right"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Precio Unitario</label>
                  <input
                    type="text"
                    value={itemForm.unitPrice}
                    onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-right"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  {submitting ? "Guardando..." : "Guardar Rubro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
