import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ImputableItem } from "../types";
import { formatMoney } from "../utils/format";

interface BudgetItemSelectProps {
  projectId?: number | null;
  value: number | "" | null | undefined;
  onChange: (budgetItemId: number | "") => void;
  currency?: "PYG" | "USD";
  /** Partidas precargadas (evita un pedido por cada selector en una tabla). */
  items?: ImputableItem[];
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

/** Hook para cargar una sola vez las partidas imputables de la obra. */
export function useImputableItems(projectId?: number | null) {
  const [items, setItems] = useState<ImputableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setItems(await api.getImputableItems(projectId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { items, loading, reload };
}

/**
 * Selector de rubro de destino para OC, pedidos y caja chica. Muestra solo partidas hoja
 * agrupadas por rubro, con su saldo, y al final Gastos Generales.
 */
export const BudgetItemSelect: React.FC<BudgetItemSelectProps> = ({
  projectId,
  value,
  onChange,
  currency = "PYG",
  items: preloaded,
  placeholder = "Elegí el rubro de destino…",
  className = "",
  required,
  disabled,
}) => {
  const { items: fetched } = useImputableItems(preloaded ? null : projectId);
  const items = preloaded ?? fetched;

  const groups = useMemo(() => {
    const map = new Map<string, ImputableItem[]>();
    for (const item of items) {
      const key = item.isSystem ? "Gastos Generales / No imputados" : item.rubro || "Sin rubro";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a.startsWith("Gastos Generales") ? 1 : b.startsWith("Gastos Generales") ? -1 : 0
    );
  }, [items]);

  const selected = items.find((i) => i.id === value);

  return (
    <div className="space-y-1">
      <select
        value={value ?? ""}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
        className={`w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 focus:border-amber-500 focus:outline-none ${className}`}
      >
        <option value="">{items.length ? placeholder : "Sin presupuesto cargado (usá Gastos Generales)"}</option>
        {groups.map(([rubro, list]) => (
          <optgroup key={rubro} label={rubro}>
            {list.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name} — saldo {formatMoney(item.balance, currency)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && selected.balance < 0 && (
        <p className="text-[10px] font-semibold text-rose-600">
          Partida excedida en {formatMoney(-selected.balance, currency)}: la operación se registra igual y queda marcada.
        </p>
      )}
    </div>
  );
};
