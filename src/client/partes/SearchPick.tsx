import React, { useMemo, useState } from "react";
import { cx } from "../ui";

export interface PickOption {
  id: number;
  code?: string;
  label: string;
  sub?: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Selector buscable pensado para el celular: muestra la opción elegida y, al tocarla, un buscador
 * con la lista filtrada por código o nombre. Funciona con datos locales (sin conexión).
 */
export function SearchPick({
  options,
  value,
  onChange,
  placeholder,
  allowNone,
  noneLabel = "Sin ítem",
}: {
  options: PickOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.id === value) ?? null;
  const matches = useMemo(() => {
    const t = norm(q.trim());
    const list = t ? options.filter((o) => norm(`${o.code ?? ""} ${o.label} ${o.sub ?? ""}`).includes(t)) : options;
    return list.slice(0, 40);
  }, [q, options]);

  if (!open) {
    return (
      <button
        type="button"
        className={cx("flex w-full items-center gap-2 border border-slate-400 bg-white px-3 py-2.5 text-left text-base", !selected && "text-slate-500")}
        onClick={() => {
          setQ("");
          setOpen(true);
        }}
      >
        {selected ? (
          <>
            {selected.code && <span className="shrink-0 font-mono text-sm">{selected.code}</span>}
            <span className="flex-1 truncate">{selected.label}</span>
          </>
        ) : (
          <span className="flex-1 truncate">{value === null && allowNone ? noneLabel : placeholder}</span>
        )}
      </button>
    );
  }

  const pick = (id: number | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="border border-slate-900 bg-white">
      <input
        className="w-full border-b border-slate-300 px-3 py-2.5 text-base outline-none"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscá por código o nombre"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            pick(matches[0].id);
          }
        }}
      />
      <ul className="max-h-64 overflow-y-auto">
        {allowNone && (
          <li>
            <button type="button" className="w-full border-b border-slate-100 px-3 py-2.5 text-left text-base text-slate-600" onClick={() => pick(null)}>
              {noneLabel}
            </button>
          </li>
        )}
        {matches.map((o) => (
          <li key={o.id}>
            <button type="button" className="flex w-full items-baseline gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-base" onClick={() => pick(o.id)}>
              {o.code && <span className="w-16 shrink-0 font-mono text-sm">{o.code}</span>}
              <span className="flex-1">{o.label}</span>
              {o.sub && <span className="shrink-0 text-sm text-slate-500">{o.sub}</span>}
            </button>
          </li>
        ))}
        {!matches.length && <li className="px-3 py-3 text-sm text-slate-500">Sin resultados</li>}
      </ul>
      <button type="button" className="w-full border-t border-slate-300 py-2 text-sm underline" onClick={() => setOpen(false)}>
        Cerrar
      </button>
    </div>
  );
}
