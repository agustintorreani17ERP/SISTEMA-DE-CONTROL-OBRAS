import type React from "react";
import {
  Calculator,
  ClipboardCheck,
  LayoutDashboard,
  Package,
  Scale,
  Send,
  ShoppingCart,
  Truck,
  Boxes,
  Users,
} from "lucide-react";

/**
 * InfraTrack se sirve como dos apps sobre el mismo servidor y la misma base:
 *  - ERP  (/erp):  oficina central — compras, y consulta de certificados y stock por obra.
 *  - ECMS (/ecms): ingenieros en obra — presupuesto, costos, pedidos, certificados y stock.
 * Qué módulos se activan para cada obra lo decide ObraStudio; esto solo define el menú de cada app.
 */
export type AppId = "ERP" | "ECMS";

export type ActiveTab =
  | "dashboard"
  | "centro-costos"
  | "previsto"
  | "ejecucion-certificaciones"
  | "suministros"
  | "stock"
  | "solicitudes-fondos"
  | "notas-envio"
  | "partes-diarios"
  | "contabilidad-finanzas"
  | "rrhh"
  | "configuracion"
  // Alias heredados
  | "certificaciones"
  | "subcontratistas";

export type SuministrosSubTab = "pedidos" | "compras" | "bandeja" | "stock" | "materiales" | "proveedores";

export type CreateActionId =
  | "new-request"
  | "new-order"
  | "new-note"
  | "stock-out"
  | "stock-adjust"
  | "new-measurement"
  | "new-contract"
  | "new-invoice"
  | "petty-expense"
  | "import-budget"
  | "labor-prices"
  | "new-project";

export interface AppMenuItem {
  id: ActiveTab;
  label: string;
  icon: React.ElementType;
  badge?: "compras" | "certificados";
}

export interface AppDef {
  id: AppId;
  /** Nombre en la marca del menú lateral. */
  name: string;
  tagline: string;
  /** Ruta donde Express sirve la app. */
  basePath: string;
  menu: AppMenuItem[];
  /** Sub-secciones de Compras / Pedidos que muestra la app. */
  suministros: { title: string; help: string; subs: Exclude<SuministrosSubTab, "stock" | "materiales" | "proveedores">[] };
  /** Pestañas de solo consulta. */
  readOnly: ActiveTab[];
  /** Catálogo que se edita en esta app (Configuración). */
  catalogo: "insumos" | "proveedores";
  createActions: CreateActionId[];
}

export const APPS: Record<AppId, AppDef> = {
  ERP: {
    id: "ERP",
    name: "ERP",
    tagline: "Oficina central",
    basePath: "/erp",
    menu: [
      { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
      { id: "previsto", label: "Previsto vs Ejecutado", icon: Scale },
      { id: "suministros", label: "Compras", icon: ShoppingCart, badge: "compras" },
      { id: "ejecucion-certificaciones", label: "Certificados", icon: ClipboardCheck },
      { id: "stock", label: "Stock", icon: Package },
      { id: "solicitudes-fondos", label: "Solicitudes de fondos", icon: Send },
      { id: "notas-envio", label: "Notas de envío", icon: Truck },
    ],
    suministros: {
      title: "Compras",
      help: "Pedidos de obra y del taller → orden de compra. Al emitir la OC se descuenta del rubro; al recibirla entra al stock.",
      subs: ["bandeja", "compras"],
    },
    readOnly: ["ejecucion-certificaciones", "stock"],
    catalogo: "insumos",
    createActions: ["new-order", "new-note", "new-project"],
  },
  ECMS: {
    id: "ECMS",
    name: "ECMS",
    tagline: "Engineering Control Management System",
    basePath: "/ecms",
    menu: [
      { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
      { id: "centro-costos", label: "Centro de Costos", icon: Calculator },
      { id: "previsto", label: "Previsto vs Ejecutado", icon: Scale },
      { id: "suministros", label: "Pedidos de materiales", icon: Boxes, badge: "compras" },
      { id: "ejecucion-certificaciones", label: "Certificados", icon: ClipboardCheck, badge: "certificados" },
      { id: "stock", label: "Stock", icon: Package },
      { id: "notas-envio", label: "Notas de envío", icon: Truck },
    ],
    suministros: {
      title: "Pedidos de materiales",
      help: "Pedí los materiales de la obra por rubro del presupuesto. Compras los convierte en órdenes de compra desde el ERP.",
      subs: ["pedidos"],
    },
    readOnly: [],
    catalogo: "proveedores",
    createActions: ["new-request", "stock-out", "stock-adjust", "new-measurement", "new-contract", "import-budget", "labor-prices", "new-note", "new-project"],
  },
};

/** Pestañas navegables de una app (el menú más Configuración y los alias heredados). */
export function tabsOf(app: AppId): ActiveTab[] {
  const tabs = APPS[app].menu.map((m) => m.id);
  tabs.push("configuracion");
  if (tabs.includes("centro-costos")) tabs.push("certificaciones");
  if (tabs.includes("ejecucion-certificaciones")) tabs.push("subcontratistas");
  return tabs;
}

export const isReadOnlyTab = (app: AppId, tab: ActiveTab) => APPS[app].readOnly.includes(tab);

/** App que corresponde a la ruta actual (/ecms → ECMS; cualquier otra cosa → ERP). */
export function appFromPath(pathname: string): AppId {
  return pathname.startsWith("/ecms") ? "ECMS" : "ERP";
}
