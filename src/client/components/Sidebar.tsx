import React from "react";
import {
  Building2,
  Calculator,
  ClipboardCheck,
  HardHat,
  Home,
  Package,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingCart,
  Wallet,
  Users,
} from "lucide-react";
import { Project, User } from "../types";
import { cx } from "../ui";

export type ActiveTab =
  | "dashboard"
  | "centro-costos"
  | "ejecucion-certificaciones"
  | "suministros"
  | "stock"
  | "partes-diarios"
  | "contabilidad-finanzas"
  | "rrhh"
  | "configuracion"
  // Alias heredados
  | "certificaciones"
  | "subcontratistas";

export type SuministrosSubTab = "pedidos" | "compras" | "stock" | "materiales" | "proveedores";

export interface SidebarBadges {
  compras?: number;
  certificados?: number;
}

interface SidebarProps {
  activeTab: ActiveTab;
  onNavigate: (tab: ActiveTab) => void;
  onGoPortfolio: () => void;
  project?: Project | null;
  currentUser?: User | null;
  onLogout: () => void;
  badges?: SidebarBadges;
}

const PROJECT_MENU: { id: ActiveTab; label: string; icon: React.ElementType; badge?: keyof SidebarBadges }[] = [
  { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
  { id: "centro-costos", label: "Centro de Costos", icon: Calculator },
  { id: "suministros", label: "Compras", icon: ShoppingCart, badge: "compras" },
  { id: "stock", label: "Stock", icon: Package },
  { id: "ejecucion-certificaciones", label: "Certificados", icon: ClipboardCheck, badge: "certificados" },
  { id: "contabilidad-finanzas", label: "Finanzas", icon: Wallet },
  { id: "partes-diarios", label: "Campo", icon: HardHat },
  { id: "rrhh", label: "RRHH", icon: Users },
];

const isActive = (active: ActiveTab, id: ActiveTab) =>
  active === id ||
  (id === "centro-costos" && active === "certificaciones") ||
  (id === "ejecucion-certificaciones" && active === "subcontratistas");

/** Menú lateral: Inicio (cartera) y, dentro de la obra, sus módulos. */
export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigate,
  onGoPortfolio,
  project,
  currentUser,
  onLogout,
  badges = {},
}) => {
  const item = (active: boolean) =>
    cx(
      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
      active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    );

  return (
    <aside className="flex h-full w-60 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">InfraTrack</p>
          <p className="text-[11px] text-slate-500">Control de obras</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <button onClick={onGoPortfolio} className={item(!project)}>
          <Home className="h-4 w-4" />
          Todas las obras
        </button>

        {project && (
          <div className="space-y-1">
            <p className="truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400" title={project.name}>
              {project.code} · {project.name}
            </p>
            {PROJECT_MENU.map(({ id, label, icon: Icon, badge }) => (
              <button key={id} onClick={() => onNavigate(id)} className={item(isActive(activeTab, id))}>
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{label}</span>
                {badge && (badges[badge] ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{badges[badge]}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="space-y-1 border-t border-slate-100 p-3">
        {project && (
          <button onClick={() => onNavigate("configuracion")} className={item(activeTab === "configuracion")}>
            <Settings className="h-4 w-4" />
            Configuración
          </button>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
            {currentUser?.initials || "US"}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-slate-800">{currentUser?.fullName || "Usuario"}</p>
            <p className="truncate text-[11px] text-slate-500">{currentUser?.roleLabel || currentUser?.role}</p>
          </div>
          <button onClick={onLogout} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
