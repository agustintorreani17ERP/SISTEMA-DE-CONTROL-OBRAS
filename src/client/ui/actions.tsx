/**
 * Piezas de acción: la acción principal siempre visible, las secundarias en "⋯",
 * filtros por estado como chips y asistentes paso a paso.
 */
import React, { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal, Search } from "lucide-react";
import { cx, StatusDot, type PillTone } from "./index";

/* ─── Menú desplegable ─────────────────────────────────────────────────── */

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  group?: string;
}

export function Menu({
  trigger,
  items,
  align = "right",
  width = "w-56",
}: {
  trigger: (open: () => void) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  let lastGroup: string | undefined;
  return (
    <div ref={ref} className="relative inline-block">
      {trigger(() => setOpen((v) => !v))}
      {open && (
        <div
          className={cx(
            "absolute z-40 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg",
            width,
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((item, i) => {
            const header = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <React.Fragment key={i}>
                {header && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header}</p>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    item.onClick();
                  }}
                  className={cx(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50",
                    item.danger ? "text-rose-600" : "text-slate-700"
                  )}
                >
                  {item.icon && <span className="text-slate-400">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-xs text-slate-400">{item.hint}</span>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Botón "⋯" con acciones secundarias. */
export function MoreMenu({ items }: { items: MenuItem[] }) {
  if (!items.length) return null;
  return (
    <Menu
      items={items}
      trigger={(toggle) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Más acciones"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    />
  );
}

/* ─── Barra de acciones con chips de estado ───────────────────────────── */

export interface Chip<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Punto de color del estado (mismo tono que su StatusPill). */
  tone?: PillTone;
}

export function ActionBar<T extends string>({
  chips,
  chip,
  onChip,
  search,
  onSearch,
  primary,
  secondary,
}: {
  chips?: Chip<T>[];
  chip?: T;
  onChip?: (value: T) => void;
  search?: string;
  onSearch?: (value: string) => void;
  primary?: React.ReactNode;
  secondary?: MenuItem[];
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips?.map((c) => (
          <button
            key={c.value}
            onClick={() => onChip?.(c.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
              chip === c.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            {c.tone && <StatusDot tone={c.tone} />}
            {c.label}
            {c.count !== undefined && (
              <span className={cx("rounded-full px-1.5 text-[11px]", chip === c.value ? "bg-white/20" : "bg-slate-100 text-slate-500")}>
                {c.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {onSearch && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar…"
              className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        )}
        {secondary && <MoreMenu items={secondary} />}
        {primary}
      </div>
    </div>
  );
}

/* ─── Asistente paso a paso ───────────────────────────────────────────── */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cx(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
              i < current ? "bg-emerald-500 text-white" : i === current ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cx(i === current ? "font-medium text-slate-900" : "text-slate-500")}>{label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-slate-200" />}
        </li>
      ))}
    </ol>
  );
}

/* ─── Línea de tiempo de un documento ─────────────────────────────────── */

export function Timeline({ steps }: { steps: { label: string; done: boolean; date?: string | null }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-3 text-sm">
          <span className={cx("h-2.5 w-2.5 rounded-full", s.done ? "bg-emerald-500" : "bg-slate-200")} />
          <span className={s.done ? "text-slate-800" : "text-slate-400"}>{s.label}</span>
          {s.date && <span className="ml-auto text-xs text-slate-400">{new Date(s.date).toLocaleDateString("es-PY")}</span>}
        </li>
      ))}
    </ol>
  );
}
