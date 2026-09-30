import React from "react";
import type { ImputableItem, InsumoTipo } from "../types";
import { BudgetItemSelect } from "../components/BudgetItemSelect";
import { cx } from "../ui";

/** Regla de imputación por tipo de insumo (CLAUDE.md): solo el DIRECTO exige ítem. */
export const itemRequired = (tipo?: InsumoTipo) => tipo === "DIRECTO";
export const itemAllowed = (tipo?: InsumoTipo) => tipo !== "COMUN";

export const TIPO_HELP: Record<InsumoTipo, string> = {
  DIRECTO: "Directo: el documento trae el ítem",
  COMUN: "Común: entra al stock de la obra y se reparte por ACU",
  TIEMPO: "Tiempo: con ítem se carga a ese ítem; sin ítem se prorratea",
};

export function ImputacionCell({
  tipo,
  projectId,
  items,
  value,
  onChange,
  currency,
  showError,
}: {
  tipo?: InsumoTipo;
  projectId: number;
  items: ImputableItem[];
  value: number | "";
  onChange: (v: number | "") => void;
  currency: "PYG" | "USD";
  showError?: boolean;
}) {
  if (!tipo) return <span className="block px-1 py-2 text-xs text-slate-400">Elegí el insumo</span>;
  if (!itemAllowed(tipo)) {
    return (
      <span className="block px-1 py-2 text-sm text-slate-700" title={TIPO_HELP.COMUN}>
        Stock de obra
      </span>
    );
  }
  const missing = itemRequired(tipo) && !value;
  return (
    <div title={TIPO_HELP[tipo]} className={cx(showError && missing && "rounded-xl ring-2 ring-red-600")}>
      <BudgetItemSelect
        projectId={projectId}
        items={items}
        value={value}
        onChange={onChange}
        currency={currency}
        placeholder={tipo === "DIRECTO" ? "Ítem (obligatorio)" : "Ítem (opcional)"}
      />
    </div>
  );
}
