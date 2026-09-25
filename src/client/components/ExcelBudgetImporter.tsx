import React, { useState, useRef, useMemo } from "react";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Layers,
  HelpCircle,
  Clipboard,
  Link2,
  Table,
  Sliders,
  Percent,
  Check,
  X,
  FileCheck,
  ChevronDown,
  ChevronRight,
  Filter,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";
import { api } from "../api";
import { Project } from "../types";
import { formatMoney } from "../utils/format";
import {
  BudgetImportPreview,
  CanonicalColumnRole,
  ParsedItemRow,
  SheetStructure,
  ValidationIssue,
} from "../../modules/budgets/engine/types";

interface ExcelBudgetImporterProps {
  project?: Project | null;
  currency: "PYG" | "USD";
  onBack: () => void;
  onImportComplete: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type WizardStep = 1 | 2 | 3 | 4;

const ROLE_LABELS: Record<CanonicalColumnRole, { label: string; color: string; desc: string }> = {
  code: {
    label: "Código / Ítem",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    desc: "Identificador jerárquico (ej. 1.1, EST-01)",
  },
  description: {
    label: "Descripción / Rubro",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    desc: "Nombre o descripción de los trabajos",
  },
  unit: {
    label: "Unidad",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    desc: "Unidad de medida (m², m³, un, kg, etc.)",
  },
  quantity: {
    label: "Cantidad / Metrado",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    desc: "Volumen o cómputo métrico",
  },
  unitPrice: {
    label: "Precio Unitario",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    desc: "Costo unitario sin impuestos o contractual",
  },
  totalPrice: {
    label: "Precio Total",
    color: "bg-rose-50 text-rose-700 border-rose-200",
    desc: "Monto total del ítem (Cantidad × P.U.)",
  },
  ignore: {
    label: "Ignorar Columna",
    color: "bg-stone-50 text-stone-500 border-stone-200",
    desc: "No procesar esta columna",
  },
};

export const ExcelBudgetImporter: React.FC<ExcelBudgetImporterProps> = ({
  project,
  currency,
  onBack,
  onImportComplete,
  showToast,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState<boolean>(false);

  // Input States
  const [uploadSource, setUploadSource] = useState<"file" | "paste" | "google">("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>("");
  const [googleUrl, setGoogleUrl] = useState<string>("");

  // Preview State
  const [previewData, setPreviewData] = useState<BudgetImportPreview | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string>("");

  // Step 2 Mapping custom overrides
  const [customHeaderRows, setCustomHeaderRows] = useState<Record<string, number>>({});
  const [customColumnMappings, setCustomColumnMappings] = useState<Record<string, Record<number, CanonicalColumnRole>>>({});

  // Step 3 Filtering and resolution
  const [filterMode, setFilterMode] = useState<"ALL" | "ISSUES" | "EXCLUDED">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showExcludedAggregates, setShowExcludedAggregates] = useState<boolean>(true);
  const [markupPercent, setMarkupPercent] = useState<number>(0);
  const [resolutionStrategy, setResolutionStrategy] = useState<"KEEP_ORIGINAL" | "RECALCULATE_TOTAL" | "RECALCULATE_PU">("KEEP_ORIGINAL");

  // Step 4 Commit Result
  const [commitResult, setCommitResult] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSheetStructure: SheetStructure | undefined = useMemo(() => {
    if (!previewData) return undefined;
    return previewData.sheets.find((s) => s.sheetName === activeSheetName) || previewData.sheets[0];
  }, [previewData, activeSheetName]);

  // Handle Step 1: Submit to generate Preview
  const handleGeneratePreview = async (
    fileToUse?: File | null,
    sheetNameToUse?: string,
    headerRowsToUse?: Record<string, number>,
    columnMappingsToUse?: Record<string, Record<number, CanonicalColumnRole>>
  ) => {
    if (!project?.id) {
      showToast("No hay una obra seleccionada para asociar el presupuesto", "error");
      return;
    }

    const file = fileToUse !== undefined ? fileToUse : selectedFile;
    if (uploadSource === "file" && !file) {
      showToast("Por favor seleccioná un archivo Excel (.xlsx, .xls o .csv)", "error");
      return;
    }
    if (uploadSource === "paste" && !pastedText.trim()) {
      showToast("Por favor pegá datos de planilla en el área de texto", "error");
      return;
    }
    if (uploadSource === "google" && !googleUrl.trim()) {
      showToast("Por favor ingresá un enlace válido de Google Sheets", "error");
      return;
    }

    setLoading(true);
    try {
      const data = await api.previewBudgetImport(project.id, {
        file: uploadSource === "file" ? file : null,
        pastedText: uploadSource === "paste" ? pastedText : undefined,
        googleSheetsUrl: uploadSource === "google" ? googleUrl : undefined,
        activeSheetName: sheetNameToUse || activeSheetName || undefined,
        customHeaderRows: headerRowsToUse || customHeaderRows,
        customColumnMappings: columnMappingsToUse || (customColumnMappings as any),
      });

      setPreviewData(data);
      setActiveSheetName(data.activeSheetName);
      if (currentStep === 1) {
        setCurrentStep(2);
      }
      showToast(
        `Planilla analizada: ${data.summary.totalRowsRead} filas encontradas (${data.summary.aggregatesExcludedCount} subtotales excluidos de duplicación).`
      );
    } catch (err: any) {
      showToast(err.message || "Error al analizar la planilla", "error");
    } finally {
      setLoading(false);
    }
  };

  // Switch Sheet in Step 2 or 3
  const handleSwitchSheet = (newSheetName: string) => {
    setActiveSheetName(newSheetName);
    handleGeneratePreview(selectedFile, newSheetName);
  };

  // Change Header Row in Step 2
  const handleChangeHeaderRow = (newRow0Indexed: number) => {
    if (!activeSheetStructure) return;
    const updated = {
      ...customHeaderRows,
      [activeSheetStructure.sheetName]: newRow0Indexed,
    };
    setCustomHeaderRows(updated);
    handleGeneratePreview(selectedFile, activeSheetStructure.sheetName, updated);
  };

  // Change Column Role in Step 2
  const handleChangeColumnRole = (colIdx: number, newRole: CanonicalColumnRole) => {
    if (!activeSheetStructure) return;
    const currentSheetMap = { ...(customColumnMappings[activeSheetStructure.sheetName] || {}) };

    // Si el rol no es ignore, evitar duplicar el rol en otra columna
    if (newRole !== "ignore") {
      Object.keys(currentSheetMap).forEach((k) => {
        if (currentSheetMap[Number(k)] === newRole && Number(k) !== colIdx) {
          currentSheetMap[Number(k)] = "ignore";
        }
      });
      activeSheetStructure.columns.forEach((c) => {
        if (c.detectedRole === newRole && c.index !== colIdx) {
          currentSheetMap[c.index] = "ignore";
        }
      });
    }

    currentSheetMap[colIdx] = newRole;
    const updatedMappings = {
      ...customColumnMappings,
      [activeSheetStructure.sheetName]: currentSheetMap,
    };
    setCustomColumnMappings(updatedMappings);
  };

  // Apply updated column mappings and move to step 3
  const handleApplyMappingsAndProceed = () => {
    if (!activeSheetStructure) return;
    handleGeneratePreview(selectedFile, activeSheetStructure.sheetName, customHeaderRows, customColumnMappings).then(
      () => {
        setCurrentStep(3);
      }
    );
  };

  // Step 4: Final Transactional Commit
  const handleCommitBudget = async () => {
    if (!project?.id || !previewData) return;

    const validItems = previewData.detectedItems
      .filter((i) => !i.isExcludedAggregate && i.nodeKind !== "AGREGADO")
      .map((i) => ({
        code: i.code,
        description: i.description,
        unit: i.unit,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        nodeKind: i.nodeKind as "RUBRO" | "SUBRUBRO" | "ITEM",
        hierarchyLevel: i.hierarchyLevel,
        path: i.path,
        parentPath: i.parentPath,
        category: i.sheet,
        noCotiza: i.noCotiza,
        unitReview: i.unitReview,
        unitSuggestion: i.unitSuggestion,
        sourceSheet: i.sheet,
        sourceRow: i.rowNumber,
      }));

    if (validItems.length === 0) {
      showToast("No hay ítems válidos para importar en la planilla", "error");
      return;
    }

    setLoading(true);
    try {
      const result = await api.commitBudgetImport(project.id, {
        activeSheetName,
        markupPercent,
        resolutionStrategy,
        items: validItems,
      });

      setCommitResult(result);
      setCurrentStep(4);
      showToast(`¡Presupuesto importado con éxito! ${result.importedItemsCount} partidas sincronizadas.`);
    } catch (err: any) {
      showToast(err.message || "Error al persistir el presupuesto", "error");
    } finally {
      setLoading(false);
    }
  };

  // Filtered rows for Step 3
  const displayedItems = useMemo(() => {
    if (!previewData) return [];
    return previewData.detectedItems.filter((item) => {
      // Excluded filter
      if (!showExcludedAggregates && item.isExcludedAggregate) return false;

      // Filter Mode
      if (filterMode === "ISSUES" && item.issues.length === 0) return false;
      if (filterMode === "EXCLUDED" && !item.isExcludedAggregate) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.code.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.unit.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [previewData, filterMode, searchQuery, showExcludedAggregates]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 animate-in fade-in duration-200">
      {/* Top Banner & Header */}
      <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-stone-50 border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <h1 className="text-lg font-bold text-stone-900 font-display">
                Motor de Ingesta & Normalización de Presupuestos
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100/80 text-amber-800 border border-amber-200 font-mono">
                {project?.code || "Obra"}
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Ingesta sin límites de filas, validación aritmética cruzada y exclusión garantizada de subtotales.
            </p>
          </div>
        </div>

        {/* Wizard Stepper Tabs */}
        <div className="flex items-center gap-1 bg-stone-100/80 p-1.5 rounded-xl border border-stone-200 self-start md:self-auto text-xs font-semibold">
          {[
            { step: 1, label: "1. Carga" },
            { step: 2, label: "2. Mapeo" },
            { step: 3, label: "3. Validación" },
            { step: 4, label: "4. Confirmación" },
          ].map((s) => (
            <div
              key={s.step}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                currentStep === s.step
                  ? "bg-white text-stone-900 shadow-xs font-bold"
                  : currentStep > s.step
                  ? "text-emerald-700"
                  : "text-stone-400"
              }`}
            >
              {currentStep > s.step ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-stone-200 text-stone-700 text-[10px] flex items-center justify-center font-mono">
                  {s.step}
                </span>
              )}
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PASO 1: CARGA Y DETECCIÓN                                                 */}
      {/* ========================================================================= */}
      {currentStep === 1 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-stone-900">Paso 1: Seleccioná la fuente de tu presupuesto</h2>
            <p className="text-xs text-stone-500 mt-1">
              Admite planillas de cualquier tamaño (sin límite de filas). Reconoce libros con múltiples hojas, formatos MOPC, privados y licitaciones.
            </p>
          </div>

          {/* Source Tabs */}
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <button
              onClick={() => setUploadSource("file")}
              className={`p-3 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                uploadSource === "file"
                  ? "border-amber-500 bg-amber-50/50 text-amber-900 font-bold"
                  : "border-stone-200 hover:border-stone-300 text-stone-600"
              }`}
            >
              <Upload className="w-5 h-5 text-amber-600" />
              <div>
                <span className="text-xs block">Archivo Excel / CSV</span>
                <span className="text-[10px] text-stone-400 font-normal">.xlsx, .xls o .csv</span>
              </div>
            </button>

            <button
              onClick={() => setUploadSource("paste")}
              className={`p-3 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                uploadSource === "paste"
                  ? "border-amber-500 bg-amber-50/50 text-amber-900 font-bold"
                  : "border-stone-200 hover:border-stone-300 text-stone-600"
              }`}
            >
              <Clipboard className="w-5 h-5 text-amber-600" />
              <div>
                <span className="text-xs block">Pegar Tabla</span>
                <span className="text-[10px] text-stone-400 font-normal">Copiar desde Excel</span>
              </div>
            </button>

            <button
              onClick={() => setUploadSource("google")}
              className={`p-3 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                uploadSource === "google"
                  ? "border-amber-500 bg-amber-50/50 text-amber-900 font-bold"
                  : "border-stone-200 hover:border-stone-300 text-stone-600"
              }`}
            >
              <Link2 className="w-5 h-5 text-amber-600" />
              <div>
                <span className="text-xs block">Google Sheets</span>
                <span className="text-[10px] text-stone-400 font-normal">Enlace público</span>
              </div>
            </button>
          </div>

          {/* Source 1: File Dropzone */}
          {uploadSource === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-stone-300 hover:border-amber-500 rounded-2xl p-10 text-center transition cursor-pointer bg-stone-50/40 flex flex-col items-center justify-center space-y-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setSelectedFile(f);
                }}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-amber-100/70 text-amber-700 flex items-center justify-center">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-stone-800">
                  {selectedFile ? selectedFile.name : "Hacé clic o arrastrá tu planilla Excel aquí"}
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  Soporta formatos .xlsx, .xls y .csv con decenas de miles de filas sin truncamiento.
                </p>
              </div>
              {selectedFile && (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Listo para analizar: {(selectedFile.size / 1024).toFixed(1)} KB</span>
                </div>
              )}
            </div>
          )}

          {/* Source 2: Pasted Text */}
          {uploadSource === "paste" && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-stone-700 block">
                Pegá las celdas copiadas directamente de Excel o Google Sheets (Ctrl + V):
              </label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Ítem	Descripción	Unidad	Cantidad	P.U.	Total..."
                rows={8}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl p-3 font-mono text-xs text-stone-800 focus:border-amber-500 focus:outline-none transition"
              />
            </div>
          )}

          {/* Source 3: Google Sheets URL */}
          {uploadSource === "google" && (
            <div className="space-y-2 max-w-xl">
              <label className="text-xs font-bold text-stone-700 block">
                Enlace a la hoja de cálculo de Google Sheets:
              </label>
              <input
                type="url"
                value={googleUrl}
                onChange={(e) => setGoogleUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none transition"
              />
              <p className="text-[11px] text-stone-500">
                Asegurate de que el documento tenga permisos de lectura pública ("Cualquier persona con el enlace puede ver").
              </p>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-100">
            <button
              onClick={() => handleGeneratePreview()}
              disabled={loading || (uploadSource === "file" && !selectedFile)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Procesando archivo...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Analizar Estructura y Mapeo</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PASO 2: VALIDACIÓN Y CORRECCIÓN DE MAPEO                                   */}
      {/* ========================================================================= */}
      {currentStep === 2 && previewData && activeSheetStructure && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-stone-100">
            <div>
              <h2 className="text-base font-bold text-stone-900">Paso 2: Validación de Columnas y Encabezados</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Verificá que cada columna coincida con su rol correspondiente. Podés cambiar cualquier mapeo antes de avanzar.
              </p>
            </div>

            {/* Sheet Tabs if multiple sheets */}
            {previewData.sheets.length > 1 && (
              <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200">
                <span className="text-[11px] font-bold text-stone-500 px-2">Hojas:</span>
                {previewData.sheets.map((s) => (
                  <button
                    key={s.sheetName}
                    onClick={() => handleSwitchSheet(s.sheetName)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                      s.sheetName === activeSheetName
                        ? "bg-white text-stone-900 shadow-xs"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {s.sheetName} ({s.totalRows} filas)
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Header Row Selector Bar */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-stone-700">Fila detectada de encabezados:</span>
              <select
                value={activeSheetStructure.headerRowIndex}
                onChange={(e) => handleChangeHeaderRow(Number(e.target.value))}
                className="bg-white border border-stone-300 rounded-lg px-2.5 py-1 font-mono font-bold text-stone-800"
              >
                {Array.from({ length: Math.min(30, activeSheetStructure.totalRows) }, (_, i) => (
                  <option key={i} value={i}>
                    Fila {i + 1}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-stone-500">
                (Las filas de datos comienzan en la fila {activeSheetStructure.headerRowIndex + 2})
              </span>
            </div>

            <div className="text-xs text-stone-500 font-mono">
              Total columnas: {activeSheetStructure.totalCols} | Total filas: {activeSheetStructure.totalRows}
            </div>
          </div>

          {/* Columns Grid with Roles and Samples */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSheetStructure.columns.map((col) => {
              const currentRole =
                customColumnMappings[activeSheetStructure.sheetName]?.[col.index] || col.detectedRole;
              const roleMeta = ROLE_LABELS[currentRole];

              return (
                <div
                  key={col.index}
                  className={`rounded-xl border p-4 transition space-y-3 ${
                    currentRole !== "ignore"
                      ? "bg-white border-stone-200 shadow-xs"
                      : "bg-stone-50/60 border-stone-200/80 opacity-75"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded bg-stone-200 text-stone-800">
                        {col.letter}
                      </span>
                      <span className="text-xs font-bold text-stone-900 truncate max-w-[150px]" title={col.originalHeader}>
                        {col.originalHeader || `(Sin título)`}
                      </span>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        col.confidence >= 0.8
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : col.confidence >= 0.5
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-stone-100 text-stone-600 border-stone-200"
                      }`}
                    >
                      {Math.round(col.confidence * 100)}% conf.
                    </span>
                  </div>

                  {/* Role Selector Dropdown */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block mb-1">
                      Rol Asignado
                    </label>
                    <select
                      value={currentRole}
                      onChange={(e) => handleChangeColumnRole(col.index, e.target.value as CanonicalColumnRole)}
                      className={`w-full text-xs font-bold py-1.5 px-2 rounded-lg border outline-none transition cursor-pointer ${roleMeta.color}`}
                    >
                      <option value="code">Código / Ítem</option>
                      <option value="description">Descripción / Rubro</option>
                      <option value="unit">Unidad</option>
                      <option value="quantity">Cantidad / Metrado</option>
                      <option value="unitPrice">Precio Unitario</option>
                      <option value="totalPrice">Precio Total</option>
                      <option value="ignore">Ignorar Columna</option>
                    </select>
                  </div>

                  {/* Sample Values in this Column */}
                  <div className="bg-stone-50 rounded-lg p-2 border border-stone-100">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-stone-400 block mb-1">
                      Muestra primeras filas:
                    </span>
                    <div className="space-y-0.5">
                      {col.sampleValues.length > 0 ? (
                        col.sampleValues.slice(0, 3).map((val, idx) => (
                          <div key={idx} className="text-[11px] font-mono text-stone-700 truncate" title={val}>
                            {val}
                          </div>
                        ))
                      ) : (
                        <span className="text-[10px] text-stone-400 italic">Celdas vacías</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Navigation Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-stone-100">
            <button
              onClick={() => setCurrentStep(1)}
              className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 text-xs font-semibold hover:bg-stone-50 transition"
            >
              Volver a Carga
            </button>

            <button
              onClick={handleApplyMappingsAndProceed}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Procesando filas...</span>
                </>
              ) : (
                <>
                  <span>Continuar a Vista Previa & Validación</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PASO 3: VISTA PREVIA JERÁRQUICA & RESOLUCIÓN DE CONFLICTOS               */}
      {/* ========================================================================= */}
      {currentStep === 3 && previewData && (
        <div className="space-y-4">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-stone-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                Total Partidas a Importar
              </span>
              <p className="text-xl font-mono font-extrabold text-stone-900 mt-1">
                {previewData.summary.rubrosCount + previewData.summary.subrubrosCount + previewData.summary.itemsCount}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-stone-500 mt-1">
                <span>{previewData.summary.rubrosCount} Rubros</span>
                <span>•</span>
                <span>{previewData.summary.subrubrosCount} Subrubros</span>
                <span>•</span>
                <span>{previewData.summary.itemsCount} Ítems</span>
              </div>
            </div>

            <div className="bg-white border border-stone-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                Monto Total Presupuestado
              </span>
              <p className="text-lg font-mono font-extrabold text-stone-900 mt-1">
                {formatMoney(
                  previewData.summary.totalAmount * (1 + markupPercent / 100),
                  currency
                )}
              </p>
              <span className="text-[10px] text-emerald-700 font-semibold">
                Suma exacta de ítems (sin duplicación)
              </span>
            </div>

            <div className="bg-white border border-stone-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                Subtotales Excluidos
              </span>
              <p className="text-xl font-mono font-extrabold text-amber-700 mt-1">
                {previewData.summary.aggregatesExcludedCount}
              </p>
              <span className="text-[10px] text-stone-400">
                Detectados y no persistidos
              </span>
            </div>

            <div className="bg-white border border-stone-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                Alertas Aritméticas / Unidades
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-lg font-mono font-extrabold text-amber-600">
                  {previewData.summary.arithmeticMismatchCount}
                </span>
                <span className="text-xs text-stone-400 font-mono">/</span>
                <span className="text-sm font-mono font-bold text-blue-600">
                  {previewData.summary.unitReviewCount} unid.
                </span>
              </div>
              <span className="text-[10px] text-stone-400">
                {previewData.summary.criticalIssuesCount} críticas
              </span>
            </div>
          </div>

          {/* Controls Bar: Search, Filters, Markup, Strategy */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
            {/* Search and Filters */}
            <div className="flex items-center flex-wrap gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por código o descripción..."
                  className="bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs">
                <button
                  onClick={() => setFilterMode("ALL")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filterMode === "ALL" ? "bg-white text-stone-900 shadow-xs" : "text-stone-600"
                  }`}
                >
                  Todas ({previewData.detectedItems.length})
                </button>
                <button
                  onClick={() => setFilterMode("ISSUES")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer ${
                    filterMode === "ISSUES" ? "bg-white text-amber-800 shadow-xs" : "text-stone-600"
                  }`}
                >
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span>Con Observaciones ({previewData.summary.arithmeticMismatchCount})</span>
                </button>
                <button
                  onClick={() => setFilterMode("EXCLUDED")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer ${
                    filterMode === "EXCLUDED" ? "bg-white text-stone-700 shadow-xs" : "text-stone-500"
                  }`}
                >
                  <span>Excluidos ({previewData.summary.aggregatesExcludedCount})</span>
                </button>
              </div>

              <button
                onClick={() => setShowExcludedAggregates(!showExcludedAggregates)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  showExcludedAggregates
                    ? "bg-stone-100 text-stone-800 border-stone-300"
                    : "bg-white text-stone-500 border-stone-200"
                }`}
              >
                {showExcludedAggregates ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showExcludedAggregates ? "Ocultar Subtotales" : "Ver Subtotales"}</span>
              </button>
            </div>

            {/* Arithmetic Strategy & Markup */}
            <div className="flex items-center flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-stone-50 px-3 py-1.5 rounded-xl border border-stone-200 text-xs">
                <span className="font-bold text-stone-600">Resolución Aritmética:</span>
                <select
                  value={resolutionStrategy}
                  onChange={(e) => setResolutionStrategy(e.target.value as any)}
                  className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs font-bold text-stone-800"
                >
                  <option value="KEEP_ORIGINAL">Mantener planilla original</option>
                  <option value="RECALCULATE_TOTAL">Recalcular Total = Cantidad × P.U.</option>
                  <option value="RECALCULATE_PU">Recalcular P.U. = Total / Cantidad</option>
                </select>
              </div>

              <div className="flex items-center gap-2 bg-stone-50 px-3 py-1.5 rounded-xl border border-stone-200 text-xs">
                <span className="font-bold text-stone-600">Markup %:</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(Number(e.target.value))}
                  className="w-14 bg-white border border-stone-300 rounded-lg px-2 py-1 font-mono font-bold text-xs"
                />
                <span className="text-[10px] text-stone-400">%</span>
              </div>
            </div>
          </div>

          {/* Hierarchical Table with Indentation and Badges */}
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-100 text-stone-600 font-bold sticky top-0 z-20 shadow-xs border-b border-stone-200">
                  <tr>
                    <th className="p-3 w-12 text-center text-stone-400 font-mono">Fila</th>
                    <th className="p-3 w-32">Código</th>
                    <th className="p-3">Descripción de la Partida</th>
                    <th className="p-3 w-28 text-center">Tipo Nodo</th>
                    <th className="p-3 w-20 text-center">Unidad</th>
                    <th className="p-3 w-28 text-right">Cantidad</th>
                    <th className="p-3 w-32 text-right">Precio Unitario</th>
                    <th className="p-3 w-36 text-right">Monto Total</th>
                    <th className="p-3 w-40 text-center">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {displayedItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-stone-400">
                        No se encontraron partidas con los filtros seleccionados
                      </td>
                    </tr>
                  ) : (
                    displayedItems.map((row) => {
                      const isExcluded = row.isExcludedAggregate;
                      const indentPx = row.hierarchyLevel * 20;

                      return (
                        <tr
                          key={row.id}
                          className={`transition ${
                            isExcluded
                              ? "bg-amber-50/40 opacity-70"
                              : row.hasArithmeticMismatch
                              ? "bg-rose-50/30 hover:bg-rose-50/50"
                              : "hover:bg-stone-50/80"
                          }`}
                        >
                          <td className="p-3 text-center font-mono text-[10px] text-stone-400">
                            {row.rowNumber}
                          </td>

                          <td className="p-3 font-mono font-bold text-stone-900">
                            <span className="px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200">
                              {row.code}
                            </span>
                          </td>

                          <td className="p-3">
                            <div className="flex items-center gap-1.5" style={{ paddingLeft: `${indentPx}px` }}>
                              {row.hierarchyLevel > 0 && (
                                <span className="text-stone-300 select-none">↳</span>
                              )}
                              <span
                                className={`font-medium ${
                                  row.nodeKind === "RUBRO"
                                    ? "font-bold text-stone-900"
                                    : row.nodeKind === "SUBRUBRO"
                                    ? "font-semibold text-stone-800"
                                    : "text-stone-700"
                                }`}
                              >
                                {row.description}
                              </span>
                            </div>
                          </td>

                          <td className="p-3 text-center">
                            {isExcluded ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                EXCLUIDO: SUB-TOTAL
                              </span>
                            ) : row.nodeKind === "RUBRO" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                RUBRO
                              </span>
                            ) : row.nodeKind === "SUBRUBRO" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                SUBRUBRO
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ÍTEM
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-center font-mono text-stone-600">
                            {row.unitReview ? (
                              <span
                                className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                                title={`Sugerencia: ${row.unitSuggestion}`}
                              >
                                {row.unit}*
                              </span>
                            ) : (
                              row.unit || "-"
                            )}
                          </td>

                          <td className="p-3 text-right font-mono text-stone-800">
                            {row.quantity > 0 ? row.quantity.toLocaleString() : "-"}
                          </td>

                          <td className="p-3 text-right font-mono text-stone-800">
                            {row.unitPrice > 0
                              ? formatMoney(row.unitPrice * (1 + markupPercent / 100), currency)
                              : "-"}
                          </td>

                          <td className="p-3 text-right font-mono font-bold text-stone-900">
                            {formatMoney(row.totalPrice * (1 + markupPercent / 100), currency)}
                          </td>

                          <td className="p-3 text-center">
                            {isExcluded ? (
                              <span className="text-[10px] text-amber-700 font-semibold">
                                No se sumará al presupuesto
                              </span>
                            ) : row.hasArithmeticMismatch ? (
                              <div
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200"
                                title={`Esperado: ${row.calculatedTotal.toLocaleString()}`}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                <span>Dif. Aritmética</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <Check className="w-3 h-3" />
                                <span>Válido</span>
                              </div>
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

          {/* Navigation & Commit Buttons */}
          <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs flex items-center justify-between">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 text-xs font-semibold hover:bg-stone-50 transition"
            >
              Volver a Mapeo
            </button>

            <button
              onClick={handleCommitBudget}
              disabled={loading}
              className="flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-extrabold shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sincronizando con la obra...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Aprobar y Sincronizar Presupuesto ({previewData.summary.itemsCount} Ítems)
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PASO 4: CONFIRMACIÓN Y REPORTE DE IMPORTACIÓN                              */}
      {/* ========================================================================= */}
      {currentStep === 4 && commitResult && (
        <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-xs max-w-2xl mx-auto text-center space-y-6 animate-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
            <FileCheck className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-stone-900 font-display">
              ¡Presupuesto Sincronizado Exitosamente!
            </h2>
            <p className="text-xs text-stone-500 mt-1">
              Las partidas y límites presupuestarios han sido guardados en la base de datos de la obra.
            </p>
          </div>

          {/* Stats Box */}
          <div className="grid grid-cols-3 gap-3 bg-stone-50 rounded-2xl p-4 border border-stone-200 text-left">
            <div>
              <span className="text-[10px] font-bold uppercase text-stone-400 block">Partidas Creadas</span>
              <span className="text-lg font-mono font-extrabold text-stone-900">
                {commitResult.importedItemsCount}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-stone-400 block">Estructura WBS</span>
              <span className="text-xs font-semibold text-stone-700 block mt-1">
                {commitResult.rubrosCount} Rubros • {commitResult.itemsCount} Ítems
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-stone-400 block">Monto Contratado</span>
              <span className="text-sm font-mono font-bold text-emerald-700 block mt-1">
                {formatMoney(commitResult.totalBudgetAmount, currency)}
              </span>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              onClick={onImportComplete}
              className="px-6 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold transition shadow-sm cursor-pointer"
            >
              Ver Partidas de la Obra
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
