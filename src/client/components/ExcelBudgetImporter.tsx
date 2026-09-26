import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  FileSpreadsheet,
  Info,
  Link2,
  Lock,
  RefreshCw,
  Scale,
  Upload,
} from "lucide-react";
import { api } from "../api";
import { Project } from "../types";
import { formatMoney } from "../utils/format";
import { buildBudgetTree } from "../../modules/budgets/engine/budgetTree";
import type {
  ArithmeticStrategy,
  BudgetImportPreview,
  CanonicalColumnRole,
  CommitBudgetResult,
  ImportRow,
  NumberFormat,
  RowKind,
  SurchargeTreatment,
  ValidationIssue,
} from "../../modules/budgets/engine/types";

interface ExcelBudgetImporterProps {
  project?: Project | null;
  currency: "PYG" | "USD";
  onBack: () => void;
  onImportComplete: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Step = 1 | 2 | 3 | 4;
type Preview = BudgetImportPreview & { projectLocked: boolean };

const ROLE_OPTIONS: { value: CanonicalColumnRole; label: string }[] = [
  { value: "code", label: "Código / Ítem" },
  { value: "description", label: "Descripción" },
  { value: "unit", label: "Unidad" },
  { value: "quantity", label: "Cantidad" },
  { value: "unitPrice", label: "Precio unitario" },
  { value: "totalPrice", label: "Precio total" },
  { value: "ignore", label: "Ignorar" },
];

const KIND_OPTIONS: { value: RowKind; label: string; style: string }[] = [
  { value: "RUBRO", label: "Rubro", style: "bg-indigo-50 text-indigo-800 border-indigo-200" },
  { value: "SUBRUBRO", label: "Subrubro", style: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "ITEM", label: "Ítem", style: "bg-white text-stone-800 border-stone-200" },
  { value: "SUBTOTAL", label: "Subtotal", style: "bg-stone-100 text-stone-600 border-stone-200" },
  { value: "RECARGO", label: "Recargo", style: "bg-amber-50 text-amber-800 border-amber-200" },
  { value: "IGNORAR", label: "Ignorar", style: "bg-stone-50 text-stone-400 border-stone-200" },
];

const TREATMENT_LABEL: Record<SurchargeTreatment, string> = {
  DISTRIBUTE: "Prorratear en los PU",
  AS_ITEM: "Partida propia",
  IGNORE: "No cargar",
};

const PAGE_SIZE = 100;

/** Las celdas editables se muestran y se leen en formato paraguayo: 1.234.567,89 */
function formatCell(value: number | null): string {
  return value === null ? "" : value.toLocaleString("es-PY", { maximumFractionDigits: 4 });
}

function parseCell(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function StepBadge({ step, current, label }: { step: Step; current: Step; label: string }) {
  const done = current > step;
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
        current === step ? "bg-white font-bold text-stone-900 shadow-xs" : done ? "text-emerald-700" : "text-stone-400"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 font-mono text-[10px] text-stone-700">
          {step}
        </span>
      )}
      <span>{label}</span>
    </div>
  );
}

export const ExcelBudgetImporter: React.FC<ExcelBudgetImporterProps> = ({
  project,
  currency,
  onBack,
  onImportComplete,
  showToast,
}) => {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);

  // Paso 1
  const [source, setSource] = useState<"file" | "paste" | "google">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paso 2
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [numberFormat, setNumberFormat] = useState<NumberFormat | undefined>();
  const [includeHidden, setIncludeHidden] = useState(false);
  const [headerRows, setHeaderRows] = useState<Record<string, number>>({});
  const [columnMappings, setColumnMappings] = useState<Record<string, Record<number, CanonicalColumnRole>>>({});

  // Paso 3
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [treatments, setTreatments] = useState<Record<string, SurchargeTreatment>>({});
  const [strategy, setStrategy] = useState<ArithmeticStrategy>("KEEP_ORIGINAL");
  const [filter, setFilter] = useState<"ALL" | "ISSUES" | "STRUCTURE" | "IGNORED">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Paso 4
  const [acceptDifference, setAcceptDifference] = useState(false);
  const [result, setResult] = useState<CommitBudgetResult | null>(null);

  const decimals = (project?.currency ?? currency) === "PYG" ? 0 : 2;
  const contractAmount = Number(project?.montoContractualManual || 0) || null;

  // El árbol y el cuadre se recalculan en vivo con cada corrección.
  const build = useMemo(
    () =>
      rows.length
        ? buildBudgetTree(rows, {
            surchargeTreatments: treatments,
            arithmeticStrategy: strategy,
            currencyDecimals: decimals,
            contractAmount,
          })
        : null,
    [rows, treatments, strategy, decimals, contractAmount]
  );
  const rec = build?.reconciliation;
  const amountByRow = useMemo(() => new Map(build?.nodes.map((n) => [n.rowId, n.amount]) ?? []), [build]);
  const issuesByRow = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const issue of [...(build?.issues ?? []), ...(preview?.readIssues ?? [])]) {
      if (!issue.rowId && !issue.rowNumber) continue;
      const key = issue.rowId ?? `${issue.sheet}!${issue.rowNumber}`;
      map.set(key, [...(map.get(key) ?? []), issue]);
    }
    return map;
  }, [build, preview]);
  const critical = build?.issues.filter((i) => i.type === "CRITICAL") ?? [];
  const globalIssues = [...(build?.issues ?? []), ...(preview?.readIssues ?? [])].filter((i) => !i.rowNumber);

  const runPreview = async (overrides: Partial<{
    selectedSheets: string[];
    numberFormat: NumberFormat;
    includeHidden: boolean;
    headerRows: Record<string, number>;
    columnMappings: Record<string, Record<number, CanonicalColumnRole>>;
  }> = {}) => {
    if (!project?.id) {
      showToast("Seleccioná una obra antes de importar", "error");
      return null;
    }
    if (source === "file" && !file) return showToast("Elegí un archivo Excel o CSV", "error"), null;
    if (source === "paste" && !pastedText.trim()) return showToast("Pegá las celdas de la planilla", "error"), null;
    if (source === "google" && !googleUrl.trim()) return showToast("Ingresá el enlace de Google Sheets", "error"), null;

    setLoading(true);
    try {
      const data = await api.previewBudgetImport(project.id, {
        file: source === "file" ? file : null,
        pastedText: source === "paste" ? pastedText : undefined,
        googleSheetsUrl: source === "google" ? googleUrl : undefined,
        selectedSheets: overrides.selectedSheets ?? (selectedSheets.length ? selectedSheets : undefined),
        numberFormat: overrides.numberFormat ?? numberFormat,
        includeHidden: overrides.includeHidden ?? includeHidden,
        headerRows: overrides.headerRows ?? headerRows,
        columnMappings: overrides.columnMappings ?? columnMappings,
      });
      setPreview(data);
      setSelectedSheets(data.selectedSheets);
      setActiveSheet((prev) => (data.selectedSheets.includes(prev) ? prev : data.selectedSheets[0] ?? ""));
      setNumberFormat(data.numberFormat);
      setRows(data.rows);
      setTreatments(data.surchargeTreatments);
      setPage(0);
      setAcceptDifference(false);
      return data;
    } catch (err: any) {
      showToast(err.message || "No se pudo analizar la planilla", "error");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (id: string, patch: Partial<ImportRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, edited: true } : r)));

  const changeKind = (row: ImportRow, kind: RowKind) => {
    const patch: Partial<ImportRow> = { kind };
    if (kind === "RUBRO") patch.level = 0;
    if (kind === "SUBRUBRO" && row.level === 0) patch.level = 1;
    updateRow(row.id, patch);
  };

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "ISSUES" && !issuesByRow.has(r.id)) return false;
      if (filter === "STRUCTURE" && !["RUBRO", "SUBRUBRO", "SUBTOTAL", "RECARGO"].includes(r.kind)) return false;
      if (filter === "IGNORED" && r.kind !== "IGNORAR") return false;
      if (q && !`${r.code} ${r.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, search, issuesByRow]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pageRows = visibleRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeStructure = preview?.sheets.find((s) => s.sheetName === activeSheet);

  const commit = async () => {
    if (!project?.id || !preview) return;
    setLoading(true);
    try {
      const res = await api.commitBudgetImport(project.id, {
        rows,
        surchargeTreatments: treatments,
        arithmeticStrategy: strategy,
        acceptDifference,
        metadata: {
          fileName: preview.metadata.fileName,
          sourceType: preview.metadata.sourceType,
          sheets: selectedSheets,
          numberFormat: preview.numberFormat,
          columnMappings,
        },
      });
      setResult(res);
      showToast(res.message);
      onImportComplete();
    } catch (err: any) {
      showToast(err.message || "Error al importar el presupuesto", "error");
    } finally {
      setLoading(false);
    }
  };

  const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(v, currency));
  const diffClass = (v: number | null | undefined) =>
    v === null || v === undefined ? "text-stone-400" : Math.abs(v) <= (rec?.tolerance ?? 1) ? "text-emerald-700" : "text-rose-700";

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      {/* Encabezado */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-xs md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-xl border border-stone-200 bg-stone-50 p-2 text-stone-600 transition hover:bg-stone-100"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-stone-900">
              <FileSpreadsheet className="h-5 w-5 text-amber-600" />
              Importar presupuesto
              <span className="rounded-full border border-amber-200 bg-amber-100/80 px-2 py-0.5 font-mono text-xs text-amber-800">
                {project?.code || "Obra"}
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-stone-500">
              El presupuesto importado es la base de la que se descuentan OC, certificados y caja chica.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 self-start rounded-xl border border-stone-200 bg-stone-100/80 p-1.5 text-xs font-semibold">
          <StepBadge step={1} current={step} label="Carga" />
          <StepBadge step={2} current={step} label="Estructura" />
          <StepBadge step={3} current={step} label="Revisión y cuadre" />
          <StepBadge step={4} current={step} label="Confirmar" />
        </div>
      </div>

      {preview?.projectLocked && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Esta obra ya tiene OC, certificados o gastos imputados al presupuesto: no se puede reemplazar. Podés revisar la
            planilla, pero los cambios posteriores tienen que cargarse como adenda.
          </p>
        </div>
      )}

      {/* PASO 1: CARGA */}
      {step === 1 && (
        <div className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
          <div className="grid max-w-xl grid-cols-3 gap-3">
            {[
              { key: "file" as const, icon: Upload, title: "Archivo", sub: ".xlsx, .xls, .csv" },
              { key: "paste" as const, icon: Clipboard, title: "Pegar tabla", sub: "Copiado de Excel" },
              { key: "google" as const, icon: Link2, title: "Google Sheets", sub: "Enlace compartido" },
            ].map(({ key, icon: Icon, title, sub }) => (
              <button
                key={key}
                onClick={() => setSource(key)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                  source === key ? "border-amber-500 bg-amber-50/50 font-bold text-amber-900" : "border-stone-200 text-stone-600 hover:border-stone-300"
                }`}
              >
                <Icon className="h-5 w-5 text-amber-600" />
                <div>
                  <span className="block text-xs">{title}</span>
                  <span className="text-[10px] font-normal text-stone-400">{sub}</span>
                </div>
              </button>
            ))}
          </div>

          {source === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center space-y-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/40 p-10 text-center transition hover:border-amber-500"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="h-8 w-8 text-amber-600" />
              <p className="text-sm font-bold text-stone-800">{file ? file.name : "Hacé clic para elegir la planilla del presupuesto"}</p>
              <p className="text-xs text-stone-500">Se leen todas las hojas; en el paso siguiente elegís cuáles importar.</p>
            </div>
          )}
          {source === "paste" && (
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={8}
              placeholder={"Ítem\tDescripción\tUnidad\tCantidad\tP.U.\tTotal"}
              className="w-full rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs focus:border-amber-500 focus:outline-none"
            />
          )}
          {source === "google" && (
            <div className="max-w-xl space-y-2">
              <input
                type="url"
                value={googleUrl}
                onChange={(e) => setGoogleUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
              />
              <p className="text-[11px] text-stone-500">La planilla tiene que estar compartida como "Cualquier persona con el enlace".</p>
            </div>
          )}

          <div className="flex justify-end border-t border-stone-100 pt-4">
            <button
              onClick={async () => (await runPreview()) && setStep(2)}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Analizar planilla
            </button>
          </div>
        </div>
      )}

      {/* PASO 2: ESTRUCTURA */}
      {step === 2 && preview && (
        <div className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <h2 className="text-sm font-bold text-stone-900">Hojas a importar</h2>
              <p className="text-[11px] text-stone-500">
                Por defecto se elige la hoja con más ítems. Si marcás varias, cada hoja se carga como un rubro propio.
              </p>
              <div className="flex flex-wrap gap-2">
                {preview.sheets.map((s) => {
                  const checked = selectedSheets.includes(s.sheetName);
                  return (
                    <label
                      key={s.sheetName}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                        checked ? "border-amber-400 bg-amber-50 font-bold text-amber-900" : "border-stone-200 text-stone-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedSheets((prev) =>
                            checked ? prev.filter((x) => x !== s.sheetName) : [...prev, s.sheetName]
                          )
                        }
                      />
                      {s.sheetName}
                      <span className="font-normal text-stone-400">~{s.detectedItemRows} ítems</span>
                      {s.likelySummary && <span className="rounded bg-stone-200 px-1 text-[10px] text-stone-600">resumen</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-3 text-xs">
              <label className="block">
                <span className="font-bold text-stone-700">Formato de números</span>
                <select
                  value={numberFormat}
                  onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5"
                >
                  <option value="PY">1.234.567,89 (coma decimal)</option>
                  <option value="EN">1,234,567.89 (punto decimal)</option>
                </select>
                <span className="text-[10px] text-stone-400">
                  Detectado: {preview.detectedNumberFormat === "PY" ? "coma decimal" : "punto decimal"}. Las celdas numéricas de Excel no se ven afectadas.
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} />
                Incluir filas ocultas de Excel
              </label>
            </div>
          </div>

          {activeStructure && (
            <div className="space-y-3 border-t border-stone-100 pt-4">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-bold text-stone-800">Columnas de la hoja</span>
                <select
                  value={activeSheet}
                  onChange={(e) => setActiveSheet(e.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1"
                >
                  {preview.sheets
                    .filter((s) => selectedSheets.includes(s.sheetName))
                    .map((s) => (
                      <option key={s.sheetName}>{s.sheetName}</option>
                    ))}
                </select>
                <span className="text-stone-500">Encabezado en la fila</span>
                <select
                  value={headerRows[activeSheet] ?? activeStructure.headerRowIndex}
                  onChange={(e) => setHeaderRows((prev) => ({ ...prev, [activeSheet]: Number(e.target.value) }))}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 font-mono"
                >
                  {Array.from({ length: Math.min(40, activeStructure.totalRows) }, (_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                {activeStructure.headerRowCount === 2 && (
                  <span className="rounded bg-sky-50 px-2 py-0.5 text-sky-700">Encabezado en dos filas combinado</span>
                )}
                {activeStructure.hiddenRowsCount > 0 && (
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-stone-600">{activeStructure.hiddenRowsCount} filas ocultas</span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {activeStructure.columns
                  .filter((c) => c.sampleValues.length || c.detectedRole !== "ignore")
                  .map((col) => {
                    const role = columnMappings[activeSheet]?.[col.index] ?? col.detectedRole;
                    return (
                      <div
                        key={col.index}
                        className={`space-y-2 rounded-xl border p-3 ${role === "ignore" ? "border-stone-200 bg-stone-50/60 opacity-75" : "border-stone-200 bg-white"}`}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-stone-200 px-1.5 font-mono font-bold">{col.letter}</span>
                          <span className="truncate font-bold text-stone-900" title={col.originalHeader}>
                            {col.originalHeader}
                          </span>
                        </div>
                        <select
                          value={role}
                          onChange={(e) =>
                            setColumnMappings((prev) => ({
                              ...prev,
                              [activeSheet]: { ...(prev[activeSheet] ?? {}), [col.index]: e.target.value as CanonicalColumnRole },
                            }))
                          }
                          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs font-semibold"
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <p className="truncate font-mono text-[10px] text-stone-400">{col.sampleValues.slice(0, 3).join(" · ") || "sin datos"}</p>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="flex justify-between border-t border-stone-100 pt-4">
            <button onClick={() => setStep(1)} className="text-xs font-semibold text-stone-500 hover:text-stone-800">
              Volver
            </button>
            <button
              onClick={async () => (await runPreview({ selectedSheets })) && setStep(3)}
              disabled={loading || selectedSheets.length === 0}
              className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Leer filas y revisar
            </button>
          </div>
        </div>
      )}

      {/* PASO 3: REVISIÓN Y CUADRE */}
      {step === 3 && preview && build && rec && (
        <div className="space-y-4">
          {/* Cuadre */}
          <div className={`rounded-2xl border p-5 shadow-xs ${rec.balanced ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"}`}>
            <div className="mb-3 flex items-center gap-2">
              <Scale className={`h-5 w-5 ${rec.balanced ? "text-emerald-600" : "text-rose-600"}`} />
              <h2 className="text-sm font-bold text-stone-900">Cuadre del presupuesto</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${rec.balanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                {rec.balanced ? "Cuadra" : "No cuadra"}
              </span>
            </div>
            <div className="grid gap-4 text-xs md:grid-cols-2">
              <table className="w-full">
                <tbody className="divide-y divide-stone-200/70">
                  <tr>
                    <td className="py-1.5 text-stone-600">Suma de ítems ({build.counts.items})</td>
                    <td className="py-1.5 text-right font-mono font-bold">{money(rec.itemsTotal)}</td>
                  </tr>
                  {rec.surcharges.map((s) => (
                    <tr key={s.rowId}>
                      <td className="py-1.5 text-stone-600">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {s.description}
                            {s.percent !== null && ` (${s.percent}%)`}
                          </span>
                          <select
                            value={s.treatment}
                            onChange={(e) => setTreatments((prev) => ({ ...prev, [s.rowId]: e.target.value as SurchargeTreatment }))}
                            className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[11px] font-semibold text-amber-900"
                          >
                            {(Object.keys(TREATMENT_LABEL) as SurchargeTreatment[]).map((t) => (
                              <option key={t} value={t}>
                                {TREATMENT_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-mono">{money(s.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 font-bold text-stone-800">Total según ítems + recargos</td>
                    <td className="py-1.5 text-right font-mono font-bold">{money(rec.sheetComputedTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-stone-600">Total que declara la planilla</td>
                    <td className="py-1.5 text-right font-mono">
                      {money(rec.declaredGrandTotal)}{" "}
                      <span className={diffClass(rec.declaredDifference)}>
                        {rec.declaredDifference !== null && `(dif. ${money(rec.declaredDifference)})`}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-stone-600">Monto contractual que se fija para la obra</td>
                    <td className="py-1.5 text-right font-mono font-semibold">{money(rec.sheetComputedTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-bold text-amber-900">Presupuesto que se carga para control</td>
                    <td className="py-1.5 text-right font-mono font-bold text-amber-900">{money(rec.budgetTotal)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="space-y-2">
                <p className="font-bold text-stone-700">Subtotales por rubro</p>
                {rec.rubroChecks.length === 0 && (
                  <p className="text-stone-400">La planilla no trae subtotales cargados (se calculan sumando ítems).</p>
                )}
                <div className="max-h-44 space-y-1 overflow-auto">
                  {rec.rubroChecks.map((c) => (
                    <div key={c.path} className="flex justify-between gap-2 rounded bg-white/70 px-2 py-1">
                      <span className="truncate">
                        {c.code} {c.name}
                      </span>
                      <span className={`shrink-0 font-mono ${diffClass(c.difference)}`}>
                        {Math.abs(c.difference) <= rec.tolerance ? "OK" : `dif. ${money(c.difference)}`}
                      </span>
                    </div>
                  ))}
                </div>
                <label className="block pt-2">
                  <span className="font-bold text-stone-700">Si Cantidad × PU no coincide con el total</span>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as ArithmeticStrategy)}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1"
                  >
                    <option value="KEEP_ORIGINAL">Respetar el total de la planilla</option>
                    <option value="RECALCULATE_TOTAL">Recalcular el total (Cantidad × PU)</option>
                    <option value="RECALCULATE_PU">Recalcular el PU (Total ÷ Cantidad)</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          {(critical.length > 0 || globalIssues.length > 0) && (
            <div className="space-y-1 rounded-xl border border-stone-200 bg-white p-4 text-xs">
              {critical.length > 0 && (
                <p className="flex items-center gap-2 font-bold text-rose-700">
                  <AlertCircle className="h-4 w-4" /> {critical.length} error(es) a corregir antes de importar (filtrá por "Con problemas").
                </p>
              )}
              {globalIssues.map((i) => (
                <p key={i.id} className="flex items-center gap-2 text-stone-600">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {i.message}
                </p>
              ))}
            </div>
          )}

          {/* Filas */}
          <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex gap-1 rounded-lg bg-stone-100 p-1 font-semibold">
                {[
                  ["ALL", `Todas (${rows.length})`],
                  ["ISSUES", `Con problemas (${issuesByRow.size})`],
                  ["STRUCTURE", "Rubros, subtotales y recargos"],
                  ["IGNORED", "Ignoradas"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setFilter(key as typeof filter);
                      setPage(0);
                    }}
                    className={`rounded-md px-2.5 py-1 ${filter === key ? "bg-white text-stone-900 shadow-xs" : "text-stone-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Buscar código o descripción…"
                className="w-56 rounded-lg border border-stone-300 px-2 py-1"
              />
            </div>
            <p className="text-[11px] text-stone-500">
              Cambiá el tipo o el nivel de cualquier fila y el cuadre se recalcula al instante. El padre de cada fila es el rubro anterior más cercano con un nivel menos.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-xs">
                <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
                  <tr>
                    <th className="px-2 py-2 text-left">Fila</th>
                    <th className="px-2 py-2 text-left">Tipo</th>
                    <th className="px-2 py-2 text-left">Nivel</th>
                    <th className="px-2 py-2 text-left">Código</th>
                    <th className="px-2 py-2 text-left">Descripción</th>
                    <th className="px-2 py-2 text-left">Un.</th>
                    <th className="px-2 py-2 text-right">Cantidad</th>
                    <th className="px-2 py-2 text-right">P. unitario</th>
                    <th className="px-2 py-2 text-right">Total planilla</th>
                    <th className="px-2 py-2 text-right">Monto a cargar</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pageRows.map((row) => {
                    const kindMeta = KIND_OPTIONS.find((k) => k.value === row.kind)!;
                    const rowIssues = issuesByRow.get(row.id) ?? [];
                    const isNode = row.kind === "RUBRO" || row.kind === "SUBRUBRO" || row.kind === "ITEM";
                    const worst = rowIssues.find((i) => i.type === "CRITICAL") ?? rowIssues.find((i) => i.type === "WARNING") ?? rowIssues[0];
                    return (
                      <tr key={row.id} className={`${row.kind === "IGNORAR" ? "opacity-50" : ""} ${row.kind === "RUBRO" ? "bg-indigo-50/30 font-semibold" : ""}`}>
                        <td className="px-2 py-1 font-mono text-[10px] text-stone-400" title={row.sheet}>
                          {row.rowNumber || "—"}
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={row.kind}
                            onChange={(e) => changeKind(row, e.target.value as RowKind)}
                            className={`rounded border px-1 py-0.5 text-[11px] font-semibold ${kindMeta.style}`}
                          >
                            {KIND_OPTIONS.map((k) => (
                              <option key={k.value} value={k.value}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          {isNode && (
                            <div className="flex items-center gap-1">
                              <button
                                className="rounded border border-stone-200 px-1 disabled:opacity-30"
                                disabled={row.level === 0}
                                onClick={() => updateRow(row.id, { level: row.level - 1 })}
                                aria-label="Subir de nivel"
                              >
                                <ChevronLeft className="h-3 w-3" />
                              </button>
                              <span className="w-3 text-center font-mono">{row.level}</span>
                              <button
                                className="rounded border border-stone-200 px-1"
                                onClick={() => updateRow(row.id, { level: row.level + 1 })}
                                aria-label="Bajar de nivel"
                              >
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.code}
                            onChange={(e) => updateRow(row.id, { code: e.target.value })}
                            className="w-16 rounded border border-transparent px-1 font-mono hover:border-stone-200 focus:border-amber-400 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.description}
                            onChange={(e) => updateRow(row.id, { description: e.target.value })}
                            style={{ paddingLeft: isNode ? row.level * 14 + 4 : 4 }}
                            className="w-full min-w-[220px] rounded border border-transparent hover:border-stone-200 focus:border-amber-400 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.unit}
                            onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                            className="w-12 rounded border border-transparent px-1 hover:border-stone-200 focus:border-amber-400 focus:outline-none"
                          />
                        </td>
                        {(["quantity", "unitPrice", "totalPrice"] as const).map((field) => (
                          <td key={field} className="px-2 py-1 text-right">
                            <input
                              defaultValue={formatCell(row[field])}
                              key={`${row.id}-${field}-${row[field]}`}
                              onBlur={(e) => {
                                const next = parseCell(e.target.value);
                                if (next !== row[field]) updateRow(row.id, { [field]: next });
                              }}
                              className="w-24 rounded border border-transparent px-1 text-right font-mono hover:border-stone-200 focus:border-amber-400 focus:outline-none"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-mono font-semibold text-stone-800">
                          {amountByRow.has(row.id) ? money(amountByRow.get(row.id)) : ""}
                        </td>
                        <td className="px-2 py-1">
                          {worst && (
                            <span title={rowIssues.map((i) => i.message).join("\n")}>
                              {worst.type === "CRITICAL" ? (
                                <AlertCircle className="h-4 w-4 text-rose-600" />
                              ) : worst.type === "WARNING" ? (
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                              ) : (
                                <Info className="h-4 w-4 text-sky-500" />
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs">
                <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">
                  Anterior
                </button>
                <span>
                  Página {page + 1} de {pageCount}
                </span>
                <button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">
                  Siguiente
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="text-xs font-semibold text-stone-500 hover:text-stone-800">
              Volver a la estructura
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={critical.length > 0}
              className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Continuar <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* PASO 4: CONFIRMAR */}
      {step === 4 && preview && build && rec && (
        <div className="space-y-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
          {result ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <h2 className="text-base font-bold text-stone-900">{result.message}</h2>
              <p className="text-xs text-stone-500">
                Presupuesto de control: {money(result.totalBudgetAmount)}. Se creó también el rubro "Gastos Generales / No imputados" para gastos sin partida.
              </p>
              <button onClick={onBack} className="rounded-xl bg-stone-900 px-5 py-2 text-xs font-bold text-white">
                Ir al Centro de Costos
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-bold text-stone-900">Confirmar importación</h2>
              <div className="grid gap-3 text-xs sm:grid-cols-4">
                {[
                  ["Rubros", build.counts.rubros],
                  ["Subrubros", build.counts.subrubros],
                  ["Ítems", build.counts.items],
                  ["Presupuesto de control", money(rec.budgetTotal)],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <p className="text-stone-500">{label}</p>
                    <p className="font-mono text-base font-bold text-stone-900">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-stone-600">
                Se reemplaza el presupuesto actual de la obra (salvo Gastos Generales). Solo es posible mientras no haya OC, certificados ni gastos imputados.
              </p>
              {!rec.balanced && (
                <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  <input type="checkbox" checked={acceptDifference} onChange={(e) => setAcceptDifference(e.target.checked)} className="mt-0.5" />
                  <span>
                    El presupuesto no cuadra con la planilla
                    {rec.declaredDifference !== null && ` (dif. ${money(rec.declaredDifference)})`}
                    {rec.declaredDifference === null && " (hay subtotales de rubro que no coinciden)"}. Confirmo importarlo igual; la
                    diferencia queda registrada.
                  </span>
                </label>
              )}
              <div className="flex justify-between border-t border-stone-100 pt-4">
                <button onClick={() => setStep(3)} className="text-xs font-semibold text-stone-500 hover:text-stone-800">
                  Volver a revisar
                </button>
                <button
                  onClick={commit}
                  disabled={loading || preview.projectLocked || (!rec.balanced && !acceptDifference)}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Importar presupuesto
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
