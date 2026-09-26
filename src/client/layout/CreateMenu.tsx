import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  HardHat,
  PackageMinus,
  Plus,
  Receipt,
  Ruler,
  ShoppingCart,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { cx } from "../ui";

export type CreateAction =
  | "new-request"
  | "new-order"
  | "stock-out"
  | "stock-adjust"
  | "new-measurement"
  | "new-contract"
  | "new-invoice"
  | "petty-expense"
  | "import-budget"
  | "labor-prices"
  | "new-project";

interface ActionDef {
  id: CreateAction;
  label: string;
  group: string;
  icon: React.ElementType;
  keywords: string;
  needsProject?: boolean;
}

const ACTIONS: ActionDef[] = [
  { id: "new-request", label: "Nuevo pedido de materiales", group: "Compras", icon: ClipboardList, keywords: "pedido requisicion material", needsProject: true },
  { id: "new-order", label: "Nueva orden de compra", group: "Compras", icon: ShoppingCart, keywords: "oc orden compra proveedor", needsProject: true },
  { id: "stock-out", label: "Salida de stock a obra", group: "Stock", icon: PackageMinus, keywords: "stock salida consumo deposito", needsProject: true },
  { id: "stock-adjust", label: "Ajuste de stock", group: "Stock", icon: Boxes, keywords: "stock ajuste inventario", needsProject: true },
  { id: "new-measurement", label: "Nueva medición", group: "Certificados", icon: Ruler, keywords: "medicion certificado avance subcontratista computo", needsProject: true },
  { id: "new-contract", label: "Nuevo contrato de subcontratista", group: "Certificados", icon: HardHat, keywords: "contrato subcontratista", needsProject: true },
  { id: "new-invoice", label: "Registrar factura", group: "Finanzas", icon: Receipt, keywords: "factura proveedor", needsProject: true },
  { id: "petty-expense", label: "Gasto de caja chica", group: "Finanzas", icon: Wallet, keywords: "caja chica gasto fondo", needsProject: true },
  { id: "import-budget", label: "Importar presupuesto", group: "Centro de Costos", icon: FileSpreadsheet, keywords: "presupuesto excel importar", needsProject: true },
  { id: "labor-prices", label: "Precios de mano de obra", group: "Centro de Costos", icon: SlidersHorizontal, keywords: "mano obra precios subcontratista lista", needsProject: true },
  { id: "new-project", label: "Nueva obra", group: "General", icon: Building2, keywords: "obra proyecto nuevo" },
];

/**
 * Botón "+ Crear" del encabezado, paleta con atajo (N o Ctrl+K) y botón flotante en celular.
 * Cada opción abre directamente su formulario.
 */
export function CreateMenu({ hasProject, onAction }: { hasProject: boolean; onAction: (action: CreateAction) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ACTIONS.filter((a) => (hasProject || !a.needsProject) && (!q || `${a.label} ${a.keywords}`.toLowerCase().includes(q)));
  }, [query, hasProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key.toLowerCase() === "n" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const run = (a: ActionDef) => {
    setOpen(false);
    onAction(a.id);
  };

  let lastGroup = "";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-brand-700 sm:inline-flex"
        title="Crear (N)"
      >
        <Plus className="h-4 w-4" /> Crear
        <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px] font-semibold">N</kbd>
      </button>

      {/* Botón flotante en celular */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg sm:hidden"
        aria-label="Crear"
      >
        <Plus className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4">
              <FileText className="h-4 w-4 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setActive((i) => Math.min(available.length - 1, i + 1));
                  if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
                  if (e.key === "Enter" && available[active]) run(available[active]);
                }}
                placeholder="¿Qué querés crear? (medición, pedido, OC…)"
                className="w-full py-3.5 text-sm focus:outline-none"
              />
              <kbd className="rounded border border-slate-200 px-1.5 text-[10px] text-slate-400">ESC</kbd>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {available.map((a, i) => {
                const header = a.group !== lastGroup ? a.group : null;
                lastGroup = a.group;
                const Icon = a.icon;
                return (
                  <React.Fragment key={a.id}>
                    {header && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header}</p>}
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(a)}
                      className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", i === active ? "bg-brand-50 text-brand-800" : "text-slate-700")}
                    >
                      <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg", i === active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {a.label}
                    </button>
                  </React.Fragment>
                );
              })}
              {available.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-slate-400">{hasProject ? "No hay acciones que coincidan." : "Abrí una obra para crear documentos."}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
