import React, { useState } from "react";
import {
  Building2,
  Package,
  FileCheck,
  HardHat,
  ChevronDown,
  ChevronRight,
  LogOut,
  Coins,
  FileSpreadsheet,
  Check,
  Plus,
  ArrowLeft,
  LayoutGrid,
  Layers,
  Wallet,
  ShoppingCart,
  Warehouse,
  ClipboardList,
} from "lucide-react";
import { Project, User } from "../types";

export type ActiveTab =
  | "dashboard"
  | "centro-costos"
  | "ejecucion-certificaciones"
  | "suministros"
  | "partes-diarios"
  | "contabilidad-finanzas"
  // Backward-compatible aliases
  | "certificaciones"
  | "subcontratistas";

export type SuministrosSubTab = "pedidos" | "compras" | "stock" | "materiales" | "proveedores";

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  suministrosSubTab?: SuministrosSubTab;
  setSuministrosSubTab?: (sub: SuministrosSubTab) => void;
  projects: Project[];
  selectedProjectId?: number;
  onSelectProject: (id: number) => void;
  currentUser: User;
  onLogout: () => void;
  currency: "PYG" | "USD";
  onToggleCurrency: () => void;
  pendingRequisitionsCount: number;
  pendingOrdersCount: number;
  pendingCertificatesCount: number;
  lowStockCount: number;
  onOpenBudgetImporter?: () => void;
  onOpenCreateProject?: () => void;
  onBackToPortal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  suministrosSubTab = "pedidos",
  setSuministrosSubTab,
  projects,
  selectedProjectId,
  onSelectProject,
  currentUser,
  onLogout,
  currency,
  onToggleCurrency,
  pendingRequisitionsCount,
  pendingOrdersCount,
  pendingCertificatesCount,
  lowStockCount,
  onOpenBudgetImporter,
  onOpenCreateProject,
  onBackToPortal,
}) => {
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [suministrosMenuOpen, setSuministrosMenuOpen] = useState(true);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];
  const totalSuministrosBadge = pendingRequisitionsCount + pendingOrdersCount + lowStockCount;

  // Exact 6-item hierarchy specified by user
  const navItems = [
    {
      id: "dashboard" as ActiveTab,
      label: "Dashboard de Obra",
      icon: Building2,
      badge: null,
    },
    {
      id: "centro-costos" as ActiveTab,
      label: "Centro de Costos (WBS)",
      icon: Layers,
      badge: null,
    },
    {
      id: "ejecucion-certificaciones" as ActiveTab,
      label: "Ejecución & Certificaciones",
      icon: FileCheck,
      badge: pendingCertificatesCount > 0 ? pendingCertificatesCount : null,
      badgeColor: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    },
    {
      id: "suministros" as ActiveTab,
      label: "Suministros y Logística",
      icon: Package,
      badge: totalSuministrosBadge > 0 ? totalSuministrosBadge : null,
      badgeColor: "bg-amber-100 text-amber-800 border border-amber-200",
      hasSubmenu: true,
    },
    {
      id: "partes-diarios" as ActiveTab,
      label: "Partes Diarios & Frentes",
      icon: HardHat,
      badge: null,
    },
    {
      id: "contabilidad-finanzas" as ActiveTab,
      label: "Contabilidad y Finanzas",
      icon: Wallet,
      badge: null,
    },
  ];

  return (
    <aside className="w-64 bg-white text-slate-700 flex flex-col h-screen shrink-0 border-r border-slate-200 select-none z-30 font-sans shadow-xs">
      {/* Top Branding & Project Card */}
      <div className="p-3.5 border-b border-slate-200 space-y-3 bg-white">
        {/* Brand Logo */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-xs shadow-sm">
              CCC
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 tracking-tight">InfraTrack</span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  ERP
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-medium">Constructora CCC S.A.</span>
            </div>
          </div>
        </div>

        {/* Back to Project Selection Portal Button */}
        {onBackToPortal && (
          <button
            onClick={onBackToPortal}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-[11px] font-bold text-slate-700 hover:text-blue-700 transition cursor-pointer"
            title="Volver a la selección de obras"
          >
            <div className="flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5 text-blue-600" />
              <span>Ver Todas las Obras</span>
            </div>
            <ArrowLeft className="w-3 h-3 text-slate-400 rotate-180" />
          </button>
        )}

        {/* Project Selector Box */}
        <div className="relative">
          <button
            onClick={() => setShowProjectDropdown(!showProjectDropdown)}
            className="w-full text-left p-2.5 rounded-xl bg-white hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 transition flex items-center gap-2.5 group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase block">
                OBRA ACTUAL
              </span>
              <p className="text-xs font-bold text-slate-900 group-hover:text-blue-700 truncate leading-tight mt-0.5">
                {currentProject?.name || "Sin Obra Seleccionada"}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {/* Projects Dropdown */}
          {showProjectDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="text-[10px] font-bold text-slate-400 px-2 py-1 uppercase">
                Cambiar de Proyecto
              </div>
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => {
                    onSelectProject(proj.id);
                    setShowProjectDropdown(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${
                    proj.id === currentProject?.id
                      ? "bg-blue-50 text-blue-700 font-bold border border-blue-200"
                      : "text-slate-700 hover:bg-blue-50/50"
                  }`}
                >
                  <span className="truncate">{proj.name}</span>
                  {proj.id === currentProject?.id && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-2" />}
                </button>
              ))}

              <div className="border-t border-slate-100 mt-1 pt-1">
                <button
                  id="btn-create-new-project-sidebar"
                  onClick={() => {
                    setShowProjectDropdown(false);
                    onOpenCreateProject?.();
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center gap-2 text-blue-600 hover:bg-blue-50 font-bold transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Crear Nueva Obra</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Card */}
        <div className="p-2 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {currentUser?.fullName
                ? currentUser.fullName
                    .split(" ")
                    .map((n: string) => n[0])
                    .slice(0, 2)
                    .join("")
                : "AU"}
            </div>
            <div className="min-w-0">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold leading-none">
                {currentUser?.roleLabel || currentUser?.role || "Usuario"}
              </span>
              <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                {currentUser?.fullName || "Ana Urbina"}
              </p>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Navigation Menu */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto bg-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-1">
          Módulos de la Obra
        </span>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (item.id === "centro-costos" && activeTab === "certificaciones") ||
            (item.id === "ejecucion-certificaciones" && activeTab === "subcontratistas");

          const isSuministros = item.id === "suministros";

          return (
            <div key={item.id} className="space-y-0.5">
              <button
                onClick={() => {
                  setActiveTab(item.id);
                  if (isSuministros) {
                    setSuministrosMenuOpen(!suministrosMenuOpen);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition group text-left cursor-pointer ${
                  isActive
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-700 hover:text-blue-700 hover:bg-blue-50/60"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition ${
                      isActive ? "text-white" : "text-blue-600 group-hover:text-blue-700"
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {item.badge !== null && (
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        isActive
                          ? "bg-white text-blue-800"
                          : (item as any).badgeColor || "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isSuministros && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        suministrosMenuOpen ? "rotate-180" : ""
                      } ${isActive ? "text-white/80" : "text-slate-400"}`}
                    />
                  )}
                </div>
              </button>

              {/* Suministros Dropdown Submenu */}
              {isSuministros && suministrosMenuOpen && (
                <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-blue-100 ml-4 my-1">
                  <button
                    onClick={() => {
                      setActiveTab("suministros");
                      setSuministrosSubTab?.("pedidos");
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      activeTab === "suministros" && suministrosSubTab === "pedidos"
                        ? "bg-blue-50 text-blue-700 font-bold border border-blue-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-3.5 h-3.5 text-blue-600" />
                      <span>1. Requisiciones / Pedidos</span>
                    </div>
                    {pendingRequisitionsCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        {pendingRequisitionsCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab("suministros");
                      setSuministrosSubTab?.("compras");
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      activeTab === "suministros" && suministrosSubTab === "compras"
                        ? "bg-blue-50 text-blue-700 font-bold border border-blue-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
                      <span>2. Órdenes de Compra (O.C.)</span>
                    </div>
                    {pendingOrdersCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                        {pendingOrdersCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab("suministros");
                      setSuministrosSubTab?.("stock");
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      activeTab === "suministros" && suministrosSubTab === "stock"
                        ? "bg-blue-50 text-blue-700 font-bold border border-blue-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Warehouse className="w-3.5 h-3.5 text-blue-600" />
                      <span>3. Pañol / Almacén de Obra</span>
                    </div>
                    {lowStockCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                        {lowStockCount}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Divider */}
        <div className="pt-3 pb-1">
          <div className="h-px bg-slate-200 w-full" />
        </div>

        {/* Fast Action: Importador de Presupuesto */}
        <button
          onClick={() => {
            setActiveTab("centro-costos");
            if (onOpenBudgetImporter) onOpenBudgetImporter();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-blue-700 hover:bg-blue-50 border border-blue-200 transition cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="truncate">Cargar Planilla Excel</span>
        </button>
      </nav>

      {/* Footer Controls: Currency & Status */}
      <div className="p-3 border-t border-slate-200 bg-white space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5 font-medium">
            <Coins className="w-3.5 h-3.5 text-blue-600" />
            Moneda
          </span>
          <button
            onClick={onToggleCurrency}
            className="font-mono font-bold text-xs text-slate-800 hover:text-blue-700 hover:border-blue-300 px-2 py-0.5 rounded-lg bg-white border border-slate-300 transition cursor-pointer shadow-2xs"
          >
            {currency}
          </button>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1">
          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
          <span className="truncate">Datos Independientes por Obra</span>
        </div>
      </div>
    </aside>
  );
};
