import React, { useState, useEffect, useMemo } from "react";
import {
  FileSpreadsheet,
  Upload,
  Plus,
  ClipboardCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  ArrowLeft,
  X,
  Camera,
  Trash2,
  Check,
  Image as ImageIcon,
  Building2,
  FileCheck,
  AlertCircle,
  HelpCircle,
  Users,
  Search,
  Filter,
  BarChart3,
  Percent,
  Download,
  Layers,
  Edit2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  DollarSign,
  SlidersHorizontal,
} from "lucide-react";
import { Project, BudgetItem, Partner, SubcontractorContract } from "../types";
import { api } from "../api";
import { formatMoney, parseFlexibleNumber, formatQuantity } from "../utils/format";
import { ExcelBudgetImporter } from "./ExcelBudgetImporter";
import { SubcontractorsScheduleTab } from "./SubcontractorsScheduleTab";
import { RubrosExtrasTab } from "./RubrosExtrasTab";

export interface Certificacion {
  id: number;
  projectId: number;
  budgetItemId?: number;
  subcontractId?: number;
  rubro: string;
  unidad?: string;
  cantidad_medida: number;
  monto_total: number;
  estado: "APROBADA" | "EN_REVISION" | "RECHAZADA";
  evidencia?: string;
  esAdenda?: boolean;
  createdAt?: string;
  budgetItem?: {
    code?: string;
    name?: string;
    totalQuantity?: number;
    unitPrice?: number;
    originalAmount?: number;
    executedAmount?: number;
    executedQuantity?: number;
  };
}

interface CertificacionesHubTabProps {
  project?: Project | null;
  budgetItems: BudgetItem[];
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  initialOpenImporter?: boolean;
}

type SubView = "planilla-control" | "adendas-extras" | "actas-historial" | "subcontratistas" | "importer";

export const CertificacionesHubTab: React.FC<CertificacionesHubTabProps> = ({
  project,
  budgetItems: initialBudgetItems,
  partners,
  subcontracts,
  currency,
  onRefresh,
  showToast,
  initialOpenImporter = false,
}) => {
  const [subView, setSubView] = useState<SubView>(initialOpenImporter ? "importer" : "planilla-control");
  const [certificaciones, setCertificaciones] = useState<Certificacion[]>([]);
  const [localBudgetItems, setLocalBudgetItems] = useState<BudgetItem[]>(initialBudgetItems);
  const [loadingCerts, setLoadingCerts] = useState(false);

  // Sync initial budget items
  useEffect(() => {
    setLocalBudgetItems(initialBudgetItems);
  }, [initialBudgetItems]);

  // Planilla search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // New Certification Modal state
  const [showNewCertModal, setShowNewCertModal] = useState(false);
  const [selectedBudgetItemId, setSelectedBudgetItemId] = useState<string>("");
  const [measuredQuantity, setMeasuredQuantity] = useState<string>("");
  const [evidenceUrl, setEvidenceUrl] = useState<string>("");
  const [evidenceFileName, setEvidenceFileName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Inline "Agregar Nuevo Rubro si no está en el presupuesto"
  const [showAddCustomRubro, setShowAddCustomRubro] = useState(false);
  const [customRubroCode, setCustomRubroCode] = useState("");
  const [customRubroName, setCustomRubroName] = useState("");
  const [customRubroCategory, setCustomRubroCategory] = useState("ADICIONALES");
  const [customRubroUnit, setCustomRubroUnit] = useState("m³");
  const [customRubroQty, setCustomRubroQty] = useState("");
  const [customRubroPrice, setCustomRubroPrice] = useState("");

  // Subcontractor certificate modal
  const [showSubcontractModal, setShowSubcontractModal] = useState(false);
  const [selectedSubcontractId, setSelectedSubcontractId] = useState<string>("");
  const [subcontractAmount, setSubcontractAmount] = useState<string>("");
  const [subcontractProgressPct, setSubcontractProgressPct] = useState<string>("");
  const [subcontractNotes, setSubcontractNotes] = useState("");

  // Budget Items CRUD states
  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<BudgetItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<BudgetItem | null>(null);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [showApproveMadreModal, setShowApproveMadreModal] = useState(false);
  const [isApprovingMadre, setIsApprovingMadre] = useState(false);

  // Collapsible sub-items state by Category / Chapter
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Contractual budget editor modal
  const [showEditContractBudgetModal, setShowEditContractBudgetModal] = useState(false);
  const [contractBudgetInput, setContractBudgetInput] = useState("");
  const [savingContractBudget, setSavingContractBudget] = useState(false);

  // Item Form Data for Create & Edit
  const [itemFormData, setItemFormData] = useState({
    code: "",
    name: "",
    category: "GENERAL",
    unit: "un",
    quantity: "1" as any,
    unitPrice: "0" as any,
  });

  const handleOpenCreateItem = () => {
    setItemFormData({
      code: `ITEM-${String(localBudgetItems.length + 1).padStart(2, "0")}`,
      name: "",
      category: "GENERAL",
      unit: "un",
      quantity: "1",
      unitPrice: "0",
    });
    setShowNewItemModal(true);
  };

  const handleOpenEditItem = (item: BudgetItem) => {
    setEditingItem(item);
    const q = Number(item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0);
    const p = Number(item.unitPrice || 0);
    setItemFormData({
      code: item.code,
      name: item.name,
      category: item.category || "GENERAL",
      unit: item.unit || "un",
      quantity: String(q),
      unitPrice: String(p),
    });
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra primero", "error");
      return;
    }
    if (!itemFormData.code.trim() || !itemFormData.name.trim()) {
      showToast("El código y la descripción del rubro son obligatorios", "error");
      return;
    }

    const qty = parseFlexibleNumber(itemFormData.quantity) || 0;
    const price = parseFlexibleNumber(itemFormData.unitPrice) || 0;
    const originalAmount = Math.round(qty * price);

    setSubmitting(true);
    try {
      if (editingItem) {
        const updated = await api.updateBudgetItem(editingItem.id, {
          code: itemFormData.code.trim(),
          name: itemFormData.name.trim(),
          category: itemFormData.category.trim() || "GENERAL",
          unit: itemFormData.unit.trim() || "un",
          totalQuantity: qty,
          unitPrice: price,
          originalAmount,
        });

        setLocalBudgetItems((prev) =>
          prev.map((i) => (i.id === editingItem.id ? { ...i, ...updated } : i))
        );
        showToast(`Rubro ${itemFormData.code} modificado exitosamente`);
        setEditingItem(null);
      } else {
        const created = await api.createBudgetItem({
          projectId: project.id,
          code: itemFormData.code.trim(),
          name: itemFormData.name.trim(),
          category: itemFormData.category.trim() || "GENERAL",
          unit: itemFormData.unit.trim() || "un",
          totalQuantity: qty,
          unitPrice: price,
          originalAmount,
        });

        setLocalBudgetItems((prev) => [...prev, created]);
        showToast(`Rubro ${itemFormData.code} creado exitosamente`);
        setShowNewItemModal(false);
      }
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al guardar el rubro", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setSubmitting(true);
    try {
      await api.deleteBudgetItem(itemToDelete.id);
      setLocalBudgetItems((prev) => prev.filter((i) => i.id !== itemToDelete.id));
      showToast(`Rubro ${itemToDelete.code} - ${itemToDelete.name} eliminado exitosamente`);
      setItemToDelete(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar el rubro", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmClearAll = async () => {
    if (!project?.id) return;
    setSubmitting(true);
    try {
      await api.deleteAllBudgetItems(project.id);
      setLocalBudgetItems([]);
      showToast("Se han eliminado todos los rubros del presupuesto. Podés cargar nuevos ítems o importar un Excel.");
      setShowClearAllModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al limpiar el presupuesto", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePlanillaMadre = async () => {
    if (!project?.id) return;
    if (localBudgetItems.length === 0) {
      showToast("No hay rubros en la planilla para aprobar", "error");
      return;
    }

    setIsApprovingMadre(true);
    try {
      const itemsToApprove = localBudgetItems.map((item) => ({
        code: item.code,
        name: item.name,
        category: item.category || "GENERAL",
        unit: item.unit || "un",
        quantity: Number(item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        originalAmount: Number(item.originalAmount || 0),
      }));

      const res = await api.approvePlanillaMadre(project.id, {
        items: itemsToApprove,
        markupPercent: 0,
      });

      showToast(
        `Planilla Madre oficial aprobada. Se consolidaron ${res.totalItems || localBudgetItems.length} rubros y Centros de Costos como línea base oficial de la obra.`
      );
      setShowApproveMadreModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al aprobar la Planilla Madre", "error");
    } finally {
      setIsApprovingMadre(false);
    }
  };

  // Load certifications
  const loadCertificaciones = async () => {
    if (!project?.id) return;
    setLoadingCerts(true);
    try {
      const data = await api.getCertificaciones(project.id);
      setCertificaciones(data || []);
    } catch (err: any) {
      console.error("Error loading certifications:", err);
    } finally {
      setLoadingCerts(false);
    }
  };

  useEffect(() => {
    loadCertificaciones();
  }, [project?.id]);

  useEffect(() => {
    if (initialOpenImporter) {
      setSubView("importer");
    }
  }, [initialOpenImporter]);

  // Extract unique categories from local budget items
  const categories = useMemo(() => {
    const set = new Set<string>();
    localBudgetItems.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return Array.from(set).sort();
  }, [localBudgetItems]);

  // Selected Rubro for modal calculations
  const selectedBudgetItem = localBudgetItems.find((b) => String(b.id) === selectedBudgetItemId);

  // Planned quantity for selected rubro
  const totalBudgetQty = selectedBudgetItem
    ? Number(selectedBudgetItem.totalQuantity || (selectedBudgetItem as any).plannedQuantity || (selectedBudgetItem as any).quantity || 0)
    : 0;

  // Unit price for selected rubro
  const unitPrice = selectedBudgetItem
    ? Number(
        selectedBudgetItem.unitPrice ||
          (Number(selectedBudgetItem.originalAmount) > 0 && totalBudgetQty > 0
            ? Number(selectedBudgetItem.originalAmount) / totalBudgetQty
            : 0)
      )
    : 0;

  // Previous accumulated measured quantity for this rubro
  const previousAccumulatedQty = useMemo(() => {
    if (!selectedBudgetItem) return 0;
    const certsForRubro = certificaciones.filter(
      (c) => c.budgetItemId === selectedBudgetItem.id && c.estado !== "RECHAZADA"
    );
    const sumCerts = certsForRubro.reduce((acc, c) => acc + Number(c.cantidad_medida || 0), 0);
    return Math.max(Number(selectedBudgetItem.executedQuantity || 0), sumCerts);
  }, [selectedBudgetItem, certificaciones]);

  const currentMeasuredNum = parseFloat(measuredQuantity) || 0;
  const newAccumulatedQty = previousAccumulatedQty + currentMeasuredNum;
  const newProgressPct = totalBudgetQty > 0 ? (newAccumulatedQty / totalBudgetQty) * 100 : 0;
  const newRemainingQty = Math.max(0, totalBudgetQty - newAccumulatedQty);
  const currentValuation = Math.round(currentMeasuredNum * unitPrice);

  const currentPlannedAmount = selectedBudgetItem
    ? Number(selectedBudgetItem.originalAmount || totalBudgetQty * unitPrice)
    : 0;
  const currentExecutedAmount = selectedBudgetItem
    ? Number(selectedBudgetItem.executedAmount || previousAccumulatedQty * unitPrice)
    : 0;
  const newRemainingAmount = Math.max(0, currentPlannedAmount - (currentExecutedAmount + currentValuation));

  // Evidence file upload handler
  const handleEvidenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEvidenceFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      setEvidenceUrl(String(evt.target?.result || ""));
    };
    reader.readAsDataURL(file);
  };

  // Create new custom rubro
  const handleSaveCustomRubro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRubroCode.trim() || !customRubroName.trim() || !project?.id) {
      showToast("Completá el código y la descripción del rubro", "error");
      return;
    }

    const qty = parseFloat(customRubroQty) || 1;
    const price = parseFloat(customRubroPrice) || 0;
    const orig = Math.round(qty * price);

    try {
      const created = await api.createBudgetItem({
        projectId: project.id,
        code: customRubroCode.trim(),
        name: customRubroName.trim(),
        category: customRubroCategory.trim() || "ADICIONALES",
        unit: customRubroUnit.trim() || "un",
        totalQuantity: qty,
        unitPrice: price,
        originalAmount: orig,
      });

      showToast("Nuevo rubro agregado al presupuesto base de la obra");
      await onRefresh();
      setLocalBudgetItems((prev) => [...prev, created]);
      setSelectedBudgetItemId(String(created.id));
      setShowAddCustomRubro(false);
      setCustomRubroCode("");
      setCustomRubroName("");
      setCustomRubroQty("");
      setCustomRubroPrice("");
    } catch (err: any) {
      showToast(err.message || "Error al agregar nuevo rubro", "error");
    }
  };

  // Submit certification & SUBTRACT from budget immediately
  const handleCreateCertificacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra primero", "error");
      return;
    }
    if (!selectedBudgetItemId) {
      showToast("Por favor seleccioná un rubro del presupuesto", "error");
      return;
    }
    if (currentMeasuredNum <= 0) {
      showToast("Ingresá una cantidad ejecutada / medida válida mayor a 0", "error");
      return;
    }

    setSubmitting(true);
    try {
      const certValuation = currentValuation > 0 ? currentValuation : Math.round(currentMeasuredNum * unitPrice);

      const created = await api.createCertificacion({
        projectId: project.id,
        budgetItemId: Number(selectedBudgetItemId),
        rubro: selectedBudgetItem?.name || "Certificación de Avance",
        unidad: selectedBudgetItem?.unit || "m³",
        cantidad_medida: currentMeasuredNum,
        monto_total: certValuation,
        estado: "APROBADA", // Approves and subtracts immediately
        evidencia: evidenceUrl || undefined,
        esAdenda: false,
      });

      // Update local budget items so the quantity and amount are subtracted immediately
      setLocalBudgetItems((prev) =>
        prev.map((item) => {
          if (String(item.id) === selectedBudgetItemId) {
            const currentExecQty = Number(item.executedQuantity || previousAccumulatedQty || 0);
            const currentExecAmt = Number(item.executedAmount || 0);
            return {
              ...item,
              executedQuantity: currentExecQty + currentMeasuredNum,
              executedAmount: currentExecAmt + certValuation,
            };
          }
          return item;
        })
      );

      showToast(
        `Certificación registrada. Se restaron ${currentMeasuredNum.toLocaleString("es-PY")} ${selectedBudgetItem?.unit || "un"} del rubro. Saldo restante: ${newRemainingQty.toLocaleString("es-PY")} ${selectedBudgetItem?.unit || "un"} (${formatMoney(newRemainingAmount, currency)})`
      );

      setShowNewCertModal(false);
      setSelectedBudgetItemId("");
      setMeasuredQuantity("");
      setEvidenceUrl("");
      setEvidenceFileName("");
      await loadCertificaciones();
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al registrar certificación", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: number, estado: string) => {
    try {
      await api.updateCertificacionEstado(id, estado);
      showToast(`Certificación actualizada a: ${estado}`);
      await loadCertificaciones();
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al actualizar estado", "error");
    }
  };

  const handleDeleteCert = async (id: number) => {
    if (!confirm("¿Estás seguro de anular esta certificación? Se reintegrará la cantidad al presupuesto restante."))
      return;
    try {
      await api.deleteCertificacion(id);
      showToast("Certificación anulada. Cantidades reintegradas al presupuesto base.");
      await loadCertificaciones();
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar certificación", "error");
    }
  };

  // Subcontract certificate submission
  const handleCreateSubcontractCert = async (e: React.FormEvent) => {
    e.preventDefault();
    const scId = parseInt(selectedSubcontractId);
    const amount = parseFloat(subcontractAmount);
    if (!scId || isNaN(amount) || amount <= 0) {
      showToast("Ingresá un contrato y monto válido", "error");
      return;
    }

    try {
      await api.createSubcontractCertificate({
        subcontractId: scId,
        amount,
        advancePercentage: parseFloat(subcontractProgressPct) || undefined,
        notes: subcontractNotes,
      });

      showToast("Certificado a subcontratista emitido exitosamente");
      setShowSubcontractModal(false);
      setSelectedSubcontractId("");
      setSubcontractAmount("");
      setSubcontractProgressPct("");
      setSubcontractNotes("");
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al emitir certificado", "error");
    }
  };

  // Open modal with specific rubro preselected
  const handleOpenCertifyRubro = (itemId: number) => {
    setSelectedBudgetItemId(String(itemId));
    setMeasuredQuantity("");
    setEvidenceUrl("");
    setEvidenceFileName("");
    setShowNewCertModal(true);
  };

  // Export Planilla to CSV
  const handleExportCSV = () => {
    const headers = [
      "Item",
      "Rubro",
      "Categoria",
      "Unidad",
      "Cant_Presupuestada",
      "Cant_Ejecutada",
      "Cant_Faltante",
      "Avance_Porcentaje",
      "Precio_Unitario",
      "Monto_Presupuestado",
      "Monto_Ejecutado",
      "Saldo_Faltante",
    ];

    const rows = localBudgetItems.map((item) => {
      const plannedQty = Number(item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0);
      const certsForRubro = certificaciones.filter((c) => c.budgetItemId === item.id && c.estado !== "RECHAZADA");
      const sumCerts = certsForRubro.reduce((acc, c) => acc + Number(c.cantidad_medida || 0), 0);
      const execQty = Math.max(Number(item.executedQuantity || 0), sumCerts);
      const remainingQty = Math.max(0, plannedQty - execQty);
      const progress = plannedQty > 0 ? ((execQty / plannedQty) * 100).toFixed(1) : "0";

      const plannedAmt = Number(item.originalAmount || 0);
      const uPrice = Number(item.unitPrice || (plannedQty > 0 ? plannedAmt / plannedQty : 0));
      const execAmt = Math.max(Number(item.executedAmount || 0), Math.round(execQty * uPrice));
      const remainingAmt = Math.max(0, plannedAmt - execAmt);

      return [
        `"${item.code || ""}"`,
        `"${(item.name || "").replace(/"/g, '""')}"`,
        `"${item.category || "GENERAL"}"`,
        `"${item.unit || "un"}"`,
        plannedQty,
        execQty,
        remainingQty,
        `"${progress}%"`,
        uPrice,
        plannedAmt,
        execAmt,
        remainingAmt,
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Planilla_Presupuesto_Ejecucion_${project?.code || "Obra"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Planilla exportada a CSV exitosamente");
  };

  // Filtered budget items for Planilla table
  const filteredBudgetItems = useMemo(() => {
    return localBudgetItems.filter((item) => {
      const matchSearch =
        !searchQuery.trim() ||
        (item.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.code || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = selectedCategory === "ALL" || item.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [localBudgetItems, searchQuery, selectedCategory]);

  // Overall Totals
  const overallTotals = useMemo(() => {
    let plannedAmt = 0;
    let executedAmt = 0;
    let remainingAmt = 0;

    localBudgetItems.forEach((item) => {
      const pAmt = Number(item.originalAmount || 0);
      const plannedQty = Number(item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0);
      const uPrice = Number(item.unitPrice || (plannedQty > 0 ? pAmt / plannedQty : 0));

      const certsForRubro = certificaciones.filter((c) => c.budgetItemId === item.id && c.estado !== "RECHAZADA");
      const sumCerts = certsForRubro.reduce((acc, c) => acc + Number(c.cantidad_medida || 0), 0);
      const execQty = Math.max(Number(item.executedQuantity || 0), sumCerts);

      const eAmt = Math.max(Number(item.executedAmount || 0), Math.round(execQty * uPrice));
      const rAmt = Math.max(0, pAmt - eAmt);

      plannedAmt += pAmt;
      executedAmt += eAmt;
      remainingAmt += rAmt;
    });

    const progressPct = plannedAmt > 0 ? (executedAmt / plannedAmt) * 100 : 0;

    return {
      rubrosCount: localBudgetItems.length,
      plannedAmt,
      executedAmt,
      remainingAmt,
      progressPct,
    };
  }, [localBudgetItems, certificaciones]);

  // Contractual Budget vs Planilla Sum
  const contractualBudget = Number(project?.montoContractualManual || project?.globalBudget || 0);
  const officialBudget = contractualBudget > 0 ? contractualBudget : overallTotals.plannedAmt;
  const budgetDifference = officialBudget - overallTotals.plannedAmt;
  const hasBudgetDifference = contractualBudget > 0 && Math.abs(budgetDifference) > 1;

  // Toggle Category Collapsible
  const toggleCategoryCollapse = (cat: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const expandAllCategories = () => {
    setCollapsedCategories({});
  };

  const collapseAllCategories = () => {
    const allCol: Record<string, boolean> = {};
    categories.forEach((c) => {
      allCol[c] = true;
    });
    allCol["GENERAL / SIN CAPÍTULO"] = true;
    setCollapsedCategories(allCol);
  };

  const handleOpenEditContractBudget = () => {
    const curVal = contractualBudget > 0 ? contractualBudget : overallTotals.plannedAmt;
    setContractBudgetInput(String(curVal || ""));
    setShowEditContractBudgetModal(true);
  };

  const handleSaveContractBudget = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!project?.id) return;
    const cleanNum = parseFloat(contractBudgetInput.replace(/[^0-9.-]/g, "")) || 0;
    if (cleanNum <= 0) {
      showToast("Ingresa un monto contractual válido", "error");
      return;
    }
    setSavingContractBudget(true);
    try {
      await api.updateProject(project.id, {
        montoContractualManual: cleanNum,
        globalBudget: cleanNum,
      });
      showToast(`Presupuesto oficial contractual fijado en ${formatMoney(cleanNum, currency)}`);
      setShowEditContractBudgetModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al actualizar presupuesto contractual", "error");
    } finally {
      setSavingContractBudget(false);
    }
  };

  const handleSyncContractWithPlanilla = async () => {
    if (!project?.id) return;
    setSavingContractBudget(true);
    try {
      await api.updateProject(project.id, {
        montoContractualManual: overallTotals.plannedAmt,
        globalBudget: overallTotals.plannedAmt,
      });
      showToast(
        `Presupuesto contractual sincronizado con la suma de planilla: ${formatMoney(
          overallTotals.plannedAmt,
          currency
        )}`
      );
      setShowEditContractBudgetModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al sincronizar presupuesto", "error");
    } finally {
      setSavingContractBudget(false);
    }
  };

  // Group items by Chapter / Category for Collapsible view
  interface GroupedCategory {
    name: string;
    items: BudgetItem[];
    totalPlannedQty: number;
    totalPlannedAmt: number;
    totalExecutedAmt: number;
    totalRemainingAmt: number;
    progressPct: number;
  }

  const groupedCategories: GroupedCategory[] = useMemo(() => {
    const map = new Map<string, BudgetItem[]>();
    filteredBudgetItems.forEach((item) => {
      const cat = item.category?.trim() || "GENERAL / SIN CAPÍTULO";
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(item);
    });

    const groups: GroupedCategory[] = [];
    map.forEach((items, catName) => {
      let catPlanned = 0;
      let catExec = 0;
      let catRem = 0;
      let catPlannedQty = 0;

      items.forEach((it) => {
        const pQty = Number(it.totalQuantity || (it as any).plannedQuantity || (it as any).quantity || 0);
        const pAmt = Number(it.originalAmount || 0);
        const uP = Number(it.unitPrice || (pQty > 0 ? pAmt / pQty : 0));
        const cList = certificaciones.filter((c) => c.budgetItemId === it.id && c.estado !== "RECHAZADA");
        const sCerts = cList.reduce((acc, c) => acc + Number(c.cantidad_medida || 0), 0);
        const eQty = Math.max(Number(it.executedQuantity || 0), sCerts);
        const eAmt = Math.max(Number(it.executedAmount || 0), Math.round(eQty * uP));
        const rAmt = Math.max(0, pAmt - eAmt);

        catPlannedQty += pQty;
        catPlanned += pAmt;
        catExec += eAmt;
        catRem += rAmt;
      });

      const prog = catPlanned > 0 ? (catExec / catPlanned) * 100 : 0;
      groups.push({
        name: catName,
        items,
        totalPlannedQty: catPlannedQty,
        totalPlannedAmt: catPlanned,
        totalExecutedAmt: catExec,
        totalRemainingAmt: catRem,
        progressPct: prog,
      });
    });

    return groups;
  }, [filteredBudgetItems, certificaciones]);

  // Render subview: Importer
  if (subView === "importer") {
    return (
      <ExcelBudgetImporter
        project={project}
        currency={currency}
        onBack={() => setSubView("planilla-control")}
        onImportComplete={() => {
          setSubView("planilla-control");
          onRefresh();
        }}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="space-y-4 w-full pb-14 animate-in fade-in duration-150">
      {/* Top Header & Sub-Navigation Tabs */}
      <div className="bg-white border border-slate-200 p-3 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            id="tab-planilla-control"
            onClick={() => setSubView("planilla-control")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              subView === "planilla-control"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Planilla de Control (Previsto vs. Ejecutado)</span>
          </button>

          <button
            id="tab-adendas-extras"
            onClick={() => setSubView("adendas-extras")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              subView === "adendas-extras"
                ? "bg-amber-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Rubros Extras & Adendas</span>
          </button>

          <button
            id="tab-actas-historial"
            onClick={() => setSubView("actas-historial")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              subView === "actas-historial"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Actas y Certificaciones ({certificaciones.length})</span>
          </button>

          <button
            id="tab-subcontratistas"
            onClick={() => setSubView("subcontratistas")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              subView === "subcontratistas"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Subcontratistas (Calendario & Lista)</span>
          </button>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            id="btn-import-excel-tab"
            onClick={() => setSubView("importer")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold transition"
          >
            <Upload className="w-3.5 h-3.5 text-sky-600" />
            <span>Importar Planilla Excel</span>
          </button>

          <button
            id="btn-open-new-cert-direct"
            onClick={() => {
              setSelectedBudgetItemId("");
              setMeasuredQuantity("");
              setEvidenceUrl("");
              setEvidenceFileName("");
              setShowNewCertModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-xs active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Certificación</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: THE CORE REQUESTED DATABASE / PLANILLA DE CONTROL (PREVISTO VS EJECUTADO) */}
      {subView === "planilla-control" && (
        <div className="space-y-4">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Total Rubros */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Total Rubros
              </span>
              <p className="text-xl font-mono font-extrabold text-slate-800 mt-1">
                {overallTotals.rubrosCount}
              </p>
              <span className="text-[11px] text-slate-500 font-medium">
                {categories.length} Capítulos / Grupos
              </span>
            </div>

            {/* Presupuesto Contractual Oficial */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative group">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider block">
                  Presupuesto Oficial
                </span>
                <button
                  type="button"
                  onClick={handleOpenEditContractBudget}
                  title="Modificar presupuesto contractual oficial"
                  className="text-slate-400 hover:text-sky-600 p-0.5 rounded transition"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-base font-mono font-extrabold text-sky-700 mt-1 truncate">
                {formatMoney(officialBudget, currency)}
              </p>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Planilla: {formatMoney(overallTotals.plannedAmt, currency)}</span>
                {hasBudgetDifference && (
                  <button
                    type="button"
                    onClick={handleSyncContractWithPlanilla}
                    className="text-amber-600 hover:text-amber-800 font-bold underline"
                    title="Alinear presupuesto oficial con la suma de los rubros"
                  >
                    Alinear
                  </button>
                )}
              </div>
            </div>

            {/* Monto Ejecutado */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Monto Ejecutado
              </span>
              <p className="text-base font-mono font-extrabold text-emerald-700 mt-1 truncate">
                {formatMoney(overallTotals.executedAmt, currency)}
              </p>
              <span className="text-[11px] text-emerald-600 font-medium">
                Certificado acumulado
              </span>
            </div>

            {/* Saldo Faltante */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Saldo Faltante
              </span>
              <p className="text-base font-mono font-extrabold text-amber-700 mt-1 truncate">
                {formatMoney(overallTotals.remainingAmt, currency)}
              </p>
              <span className="text-[11px] text-amber-600 font-medium">
                Restante contractual
              </span>
            </div>

            {/* Avance Físico Global */}
            <div className="col-span-2 sm:col-span-2 lg:col-span-1 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    Avance Físico Global
                  </span>
                  <span className="text-xs font-mono font-extrabold text-emerald-600">
                    {overallTotals.progressPct.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 mt-2 overflow-hidden border border-slate-200">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(1, overallTotals.progressPct))}%` }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-slate-500 font-medium mt-1">
                Ponderado s/ presupuesto
              </span>
            </div>
          </div>

          {/* Filter, Search & Export Bar */}
          <div className="bg-white border border-slate-200 p-3 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 w-full sm:w-auto flex-1">
              {/* Search Box */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar por rubro o código (ej. Hormigón, 01.04)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-7 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-sky-500 focus:bg-white transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Category Dropdown */}
              {categories.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500 transition"
                  >
                    <option value="ALL">Todos los Capítulos ({localBudgetItems.length})</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Desplegar / Plegar Todos los Sub-ítems */}
              <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                <button
                  type="button"
                  onClick={expandAllCategories}
                  title="Desplegar todos los sub-ítems de cada capítulo"
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition whitespace-nowrap"
                >
                  Desplegar Todos
                </button>
                <button
                  type="button"
                  onClick={collapseAllCategories}
                  title="Plegar sub-ítems para ver solo capítulos"
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition whitespace-nowrap"
                >
                  Plegar Todos
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                id="btn-add-item-direct"
                onClick={handleOpenCreateItem}
                title="Crear un nuevo rubro o partida manualmente"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Nuevo Rubro</span>
              </button>

              <button
                id="btn-approve-madre-header"
                onClick={() => setShowApproveMadreModal(true)}
                title="Fijar y Aprobar la Planilla Madre Oficial para la obra"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-300" />
                <span>Aprobar Planilla Madre</span>
              </button>

              <button
                id="btn-clear-budget-header"
                onClick={() => setShowClearAllModal(true)}
                title="Vaciar todos los rubros para empezar de cero"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 border border-slate-300 hover:border-rose-300 text-slate-600 hover:text-rose-600 text-xs font-semibold transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Limpiar Todo</span>
              </button>

              <button
                onClick={handleExportCSV}
                title="Exportar planilla a Excel/CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold transition"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Database / Planilla Table with Collapsible Sub-Items & Wide View */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs w-full">
            <div className="overflow-x-auto max-h-[660px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-300 sticky top-0 z-20 shadow-xs">
                  <tr>
                    <th className="p-3 w-12 text-center"></th>
                    <th className="p-3 w-20 text-center">ÍTEM</th>
                    <th className="p-3 min-w-[240px]">RUBRO / DESCRIPCIÓN DE TRABAJOS</th>
                    <th className="p-3 text-center w-16">UNIDAD</th>
                    <th className="p-3 text-right bg-slate-200/50">CANT. PREVISTA</th>
                    <th className="p-3 text-right bg-emerald-50 text-emerald-800">CANT. EJECUTADA</th>
                    <th className="p-3 text-right bg-amber-50 text-amber-800">CANT. FALTANTE</th>
                    <th className="p-3 text-center min-w-[130px]">% AVANCE</th>
                    <th className="p-3 text-right">PRECIO UNITARIO</th>
                    <th className="p-3 text-right bg-slate-200/50">PRESUPUESTO</th>
                    <th className="p-3 text-right bg-emerald-50 text-emerald-800">EJECUTADO</th>
                    <th className="p-3 text-right bg-amber-50 text-amber-800">SALDO FALTANTE</th>
                    <th className="p-3 text-center sticky right-0 bg-slate-100 shadow-l min-w-[140px]">
                      ACCIONES
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700 font-medium">
                  {filteredBudgetItems.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="p-10 text-center text-slate-400">
                        {searchQuery || selectedCategory !== "ALL"
                          ? "No hay rubros que coincidan con la búsqueda."
                          : "No hay rubros en el presupuesto. Importá un archivo Excel para comenzar."}
                      </td>
                    </tr>
                  ) : (
                    groupedCategories.map((group) => {
                      const isCollapsed = Boolean(collapsedCategories[group.name]);

                      return (
                        <React.Fragment key={group.name}>
                          {/* CATEGORY / CHAPTER ACCORDION HEADER ROW */}
                          <tr
                            onClick={() => toggleCategoryCollapse(group.name)}
                            className="bg-slate-100/90 hover:bg-slate-200/70 border-y border-slate-300/80 cursor-pointer select-none transition group"
                          >
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                className="p-1 rounded text-slate-600 hover:text-slate-900 transition"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="w-4 h-4 text-slate-600" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-800" />
                                )}
                              </button>
                            </td>
                            <td colSpan={2} className="p-2.5">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-slate-900 uppercase tracking-wide text-xs">
                                  {group.name}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700 border border-slate-300">
                                  {group.items.length} sub-ítems
                                </span>
                                {isCollapsed && (
                                  <span className="text-[10px] text-sky-700 font-semibold italic">
                                    (clic para desplegar)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 text-center text-[10px] uppercase font-bold text-slate-500">
                              CAPÍTULO
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-slate-700 bg-slate-200/40">
                              {/* Subtotal planned qty if unified or dash */}
                              —
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-800 bg-emerald-100/40">
                              —
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-amber-800 bg-amber-100/40">
                              —
                            </td>
                            {/* Chapter Progress */}
                            <td className="p-2.5 text-center">
                              <div className="w-full max-w-[120px] mx-auto">
                                <div className="flex justify-between text-[10px] font-mono mb-0.5">
                                  <span className="text-slate-600 font-semibold">Avance</span>
                                  <span className="font-bold text-emerald-700">
                                    {group.progressPct.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="bg-emerald-600 h-full transition-all duration-300"
                                    style={{ width: `${Math.min(100, Math.max(1, group.progressPct))}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="p-2.5 text-right font-mono text-slate-500">—</td>
                            {/* Chapter Totals */}
                            <td className="p-2.5 text-right font-mono font-extrabold text-slate-900 bg-slate-200/40 whitespace-nowrap">
                              {formatMoney(group.totalPlannedAmt, currency)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-extrabold text-emerald-800 bg-emerald-100/40 whitespace-nowrap">
                              {formatMoney(group.totalExecutedAmt, currency)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-extrabold text-amber-800 bg-amber-100/40 whitespace-nowrap">
                              {formatMoney(group.totalRemainingAmt, currency)}
                            </td>
                            <td className="p-2.5 text-center sticky right-0 bg-slate-100/90 text-[11px] font-semibold text-sky-700">
                              {isCollapsed ? "Desplegar ▾" : "Plegar ▴"}
                            </td>
                          </tr>

                          {/* SUB-ITEMS ROWS (WHEN NOT COLLAPSED) */}
                          {!isCollapsed &&
                            group.items.map((item) => {
                              const plannedQty = Number(
                                item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0
                              );

                              // Calculate executed quantity from certifications and item field
                              const certsForRubro = certificaciones.filter(
                                (c) => c.budgetItemId === item.id && c.estado !== "RECHAZADA"
                              );
                              const sumCerts = certsForRubro.reduce(
                                (acc, c) => acc + Number(c.cantidad_medida || 0),
                                0
                              );
                              const execQty = Math.max(Number(item.executedQuantity || 0), sumCerts);

                              // Calculated Remaining Quantity
                              const remainingQty = Math.max(0, plannedQty - execQty);
                              const progressPct = plannedQty > 0 ? (execQty / plannedQty) * 100 : 0;

                              // Financial figures
                              const plannedAmt = Number(item.originalAmount || 0);
                              const uPrice = Number(
                                item.unitPrice || (plannedQty > 0 ? plannedAmt / plannedQty : 0)
                              );
                              const execAmt = Math.max(
                                Number(item.executedAmount || 0),
                                Math.round(execQty * uPrice)
                              );
                              const remainingAmt = Math.max(0, plannedAmt - execAmt);

                              const isFullyExecuted = plannedQty > 0 && remainingQty <= 0;

                              return (
                                <tr
                                  key={item.id}
                                  className="hover:bg-sky-50/60 transition bg-white border-b border-slate-100"
                                >
                                  {/* Sub-item bullet indicator */}
                                  <td className="p-2 text-center text-slate-300 font-mono text-[10px]">
                                    ↳
                                  </td>

                                  {/* Item Code */}
                                  <td className="p-2.5 font-mono font-bold text-sky-700 text-center whitespace-nowrap">
                                    {item.code || `R-${item.id}`}
                                  </td>

                                  {/* Rubro Name & Category */}
                                  <td className="p-2.5 min-w-[240px]">
                                    <p className="font-semibold text-slate-900 leading-snug">{item.name}</p>
                                  </td>

                                  {/* Unit */}
                                  <td className="p-2.5 text-center">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                      {item.unit || "un"}
                                    </span>
                                  </td>

                                  {/* Planned / Budgeted Quantity */}
                                  <td className="p-2.5 text-right font-mono font-bold text-slate-800 bg-slate-50/70 whitespace-nowrap">
                                    {plannedQty.toLocaleString("es-PY")}
                                  </td>

                                  {/* Executed Quantity */}
                                  <td className="p-2.5 text-right font-mono font-bold text-emerald-700 bg-emerald-50/50 whitespace-nowrap">
                                    {execQty.toLocaleString("es-PY")}
                                  </td>

                                  {/* Remaining / Missing Quantity (Faltante) */}
                                  <td className="p-2.5 text-right font-mono font-bold bg-amber-50/50 whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs inline-block ${
                                        isFullyExecuted
                                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          : remainingQty < plannedQty * 0.25
                                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                                          : "text-amber-700 font-semibold"
                                      }`}
                                    >
                                      {isFullyExecuted
                                        ? "0 (Completado)"
                                        : remainingQty.toLocaleString("es-PY")}
                                    </span>
                                  </td>

                                  {/* Progress bar */}
                                  <td className="p-2.5 text-center">
                                    <div className="w-full max-w-[120px] mx-auto">
                                      <div className="flex justify-between text-[10px] font-mono mb-1">
                                        <span className="text-slate-500">Avance</span>
                                        <span
                                          className={`font-bold ${
                                            isFullyExecuted ? "text-emerald-700" : "text-slate-800"
                                          }`}
                                        >
                                          {progressPct.toFixed(1)}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div
                                          className={`h-full transition-all duration-300 ${
                                            isFullyExecuted ? "bg-emerald-600" : "bg-emerald-500"
                                          }`}
                                          style={{
                                            width: `${Math.min(100, Math.max(1, progressPct))}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>

                                  {/* Unit Price */}
                                  <td className="p-2.5 text-right font-mono font-semibold text-slate-700 whitespace-nowrap">
                                    {formatMoney(uPrice, currency)}
                                  </td>

                                  {/* Planned Amount */}
                                  <td className="p-2.5 text-right font-mono font-bold text-slate-800 bg-slate-50/70 whitespace-nowrap">
                                    {formatMoney(plannedAmt, currency)}
                                  </td>

                                  {/* Executed Amount */}
                                  <td className="p-2.5 text-right font-mono font-extrabold text-emerald-700 bg-emerald-50/50 whitespace-nowrap">
                                    {formatMoney(execAmt, currency)}
                                  </td>

                                  {/* Remaining Monetary Amount */}
                                  <td className="p-2.5 text-right font-mono font-extrabold text-amber-700 bg-amber-50/50 whitespace-nowrap">
                                    {formatMoney(remainingAmt, currency)}
                                  </td>

                                  {/* Row Actions: Edit, Delete, Certify */}
                                  <td className="p-2 text-center sticky right-0 bg-white group-hover:bg-sky-50/60 transition shadow-l">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        id={`btn-edit-rubro-${item.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenEditItem(item);
                                        }}
                                        title="Editar datos, unidad, precio y cantidad del rubro"
                                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sky-700 hover:text-sky-900 border border-slate-200 transition shadow-xs"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>

                                      <button
                                        id={`btn-delete-rubro-${item.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setItemToDelete(item);
                                        }}
                                        title="Eliminar este rubro del presupuesto"
                                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 border border-slate-200 transition shadow-xs"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>

                                      <button
                                        id={`btn-certify-rubro-${item.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenCertifyRubro(item.id);
                                        }}
                                        title="Medir y certificar avance físico"
                                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition flex items-center gap-1 whitespace-nowrap shadow-xs"
                                      >
                                        <span>✍️ Certificar</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Planilla Footer */}
            <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-3">
                <span>
                  Mostrando <strong className="text-slate-900">{filteredBudgetItems.length}</strong> de{" "}
                  <strong className="text-slate-900">{localBudgetItems.length}</strong> rubros en{" "}
                  <strong className="text-slate-900">{groupedCategories.length}</strong> capítulos
                </span>
                <span>·</span>
                <span className="text-emerald-700 font-semibold">
                  Cantidad faltante se descuenta de forma automática al registrar certificaciones
                </span>
              </div>

              <div className="flex items-center gap-3 font-mono">
                <span>
                  Total Planilla Madre:{" "}
                  <strong className="text-slate-900">{formatMoney(overallTotals.plannedAmt, currency)}</strong>
                </span>
                <span>|</span>
                <span>
                  Total Ejecutado:{" "}
                  <strong className="text-emerald-700">{formatMoney(overallTotals.executedAmt, currency)}</strong>
                </span>
                <span>|</span>
                <span>
                  Saldo Faltante:{" "}
                  <strong className="text-amber-700">{formatMoney(overallTotals.remainingAmt, currency)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: HISTORIAL DE ACTAS Y CERTIFICACIONES EMITIDAS */}
      {subView === "actas-historial" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-wide flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-blue-600" />
                Historial de Actas y Certificaciones de Avance de Obra
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mediciones cargadas con fotoverificación que han restado cantidades del presupuesto base.
              </p>
            </div>

            <button
              onClick={() => {
                setSelectedBudgetItemId("");
                setMeasuredQuantity("");
                setEvidenceUrl("");
                setEvidenceFileName("");
                setShowNewCertModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Generar Nueva Certificación</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Nº ACTA / CERT.</th>
                    <th className="p-3.5">RUBRO CERTIFICADO</th>
                    <th className="p-3.5 text-right">CANTIDAD MEDIDA</th>
                    <th className="p-3.5 text-right">MONTO TOTAL</th>
                    <th className="p-3.5 text-center">ESTADO</th>
                    <th className="p-3.5 text-center">EVIDENCIA</th>
                    <th className="p-3.5 text-right">ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {certificaciones.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400">
                        No hay certificaciones registradas aún en esta obra.
                      </td>
                    </tr>
                  ) : (
                    certificaciones.map((cert) => {
                      const isApproved = cert.estado === "APROBADA";
                      const isReview = cert.estado === "EN_REVISION";

                      return (
                        <tr key={cert.id} className="hover:bg-blue-50/30 transition">
                          <td className="p-3.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                            CERT-{String(cert.id).padStart(5, "0")}
                          </td>
                          <td className="p-3.5">
                            <p className="font-semibold text-slate-900">{cert.rubro}</p>
                            <span className="text-[10px] text-slate-500">
                              {cert.createdAt
                                ? new Date(cert.createdAt).toLocaleDateString("es-PY")
                                : "Reciente"}
                            </span>
                          </td>
                          <td className="p-3.5 text-right font-mono font-bold text-slate-900">
                            {cert.cantidad_medida.toLocaleString("es-PY")} {cert.unidad || "m³"}
                          </td>
                          <td className="p-3.5 text-right font-mono font-extrabold text-blue-700 whitespace-nowrap">
                            {formatMoney(cert.monto_total, currency)}
                          </td>
                          <td className="p-3.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                                isApproved
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : isReview
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-slate-100 text-slate-600 border border-slate-200"
                              }`}
                            >
                              {isApproved ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  Aprobada
                                </>
                              ) : isReview ? (
                                <>
                                  <Clock className="w-3 h-3" />
                                  En Revisión
                                </>
                              ) : (
                                cert.estado
                              )}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            {cert.evidencia ? (
                              <a
                                href={cert.evidencia}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-blue-700 text-[11px] font-semibold transition"
                              >
                                <ImageIcon className="w-3 h-3" />
                                Ver Foto
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-400">Sin foto</span>
                            )}
                          </td>
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isReview && (
                                <button
                                  onClick={() => handleUpdateStatus(cert.id, "APROBADA")}
                                  title="Aprobar certificación"
                                  className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteCert(cert.id)}
                                title="Anular y reintegrar al presupuesto"
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer"
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
        </div>
      )}

      {/* VIEW: RUBROS EXTRAS & ADENDAS */}
      {subView === "adendas-extras" && (
        <RubrosExtrasTab
          project={project}
          budgetItems={localBudgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {/* VIEW: SUBCONTRATISTAS (CALENDARIO & LISTA DE SUBCONTRATISTAS) */}
      {subView === "subcontratistas" && (
        <SubcontractorsScheduleTab
          partners={partners}
          subcontracts={subcontracts}
          budgetItems={localBudgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
          onSelectSubcontractForCert={(sc) => {
            setSelectedSubcontractId(String(sc.id));
            setShowSubcontractModal(true);
          }}
        />
      )}

      {/* MODAL: NUEVA CERTIFICACIÓN (ALLOWS CHOOSING RUBRO, INPUTTING MEASUREMENT & SUBTRACTING FROM BUDGET) */}
      {showNewCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full p-6 text-slate-900 relative my-8">
            {/* Close button */}
            <button
              onClick={() => setShowNewCertModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 block">
                NUEVA CERTIFICACIÓN DE OBRA
              </span>
              <h2 className="text-base font-bold text-slate-900 tracking-wide mt-0.5">
                Medición y Descuento del Presupuesto
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Elegí el rubro, determiná la cantidad ejecutada y se restará automáticamente del presupuesto restante.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateCertificacion} className="mt-5 space-y-4">
              {/* Field 1: Buscar o seleccionar Rubro */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Elegir Rubro del Presupuesto
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomRubro(!showAddCustomRubro)}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition flex items-center gap-1 cursor-pointer"
                  >
                    ¿No figura en la planilla? <span className="underline">+ Agregar Rubro</span>
                  </button>
                </div>

                <select
                  id="select-rubro-dropdown"
                  value={selectedBudgetItemId}
                  onChange={(e) => setSelectedBudgetItemId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none transition cursor-pointer"
                >
                  <option value="">-- Seleccionar Rubro a Certificar --</option>
                  {localBudgetItems.map((item) => {
                    const pQty = Number(
                      item.totalQuantity || (item as any).plannedQuantity || (item as any).quantity || 0
                    );
                    const eQty = Number(item.executedQuantity || 0);
                    const rem = Math.max(0, pQty - eQty);

                    return (
                      <option key={item.id} value={item.id}>
                        {item.code ? `[${item.code}] ` : ""}
                        {item.name} — Previsto: {pQty.toLocaleString("es-PY")} {item.unit || "un"} (Resta:{" "}
                        {rem.toLocaleString("es-PY")})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Inline form to add custom rubro if requested */}
              {showAddCustomRubro && (
                <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200 space-y-2.5 text-xs animate-in fade-in">
                  <span className="font-bold text-blue-900 block">
                    Registrar Nuevo Rubro en Presupuesto:
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Código (ej. 01.06)"
                      value={customRubroCode}
                      onChange={(e) => setCustomRubroCode(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Categoría (ej. ESTRUCTURAS)"
                      value={customRubroCategory}
                      onChange={(e) => setCustomRubroCategory(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Descripción detallada del trabajo..."
                    value={customRubroName}
                    onChange={(e) => setCustomRubroName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Unidad (m³, un)"
                      value={customRubroUnit}
                      onChange={(e) => setCustomRubroUnit(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Cant. Prevista"
                      value={customRubroQty}
                      onChange={(e) => setCustomRubroQty(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                    <input
                      type="number"
                      placeholder="P. Unitario (₲)"
                      value={customRubroPrice}
                      onChange={(e) => setCustomRubroPrice(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddCustomRubro(false)}
                      className="px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCustomRubro}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                    >
                      Guardar y Seleccionar
                    </button>
                  </div>
                </div>
              )}

              {/* Live Info Card of the chosen rubro */}
              {selectedBudgetItem && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Cantidad Presupuestada (Prevista):</span>
                    <span className="font-mono font-bold text-slate-900">
                      {totalBudgetQty.toLocaleString("es-PY")} {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600">
                    <span>Cantidad Ya Ejecutada Acumulada:</span>
                    <span className="font-mono font-semibold text-emerald-700">
                      {previousAccumulatedQty.toLocaleString("es-PY")} {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600">
                    <span>Cantidad Faltante Actual (Antes de este acta):</span>
                    <span className="font-mono font-bold text-amber-700">
                      {Math.max(0, totalBudgetQty - previousAccumulatedQty).toLocaleString("es-PY")}{" "}
                      {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200">
                    <span>Precio Unitario:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatMoney(unitPrice, currency)} / {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>
                </div>
              )}

              {/* Field 2: Cantidad a Certificar / Medida en esta Acta */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Cantidad a Certificar (Medición de este Acta)
                </label>
                <div className="relative">
                  <input
                    id="measured-quantity-input"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={measuredQuantity}
                    onChange={(e) => setMeasuredQuantity(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-slate-900 outline-none transition"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-500">
                    {selectedBudgetItem?.unit || "m³"}
                  </span>
                </div>
              </div>

              {/* Dynamic Calculation of Remaining Quantity & Balance (Restando del Presupuesto) */}
              {selectedBudgetItem && currentMeasuredNum > 0 && (
                <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-2 text-xs animate-in fade-in">
                  <div className="flex items-center justify-between text-blue-900 font-bold">
                    <span>⚡ Impacto en Presupuesto:</span>
                    <span className="text-[11px] font-mono text-blue-700">Descuento automático</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span>Nueva Cantidad Ejecutada:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {newAccumulatedQty.toLocaleString("es-PY")} {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span>Nueva Cantidad Faltante que Quedará:</span>
                    <span className="font-mono font-extrabold text-amber-700 text-sm">
                      {newRemainingQty.toLocaleString("es-PY")} {selectedBudgetItem.unit || "un"}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="pt-1">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-500">Nuevo Avance Físico:</span>
                      <span className="font-mono font-bold text-blue-700">
                        {newProgressPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(1, newProgressPct))}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-blue-200">
                    <span className="font-bold text-slate-900">Monto de esta Medición:</span>
                    <span className="font-mono font-extrabold text-blue-700 text-sm">
                      {formatMoney(currentValuation, currency)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span>Nuevo Saldo Presupuestario Faltante:</span>
                    <span className="font-mono font-bold text-amber-700">
                      {formatMoney(newRemainingAmount, currency)}
                    </span>
                  </div>
                </div>
              )}

              {/* Field 3: Subir Fotografía / Evidencia */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Fotografía / Evidencia de Obra (Opcional)
                </label>
                <label
                  htmlFor="cert-evidence-file"
                  className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer bg-slate-50 hover:bg-blue-50/30 transition"
                >
                  <input
                    id="cert-evidence-file"
                    type="file"
                    accept="image/*"
                    onChange={handleEvidenceUpload}
                    className="hidden"
                  />

                  {evidenceUrl ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <img
                        src={evidenceUrl}
                        alt="Evidencia"
                        className="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-xs"
                      />
                      <span className="text-[11px] text-blue-700 font-semibold">
                        ✓ {evidenceFileName || "Foto adjunta cargada"}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Hacé clic para cambiar de foto
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-center">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 mb-1.5">
                        <Camera className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-slate-700">
                        Arrastrá una imagen o haz clic para seleccionar
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Fotografía del trabajo ejecutado en faena
                      </span>
                    </div>
                  )}
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewCertModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-submit-cert"
                  type="submit"
                  disabled={submitting || !selectedBudgetItemId || currentMeasuredNum <= 0}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Guardando y Descontando..." : "Registrar y Descontar del Presupuesto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Certificado a Subcontratista */}
      {showSubcontractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-slate-900 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Nuevo Certificado a Subcontratista</h3>
            <p className="text-xs text-slate-500 mt-1">Registrar avance o acta de medición de tercero.</p>

            <form onSubmit={handleCreateSubcontractCert} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="text-slate-700 font-bold block mb-1">Contrato de Subcontratista:</label>
                <select
                  value={selectedSubcontractId}
                  onChange={(e) => setSelectedSubcontractId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:border-blue-500 outline-none cursor-pointer"
                >
                  <option value="">-- Seleccionar Contrato --</option>
                  {subcontracts.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.number} - {sc.partner?.name} ({formatMoney(Number(sc.contractAmount), currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-700 font-bold block mb-1">Monto a Certificar (₲):</label>
                <input
                  type="number"
                  value={subcontractAmount}
                  onChange={(e) => setSubcontractAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-700 font-bold block mb-1">% Avance Físico:</label>
                <input
                  type="number"
                  value={subcontractProgressPct}
                  onChange={(e) => setSubcontractProgressPct(e.target.value)}
                  placeholder="ej. 25"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-700 font-bold block mb-1">Observaciones / Notas:</label>
                <textarea
                  rows={2}
                  value={subcontractNotes}
                  onChange={(e) => setSubcontractNotes(e.target.value)}
                  placeholder="Período de medición, frentes atendidos..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:border-blue-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubcontractModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-xs cursor-pointer"
                >
                  Emitir Certificado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: NUEVO O EDITAR RUBRO DEL PRESUPUESTO */}
      {(showNewItemModal || editingItem !== null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-sky-50 text-sky-700 rounded-xl border border-sky-200">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingItem ? `Editar Rubro: ${editingItem.code}` : "Crear Nuevo Rubro / Partida"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingItem
                      ? "Modificá los datos, cantidades previstas y precios del rubro"
                      : "Agregá un nuevo ítem a la planilla madre de la obra"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowNewItemModal(false);
                  setEditingItem(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-slate-700 font-semibold mb-1">
                    Código de Ítem: <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={itemFormData.code}
                    onChange={(e) => setItemFormData({ ...itemFormData, code: e.target.value })}
                    placeholder="Ej. 01.01"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-mono outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-700 font-semibold mb-1">
                    Capítulo / Centro de Costos:
                  </label>
                  <input
                    type="text"
                    value={itemFormData.category}
                    onChange={(e) => setItemFormData({ ...itemFormData, category: e.target.value })}
                    placeholder="Ej. ESTRUCTURA, PAVIMENTO, MOV. SUELOS"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-sky-500 focus:bg-white uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Descripción / Rubro de Obra: <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={itemFormData.name}
                  onChange={(e) => setItemFormData({ ...itemFormData, name: e.target.value })}
                  placeholder="Ej. Hormigón elaborado H21 para calzada..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-sky-500 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Unidad de Medida:
                  </label>
                  <select
                    value={itemFormData.unit}
                    onChange={(e) => setItemFormData({ ...itemFormData, unit: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-slate-800 outline-none focus:border-sky-500 focus:bg-white"
                  >
                    <option value="m³">m³ (Metro cúbico)</option>
                    <option value="m²">m² (Metro cuadrado)</option>
                    <option value="ml">ml (Metro lineal)</option>
                    <option value="kg">kg (Kilogramo)</option>
                    <option value="tn">tn (Tonelada)</option>
                    <option value="un">un (Unidad)</option>
                    <option value="gl">gl (Global)</option>
                    <option value="mes">mes (Mensual)</option>
                    <option value="hs">hs (Horas)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Cantidad Prevista: <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={itemFormData.quantity}
                    onChange={(e) => setItemFormData({ ...itemFormData, quantity: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-mono outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Precio Unitario ({currency}):
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={itemFormData.unitPrice}
                    onChange={(e) => setItemFormData({ ...itemFormData, unitPrice: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-mono outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Subtotal preview */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between font-mono">
                <span className="text-slate-500 font-sans text-xs">Monto Total Presupuestado:</span>
                <span className="text-sm font-bold text-sky-700">
                  {formatMoney(
                    (Number(itemFormData.quantity) || 0) * (Number(itemFormData.unitPrice) || 0),
                    currency
                  )}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewItemModal(false);
                    setEditingItem(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 transition font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold transition shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Guardando..." : editingItem ? "Guardar Cambios" : "Crear Rubro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRMAR ELIMINAR RUBRO ESPECÍFICO */}
      {itemToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-rose-200 rounded-2xl w-full max-w-md p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Eliminar este rubro?</h3>
                <p className="text-xs text-slate-500">Esta acción removerá el ítem de la planilla de presupuesto.</p>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
              <p className="font-bold text-slate-900">
                <span className="font-mono text-amber-600 mr-1">[{itemToDelete.code}]</span>
                {itemToDelete.name}
              </p>
              <div className="flex items-center justify-between text-slate-500 text-[11px] pt-1">
                <span>Capítulo: {itemToDelete.category || "GENERAL"}</span>
                <span>Unidad: {itemToDelete.unit || "un"}</span>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Podrás volver a crearlo manualmente o importar una planilla nueva en cualquier momento.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDeleteItem}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                {submitting ? "Eliminando..." : "Sí, Eliminar Rubro"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: VACIAR / LIMPIAR TODO EL PRESUPUESTO */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-amber-200 rounded-2xl w-full max-w-md p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl border border-amber-200">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Limpiar todo el presupuesto?</h3>
                <p className="text-xs text-slate-500">Se eliminarán los {localBudgetItems.length} rubros cargados.</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900">
              Esta función te permite quitar todos los rubros actuales para dejar la base completamente limpia y cargar tus propios ítems o importar tu planilla Excel madre.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmClearAll}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                {submitting ? "Limpiando..." : "Sí, Limpiar Todo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: APROBAR PLANILLA MADRE OFICIAL */}
      {showApproveMadreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-purple-200 rounded-2xl w-full max-w-lg p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl border border-purple-200">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Aprobar Planilla Madre Oficial</h3>
                <p className="text-xs text-slate-500">Consolidación de rubros y centros de costos como línea base.</p>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">
                ¿Deseás fijar estos <span className="text-purple-700 font-bold">{localBudgetItems.length} rubros</span> como la Planilla Madre Oficial de la obra?
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 text-[11px]">
                <li>Se fijan las <strong className="text-slate-800">cantidades previstas contractuales</strong> y precios unitarios.</li>
                <li>El módulo de <strong className="text-slate-800">Certificaciones de Obra</strong> estirará estos ítems y restará automáticamente las cantidades ejecutadas.</li>
                <li>Los <strong className="text-slate-800">Centros de Costos</strong> y pedidos de materiales quedarán vinculados a esta planilla madre.</li>
              </ul>
              <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between items-center text-xs font-mono">
                <span className="text-slate-500">Presupuesto Previsto Consolidado:</span>
                <span className="text-emerald-700 font-extrabold">{formatMoney(overallTotals.plannedAmt, currency)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowApproveMadreModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isApprovingMadre}
                onClick={handleApprovePlanillaMadre}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-xs flex items-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isApprovingMadre ? "Aprobando Planilla Madre..." : "Aprobar y Fijar como Planilla Madre"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: MODIFICAR PRESUPUESTO CONTRACTUAL OFICIAL (EL USUARIO PUEDE CARGAR EL QUE QUIERA) */}
      {showEditContractBudgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-50 text-sky-700 rounded-xl border border-sky-200">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Presupuesto Contractual</h3>
                  <p className="text-xs text-slate-500">Configurá el monto de presupuesto oficial del proyecto</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditContractBudgetModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1.5">
                  Monto Contractual Oficial ({currency}):
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={contractBudgetInput}
                  onChange={(e) => setContractBudgetInput(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono font-bold text-slate-900 outline-none focus:border-sky-500 focus:bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Podés ingresar cualquier monto contractual que desees para este proyecto.
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between text-slate-600">
                  <span>Suma actual de la planilla:</span>
                  <span className="font-bold text-slate-900">{formatMoney(overallTotals.plannedAmt, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Cantidad de rubros:</span>
                  <span>{localBudgetItems.length} rubros</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setContractBudgetInput(String(overallTotals.plannedAmt));
                }}
                className="px-3 py-2 rounded-xl text-sky-700 hover:bg-sky-50 text-xs font-semibold transition"
              >
                Usar suma de planilla
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditContractBudgetModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingContractBudget}
                  onClick={handleSaveContractBudget}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
                >
                  {savingContractBudget ? "Guardando..." : "Guardar Presupuesto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
