import React from "react";
import { ChevronDown, ChevronRight, Edit2, Trash2 } from "lucide-react";
import type { CostNode } from "../types";
import { cx } from "../ui";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { SheetRow, sheetTotals } from "./sheetModel";

interface CostSheetProps {
  rows: SheetRow[];
  nodes: CostNode[];
  filtered: boolean;
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  onOpenItem: (node: CostNode) => void;
  onOpenAcu?: (node: CostNode) => void;
  onEdit?: (node: CostNode) => void;
  onDelete?: (node: CostNode) => void;
}

const num = "px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap";

function Progress({ value, exceeded }: { value: number | null; exceeded: boolean }) {
  if (value === null) return <span className="text-slate-300">—</span>;
  const bad = exceeded || value > 1 + 1e-9;
  return (
    <div className="flex items-center justify-end gap-2" title={bad ? "Lo ejecutado supera lo previsto" : undefined}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
        <div className={cx("h-full rounded-full", bad ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} />
      </div>
      <span className={cx("w-16 font-mono tabular-nums", bad && "font-semibold text-rose-600")}>{formatPct(value)}</span>
    </div>
  );
}

/**
 * Planilla técnica de cómputo y presupuesto: cantidades previstas vs. ejecutadas
 * (certificado al cliente aprobado), saldos y avance físico, con rubros colapsables.
 */
const share = (v: number | null) => (v === null ? "" : formatPct(v, 0));

export function CostSheet({ rows, nodes, filtered, collapsed, onToggle, onOpenItem, onOpenAcu, onEdit, onDelete }: CostSheetProps) {
  const showActions = Boolean(onEdit || onDelete);
  const totals = sheetTotals(rows, nodes, filtered);

  return (
    <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1980px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {[
              ["Ítem", "sticky left-0 z-30 w-24 min-w-24"],
              ["Descripción", "sticky left-24 z-30 min-w-[320px]"],
              ["Un.", "w-14"],
              ["Cant. prevista", "text-right"],
              ["Cant. ejecutada", "text-right"],
              ["Saldo cant.", "text-right"],
              ["% avance físico", "text-right w-40"],
              ["P.U. (Gs.)", "text-right"],
              ["Total previsto (Gs.)", "text-right"],
              ["Total ejecutado (Gs.)", "text-right"],
              ["Saldo (Gs.)", "text-right"],
              ["Costo meta unit.", "text-right border-l border-slate-300"],
              ["Costo meta total", "text-right"],
              ["% Mat.", "text-right"],
              ["% MO", "text-right"],
              ["% Eq.", "text-right"],
              ["Margen previsto (Gs.)", "text-right"],
              ["Margen %", "text-right"],
            ].map(([label, cls]) => (
              <th key={label} className={cx("sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5", cls)}>
                {label}
              </th>
            ))}
            {showActions && <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 w-16" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const n = r.node;
            const rubro = n.nodeKind === "RUBRO";
            const heading = !r.isItem;
            const zebra = idx % 2 === 1;
            const bg = r.exceeded && r.isItem ? "bg-rose-50" : rubro ? "bg-slate-100" : zebra ? "bg-slate-50/60" : "bg-white";
            return (
              <tr
                key={n.id}
                onClick={() => (r.hasChildren ? onToggle(n.id) : r.isItem && onOpenItem(n))}
                className={cx("cursor-pointer hover:brightness-[0.98]", rubro && "font-semibold text-slate-900")}
              >
                <td className={cx("sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500", bg)}>
                  {n.code}
                  {r.isItem && n.pareto && (
                    <span className="ml-1 text-slate-900" title="Pareto: entre los ítems que suman el 80 % del monto">
                      ●
                    </span>
                  )}
                </td>
                <td className={cx("sticky left-24 z-10 border-b border-slate-100 py-1.5 pr-3", bg)} style={{ paddingLeft: 12 + r.depth * 16 }}>
                  <span className="flex items-center gap-1">
                    {r.hasChildren ? (
                      collapsed.has(n.id) ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className={cx("truncate", heading && !rubro && "font-medium text-slate-800")} title={n.name}>
                      {n.name}
                    </span>
                    {r.exceeded && r.isItem && <span className="ml-1 shrink-0 rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700">Excedente</span>}
                  </span>
                </td>
                <td className={cx("border-b border-slate-100 px-3 py-1.5 text-slate-500", bg)}>{r.isItem ? n.unit : ""}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{r.isItem ? formatQty(r.plannedQty) : ""}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{r.isItem ? formatQty(r.executedQty) : ""}</td>
                <td className={cx(num, "border-b border-slate-100", bg, (r.balanceQty ?? 0) < 0 && "text-rose-600")}>{r.isItem ? formatQty(r.balanceQty) : ""}</td>
                <td className={cx("border-b border-slate-100 px-3 py-1.5", bg)}>
                  <Progress value={r.progress} exceeded={r.exceeded && r.isItem} />
                </td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{r.isItem ? formatGs(r.unitPrice) : ""}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{formatGs(r.plannedTotal)}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{formatGs(r.executedTotal)}</td>
                <td className={cx(num, "border-b border-slate-100", bg, r.balanceTotal < 0 && "text-rose-600")}>{formatGs(r.balanceTotal)}</td>
                <td
                  className={cx(num, "border-b border-l border-slate-100 border-l-slate-300", bg, n.acuSuperaOferta && "font-semibold text-red-600", r.isItem && onOpenAcu && "underline decoration-dotted underline-offset-2")}
                  onClick={(e) => {
                    if (!r.isItem || !onOpenAcu) return;
                    e.stopPropagation();
                    onOpenAcu(n);
                  }}
                  title={
                    !r.isItem
                      ? undefined
                      : n.costoMetaFuente === "ACU"
                      ? n.acuSuperaOferta
                        ? "El ACU supera el costo de la oferta (PU ÷ K) · abrir ACU"
                        : "Costo meta según ACU · abrir ACU"
                      : n.costoMetaFuente === "K"
                      ? "Sin ACU: PU ÷ K · abrir ACU para cargarlo"
                      : "Sin ACU ni K de la obra · abrir ACU"
                  }
                >
                  {r.isItem ? (
                    r.costoMetaUnit === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>
                        {formatGs(r.costoMetaUnit)}
                        {n.costoMetaFuente === "K" && <span className="ml-1 text-[10px] text-slate-400">÷K</span>}
                      </>
                    )
                  ) : (
                    ""
                  )}
                </td>
                <td className={cx(num, "border-b border-slate-100", bg)} title={!r.isItem && n.itemsSinCostoMeta ? `${n.itemsSinCostoMeta} ítem(s) sin costo meta` : undefined}>
                  {r.costoMetaTotal === null ? <span className="text-slate-400">—</span> : formatGs(r.costoMetaTotal)}
                </td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{share(r.shareMaterial)}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{share(r.shareManoObra)}</td>
                <td className={cx(num, "border-b border-slate-100", bg)}>{share(r.shareEquipo)}</td>
                <td className={cx(num, "border-b border-slate-100", bg, (r.margenPrevisto ?? 0) < 0 && "text-red-600")}>
                  {r.margenPrevisto === null ? "" : formatGs(r.margenPrevisto)}
                </td>
                <td className={cx(num, "border-b border-slate-100", bg, (r.margenPct ?? 0) < 0 && "font-semibold text-red-600")}>
                  {r.margenPct === null ? "" : formatPct(r.margenPct)}
                </td>
                {showActions && (
                  <td className={cx("border-b border-slate-100 px-3 py-1.5 text-right", bg)} onClick={(e) => e.stopPropagation()}>
                    {!n.isSystem && (
                      <span className="inline-flex gap-1">
                        {onEdit && (
                          <button onClick={() => onEdit(n)} className="rounded p-1 text-slate-400 hover:text-slate-900" aria-label="Editar">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(n)} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="Borrar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showActions ? 19 : 18} className="px-4 py-10 text-center text-slate-400">
                No hay partidas con esos filtros.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-white">
            <td className="sticky bottom-0 left-0 z-20 bg-slate-800 px-3 py-2.5" />
            <td className="sticky bottom-0 left-24 z-20 bg-slate-800 px-3 py-2.5">{filtered ? "TOTAL (filtrado)" : "TOTAL GENERAL"}</td>
            <td colSpan={4} className="sticky bottom-0 z-10 bg-slate-800" />
            <td className="sticky bottom-0 z-10 bg-slate-800 px-3 py-2.5 text-right font-mono tabular-nums">{formatPct(totals.progress)}</td>
            <td className="sticky bottom-0 z-10 bg-slate-800" />
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{formatGs(totals.planned)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{formatGs(totals.executed)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{formatGs(totals.balance)}</td>
            <td className="sticky bottom-0 z-10 bg-slate-800" />
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{formatGs(totals.costoMeta)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{share(totals.shareMaterial)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{share(totals.shareManoObra)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{share(totals.shareEquipo)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{formatGs(totals.margen)}</td>
            <td className={cx(num, "sticky bottom-0 z-10 bg-slate-800 py-2.5")}>{totals.margenPct === null ? "" : formatPct(totals.margenPct)}</td>
            {showActions && <td className="sticky bottom-0 z-10 bg-slate-800 py-2.5" />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
