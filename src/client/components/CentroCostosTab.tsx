import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Edit2,
  FileSpreadsheet,
  Layers,
  Plus,
  RefreshCw,
  Scale,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { BudgetItem, BudgetMovement, BudgetMovementSource, CostControlData, CostNode, Project, PurchaseOrder } from "../types";
import { formatMoney, parseFlexibleNumber } from "../utils/format";
import { ExcelBudgetImporter } from "./ExcelBudgetImporter";
import { RubrosExtrasTab } from "./RubrosExtrasTab";
import { BudgetItemSelect } from "./BudgetItemSelect";
import { LaborPricesPanel } from "./LaborPricesPanel";
import { Button, EmptyState, Page, PageHeader, Stat, StatGrid, Tabs } from "../ui";
import { MoreMenu } from "../ui/actions";
import { CostSheet } from "../costos/CostSheet";
import { buildSheetRows } from "../costos/sheetModel";
import { exportCostSheet } from "../costos/exportCostSheet";

import { formatPct, formatQty } from "../utils/numbers";
interface CentroCostosTabProps {
  project?: Project | null;
  budgetItems: BudgetItem[];
  purchaseOrders?: PurchaseOrder[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  initialOpenImporter?: boolean;
  /** Abre la importación de precios de mano de obra (desde el botón global Crear). */
  laborImportNonce?: number;
}

type SubTab = "control" | "mano-obra" | "adendas" | "importer";

export const SOURCE_LABEL: Record<BudgetMovementSource, string> = {
  PURCHASE_ORDER: "Órdenes de compra",
  SUBCONTRACT: "Subcontratos",
  PETTY_CASH: "Caja chica",
  MANUAL_ADJUSTMENT: "Ajustes manuales",
  CLIENT_CERTIFICATE: "Certificado al cliente",
};

const SOURCE_COLOR: Record<BudgetMovementSource, string> = {
  PURCHASE_ORDER: "bg-amber-500",
  SUBCONTRACT: "bg-indigo-500",
  PETTY_CASH: "bg-teal-500",
  MANUAL_ADJUSTMENT: "bg-stone-400",
  CLIENT_CERTIFICATE: "bg-emerald-500",
};

const qty = (v: number) => formatQty(v);
const pct = (v: number | null, digits = 1) => formatPct(v, digits);

export const CentroCostosTab: React.FC<CentroCostosTabProps> = ({
  project,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  initialOpenImporter = false,
  laborImportNonce,
}) => {
  const [subTab, setSubTab] = useState<SubTab>(initialOpenImporter ? "importer" : "control");
  const [data, setData] = useState<CostControlData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [onlyOver, setOnlyOver] = useState(false);
  const [view, setView] = useState<"tecnica" | "costos">("tecnica");
  const [rubroFilter, setRubroFilter] = useState<number | "">("");
  const [collapsedSheet, setCollapsedSheet] = useState<Set<number>>(new Set());
  const [collapseInit, setCollapseInit] = useState(false);
  const [detail, setDetail] = useState<CostNode | null>(null);
  const [movements, setMovements] = useState<BudgetMovement[]>([]);
  const [itemModal, setItemModal] = useState<{ mode: "create" | "edit"; node?: CostNode } | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const money = (v: number) => formatMoney(v, currency);

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      setData(await api.getCostControl(project.id));
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar el centro de costos", "error");
    } finally {
      setLoading(false);
    }
  }, [project?.id, showToast]);

  useEffect(() => {
    load();
  }, [load, budgetItems]);

  useEffect(() => {
    if (initialOpenImporter) setSubTab("importer");
  }, [initialOpenImporter]);
  useEffect(() => {
    if (laborImportNonce) setSubTab("mano-obra");
  }, [laborImportNonce]);

  // Planilla técnica: al cargar se muestran solo los rubros de primer nivel (se expanden a pedido)
  const headingIds = useMemo(() => (data?.nodes ?? []).filter((n) => n.nodeKind !== "ITEM").map((n) => n.id), [data]);
  useEffect(() => {
    if (!collapseInit && headingIds.length) {
      setCollapsedSheet(new Set(headingIds));
      setCollapseInit(true);
    }
  }, [headingIds, collapseInit]);
  const sheetFilters = { rubroId: rubroFilter || null, onlyDeviation: onlyOver, search };
  const sheetFiltered = Boolean(rubroFilter || onlyOver || search.trim());
  const sheetRows = useMemo(
    () => buildSheetRows(data?.nodes ?? [], { rubroId: rubroFilter || null, onlyDeviation: onlyOver, search }, collapsedSheet),
    [data, rubroFilter, onlyOver, search, collapsedSheet]
  );

  const children = useMemo(() => {
    const map = new Map<number | null, CostNode[]>();
    for (const n of data?.nodes ?? []) {
      const key = n.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return map;
  }, [data]);

  // Con búsqueda o filtro se muestran las partidas que coinciden y sus rubros.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && !onlyOver) return null;
    const byId = new Map((data?.nodes ?? []).map((n) => [n.id, n]));
    const keep = new Set<number>();
    for (const n of data?.nodes ?? []) {
      const matches = (!q || `${n.code} ${n.name}`.toLowerCase().includes(q)) && (!onlyOver || n.overBudget);
      if (!matches) continue;
      let cur: CostNode | undefined = n;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      }
    }
    return keep;
  }, [data, search, onlyOver]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openDetail = async (node: CostNode) => {
    setDetail(node);
    setMovements([]);
    if (!project?.id || node.nodeKind !== "ITEM") return;
    try {
      setMovements(await api.getBudgetMovements(project.id, node.id));
    } catch {
      setMovements([]);
    }
  };

  const rebuild = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const res = await api.rebuildBudgetLedger(project.id);
      showToast(
        `Recalculado: ${res.movements} movimientos${res.postedDocuments ? `, ${res.postedDocuments} documentos sincronizados` : ""}${
          res.skipped.length ? `. ${res.skipped.length} documento(s) sin partida válida` : ""
        }`,
        res.skipped.length ? "info" : "success"
      );
      await load();
    } catch (err: any) {
      showToast(err.message || "No se pudo recalcular", "error");
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (node: CostNode) => {
    if (!window.confirm(`¿Borrar "${node.code} ${node.name}"?`)) return;
    try {
      await api.deleteBudgetItem(node.id);
      showToast("Partida eliminada");
      onRefresh();
      load();
    } catch (err: any) {
      showToast(err.message || "No se pudo borrar", "error");
    }
  };

  const renderRows = (parentId: number | null, depth: number): React.ReactNode =>
    (children.get(parentId) ?? [])
      .filter((n) => !visible || visible.has(n.id))
      .map((n) => {
        const isItem = n.nodeKind === "ITEM";
        const open = visible ? true : expanded.has(n.id);
        return (
          <React.Fragment key={n.id}>
            <tr
              onClick={() => (isItem ? openDetail(n) : toggle(n.id))}
              className={`cursor-pointer border-b border-stone-100 hover:bg-amber-50/40 ${
                n.nodeKind === "RUBRO" ? "bg-stone-50 font-semibold" : ""
              } ${n.overBudget ? "bg-rose-50/70" : ""}`}
            >
              <td className="py-1.5 pr-2 font-mono text-[11px] text-stone-500" style={{ paddingLeft: depth * 16 + 8 }}>
                <span className="inline-flex items-center gap-1">
                  {!isItem &&
                    (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                  {n.code}
                </span>
              </td>
              <td className="max-w-[320px] truncate py-1.5 pr-2" title={n.name}>
                {n.name}
                {n.isSystem && n.nodeKind === "RUBRO" && (
                  <span className="ml-2 rounded bg-stone-200 px-1 text-[10px] font-normal text-stone-600">sistema</span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-stone-500">{isItem ? n.unit : ""}</td>
              <td className="py-1.5 pr-2 text-right font-mono">{isItem ? qty(n.totalQuantity) : ""}</td>
              <td className="py-1.5 pr-2 text-right font-mono">{isItem ? money(n.unitPrice) : ""}</td>
              <td className="py-1.5 pr-2 text-right font-mono">{money(n.budget)}</td>
              <td className="py-1.5 pr-2 text-right font-mono text-amber-800">{money(n.committed)}</td>
              <td className="py-1.5 pr-2 text-right font-mono text-stone-700">{money(n.actual)}</td>
              <td className="py-1.5 pr-2 text-right font-mono text-indigo-700">{isItem && n.subcontractQuantity ? qty(n.subcontractQuantity) : ""}</td>
              <td className={`py-1.5 pr-2 text-right font-mono font-bold ${n.balance < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {money(n.balance)}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono text-emerald-800">
                {isItem ? `${qty(n.certifiedQuantity)} · ${pct(n.progressPct)}` : pct(n.progressPct)}
              </td>
              <td className="py-1.5 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                {!n.isSystem && (
                  <span className="inline-flex gap-1">
                    <button onClick={() => setItemModal({ mode: "edit", node: n })} className="rounded p-1 text-stone-400 hover:text-stone-800" aria-label="Editar">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => removeItem(n)} className="rounded p-1 text-stone-400 hover:text-rose-600" aria-label="Borrar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </td>
            </tr>
            {!isItem && open && renderRows(n.id, depth + 1)}
          </React.Fragment>
        );
      });

  const k = data?.kpis;
  const sourceTotal = Object.entries(k?.bySource ?? {}).reduce((a, [, v]) => a + (v ?? 0), 0);
  const empty = (data?.nodes ?? []).filter((n) => !n.isSystem).length === 0;

  return (
    <Page>
      <PageHeader
        title="Centro de Costos"
        help="Previsto contra ejecutado por ítem, y todo lo que se descontó: compras, subcontratos, caja chica y certificados."
        actions={
          <>
            <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setSubTab("importer")}>
              Importar
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setItemModal({ mode: "create" })}>
              Partida
            </Button>
            <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjustOpen(true)}>
              Ajuste
            </Button>
            <Button variant="ghost" onClick={rebuild} disabled={loading} title="Recalcular desde los documentos">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      <Tabs
        value={subTab}
        onChange={setSubTab}
        items={[
          { value: "control", label: "Control" },
          { value: "mano-obra", label: "Precios de mano de obra" },
          { value: "adendas", label: "Adendas y extras" },
          { value: "importer", label: "Importar presupuesto" },
        ]}
      />

      {subTab === "control" && (
        <>
          {k && (
            <StatGrid>
              <Stat label="Total previsto" value={money(k.budget)} hint={`${data?.nodes.filter((n) => n.nodeKind === "ITEM" && !n.isSystem).length} partidas`} />
              <Stat label="Total ejecutado" value={money(k.certified)} tone="brand" hint={`${pct(k.budget > 0 ? k.certified / k.budget : 0, 1)} de avance físico`} />
              <Stat label="Costo comprometido" value={money(k.committed)} tone="warn" hint={`Saldo de costo ${money(k.balance)}`} />
              <button
                onClick={() => {
                  setView("tecnica");
                  setOnlyOver(true);
                }}
                className="text-left"
                title="Ver solo los ítems con desvío"
              >
                <Stat
                  label="Ítems con excedente"
                  value={k.exceededItems}
                  tone={k.exceededItems > 0 ? "bad" : "good"}
                  hint={k.exceededItems > 0 ? "Ejecutado supera lo previsto · tocá para verlos" : "Ningún ítem supera lo previsto"}
                />
              </button>
            </StatGrid>
          )}

          {empty ? (
            <EmptyState
              icon={<Scale className="h-10 w-10" />}
              title="Esta obra todavía no tiene presupuesto"
              help="Importalo desde Excel para empezar a controlar cantidades y costos."
              action={
                <Button variant="primary" onClick={() => setSubTab("importer")}>
                  Importar presupuesto
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 text-sm font-medium">
                    {(
                      [
                        ["tecnica", "Planilla técnica"],
                        ["costos", "Costos"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-slate-900 text-white" : "text-slate-600"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={rubroFilter}
                    onChange={(e) => setRubroFilter(e.target.value ? Number(e.target.value) : "")}
                    className="max-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Todos los rubros</option>
                    {(data?.nodes ?? [])
                      .filter((n) => n.parentId === null && n.nodeKind !== "ITEM")
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.code ? `${n.code} · ` : ""}
                          {n.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => setOnlyOver(!onlyOver)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                      onlyOver ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    Solo con desvío
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Código o descripción…"
                      className="w-56 rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                  <MoreMenu
                    items={[
                      {
                        label: "Expandir todo",
                        onClick: () => {
                          setCollapsedSheet(new Set());
                          setExpanded(new Set(headingIds));
                        },
                      },
                      {
                        label: "Contraer todo",
                        onClick: () => {
                          setCollapsedSheet(new Set(headingIds));
                          setExpanded(new Set());
                        },
                      },
                      {
                        label: "Exportar todo a Excel",
                        icon: <FileSpreadsheet className="h-4 w-4" />,
                        onClick: () => project && exportCostSheet(buildSheetRows(data?.nodes ?? []), project, false),
                      },
                    ]}
                  />
                  <Button
                    variant="primary"
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                    onClick={() => project && exportCostSheet(buildSheetRows(data?.nodes ?? [], sheetFilters), project, sheetFiltered)}
                  >
                    Exportar Excel
                  </Button>
                </div>
              </div>

              {view === "tecnica" ? (
                <CostSheet
                  rows={sheetRows}
                  nodes={data?.nodes ?? []}
                  filtered={sheetFiltered}
                  collapsed={collapsedSheet}
                  onToggle={(id) =>
                    setCollapsedSheet((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onOpenItem={openDetail}
                />
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[1100px] text-xs">
                    <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="py-2 pl-2 text-left">Código</th>
                        <th className="py-2 text-left">Descripción</th>
                        <th className="py-2 text-left">Un.</th>
                        <th className="py-2 pr-2 text-right">Cant.</th>
                        <th className="py-2 pr-2 text-right">P. unit.</th>
                        <th className="py-2 pr-2 text-right">Previsto</th>
                        <th className="py-2 pr-2 text-right">Comprometido</th>
                        <th className="py-2 pr-2 text-right">Gastado</th>
                        <th className="py-2 pr-2 text-right" title="Cantidad ejecutada por subcontratistas (interno)">
                          Subc. cant.
                        </th>
                        <th className="py-2 pr-2 text-right">Saldo de costo</th>
                        <th className="py-2 pr-2 text-right" title="Certificado al cliente">
                          Avance real
                        </th>
                        <th className="py-2 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>{renderRows(null, 0)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {subTab === "mano-obra" && project && (
        <LaborPricesPanel project={project} currency={currency} showToast={showToast} openImport={laborImportNonce} />
      )}

      {subTab === "adendas" && (
        <RubrosExtrasTab project={project} budgetItems={budgetItems} currency={currency} onRefresh={onRefresh} showToast={showToast} />
      )}

      {subTab === "importer" && (
        <ExcelBudgetImporter
          project={project}
          currency={currency}
          onImportComplete={() => {
            onRefresh();
            load();
          }}
          onBack={() => setSubTab("control")}
          showToast={showToast}
        />
      )}

      {/* Detalle de partida: movimientos del libro mayor */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/30" onClick={() => setDetail(null)}>
          <div className="h-full w-full max-w-xl space-y-4 overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-xs text-stone-500">{detail.code}</p>
                <h3 className="text-base font-bold text-stone-900">{detail.name}</h3>
              </div>
              <button onClick={() => setDetail(null)} aria-label="Cerrar">
                <X className="h-4 w-4 text-stone-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["Presupuesto", money(detail.budget)],
                ["Saldo", money(detail.balance)],
                ["Comprometido", money(detail.committed)],
                ["Gastado", money(detail.actual)],
                ["Avance real", `${qty(detail.certifiedQuantity)} de ${qty(detail.totalQuantity)} ${detail.unit ?? ""} (${pct(detail.progressPct)})`],
                ["Ejecutado por subcontratistas", `${qty(detail.subcontractQuantity)} ${detail.unit ?? ""}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-stone-200 p-2">
                  <p className="text-[10px] uppercase text-stone-500">{label}</p>
                  <p className="font-mono font-bold">{value}</p>
                </div>
              ))}
            </div>
            {Object.keys(detail.bySource).length > 0 && (
              <div className="space-y-1 text-xs">
                <p className="font-bold text-stone-700">Comprometido por origen</p>
                {Object.entries(detail.bySource).map(([src, v]) => (
                  <div key={src} className="flex justify-between">
                    <span>{SOURCE_LABEL[src as BudgetMovementSource]}</span>
                    <span className="font-mono">{money(v ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 text-xs">
              <p className="font-bold text-stone-700">Movimientos</p>
              {movements.length === 0 && <p className="text-stone-400">Sin movimientos imputados.</p>}
              {movements.map((m) => (
                <div key={m.id} className={`rounded-lg border p-2 ${m.reversalOfId ? "border-stone-200 bg-stone-50 text-stone-500" : "border-stone-200"}`}>
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">
                      {m.sourceNumber ?? `${m.sourceType} ${m.sourceId}`} · {SOURCE_LABEL[m.source]} ·{" "}
                      {m.source === "CLIENT_CERTIFICATE" ? "certificado" : m.stage === "COMMITTED" ? "comprometido" : "gastado"}
                    </span>
                    <span className="font-mono font-bold">{money(Number(m.amount))}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-stone-500">
                    <span>
                      {new Date(m.createdAt).toLocaleDateString("es-PY")} {m.note ? `· ${m.note}` : ""}
                      {m.quantity !== null && ` · ${qty(Number(m.quantity))} ${detail.unit ?? ""}`}
                    </span>
                    {m.overBudget && (
                      <span className="flex items-center gap-1 text-rose-600">
                        <AlertTriangle className="h-3 w-3" /> excedió
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {itemModal && project && (
        <BudgetItemModal
          project={project}
          nodes={data?.nodes ?? []}
          mode={itemModal.mode}
          node={itemModal.node}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null);
            onRefresh();
            load();
          }}
          showToast={showToast}
        />
      )}

      {adjustOpen && project && (
        <AdjustmentModal
          project={project}
          currency={currency}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            setAdjustOpen(false);
            load();
          }}
          showToast={showToast}
        />
      )}
    </Page>
  );
};

function BudgetItemModal({
  project,
  nodes,
  mode,
  node,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  nodes: CostNode[];
  mode: "create" | "edit";
  node?: CostNode;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const isItem = mode === "create" || node?.nodeKind === "ITEM";
  const [kind, setKind] = useState<"RUBRO" | "ITEM">(node && node.nodeKind !== "ITEM" ? "RUBRO" : "ITEM");
  const [parentId, setParentId] = useState<number | "">("");
  const [form, setForm] = useState({
    code: node?.code ?? "",
    name: node?.name ?? "",
    unit: node?.unit ?? "un",
    quantity: node ? String(node.totalQuantity) : "1",
    unitPrice: node ? String(node.unitPrice) : "0",
  });
  const [saving, setSaving] = useState(false);
  const headings = nodes.filter((n) => n.nodeKind !== "ITEM" && !n.isSystem);
  const total = parseFlexibleNumber(form.quantity) * parseFlexibleNumber(form.unitPrice);

  const save = async () => {
    setSaving(true);
    try {
      if (mode === "edit" && node) {
        await api.updateBudgetItem(node.id, {
          code: form.code,
          name: form.name,
          ...(node.nodeKind === "ITEM"
            ? {
                unit: form.unit,
                totalQuantity: parseFlexibleNumber(form.quantity),
                unitPrice: parseFlexibleNumber(form.unitPrice),
              }
            : {}),
        });
      } else {
        await api.createBudgetItem({
          projectId: project.id,
          parentId: parentId || undefined,
          nodeKind: kind,
          code: form.code,
          name: form.name,
          ...(kind === "ITEM"
            ? { unit: form.unit, totalQuantity: parseFlexibleNumber(form.quantity), unitPrice: parseFlexibleNumber(form.unitPrice) }
            : {}),
        });
      }
      showToast(mode === "edit" ? "Partida actualizada" : "Partida creada");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full rounded-lg border border-stone-300 px-2 py-1.5";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-xs shadow-xl">
        <h3 className="text-base font-bold text-stone-900">{mode === "edit" ? "Editar partida" : "Nueva partida"}</h3>
        {mode === "create" && (
          <div className="grid grid-cols-2 gap-2">
            <label>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value as "RUBRO" | "ITEM")} className={input}>
                <option value="ITEM">Ítem (recibe gastos)</option>
                <option value="RUBRO">Rubro / subrubro</option>
              </select>
            </label>
            <label>
              Dentro de
              <select value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")} className={input}>
                <option value="">(raíz)</option>
                {headings.map((h) => (
                  <option key={h.id} value={h.id}>
                    {"— ".repeat(h.level)}
                    {h.code} {h.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label>
            Código
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={input} />
          </label>
          <label className="col-span-2">
            Descripción
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </label>
        </div>
        {isItem && kind === "ITEM" && (
          <div className="grid grid-cols-3 gap-2">
            <label>
              Unidad
              <input value={form.unit ?? ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={input} />
            </label>
            <label>
              Cantidad
              <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={input} />
            </label>
            <label>
              Precio unitario
              <input value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} className={input} />
            </label>
            <p className="col-span-3 text-right font-mono font-bold">Total: {formatMoney(total)}</p>
          </div>
        )}
        {mode === "edit" && (
          <p className="text-[11px] text-stone-500">Los cambios quedan registrados en auditoría. Lo ejecutado no se edita: sale de OC, certificados y caja chica.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 font-semibold text-stone-600">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !form.code.trim() || !form.name.trim()}
            className="rounded-lg bg-amber-600 px-4 py-1.5 font-bold text-white disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustmentModal({
  project,
  currency,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [budgetItemId, setBudgetItemId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!budgetItemId) return;
    setSaving(true);
    try {
      const res = await api.createBudgetAdjustment(project.id, {
        budgetItemId,
        amount: parseFlexibleNumber(amount),
        note,
      });
      res.budgetWarnings.forEach((w) => showToast(w.message, "info"));
      showToast("Ajuste registrado");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo registrar el ajuste", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-xs shadow-xl">
        <h3 className="text-base font-bold text-stone-900">Ajuste manual de costo</h3>
        <p className="text-stone-500">
          Para correcciones puntuales (un gasto sin documento, una reclasificación). Monto positivo suma costo; negativo lo resta. Queda en el libro mayor con su motivo.
        </p>
        <BudgetItemSelect projectId={project.id} value={budgetItemId} onChange={setBudgetItemId} currency={currency} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto (ej. 1.500.000 o -250.000)" className="w-full rounded-lg border border-stone-300 px-2 py-1.5" />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo del ajuste (obligatorio)" rows={3} className="w-full rounded-lg border border-stone-300 px-2 py-1.5" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 font-semibold text-stone-600">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !budgetItemId || !amount || note.trim().length < 5}
            className="rounded-lg bg-amber-600 px-4 py-1.5 font-bold text-white disabled:opacity-50"
          >
            Registrar ajuste
          </button>
        </div>
      </div>
    </div>
  );
}
