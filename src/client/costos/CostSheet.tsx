import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
export function CostSheet({ rows, nodes, filtered, collapsed, onToggle, onOpenItem }: CostSheetProps) {
  const totals = sheetTotals(rows, nodes, filtered);

  return (
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-[13px]">
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
            ].map(([label, cls]) => (
              <th key={label} className={cx("sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5", cls)}>
                {label}
              </th>
            ))}
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
                <td className={cx("sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500", bg)}>{n.code}</td>
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
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
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
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
