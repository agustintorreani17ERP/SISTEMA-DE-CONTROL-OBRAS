import React from "react";
import {
  Building2,
  HardHat,
  FileSpreadsheet,
  Receipt,
  FileCheck,
  Package,
  Layers,
  Truck,
  BookOpen,
  Users,
  RefreshCw,
  MapPin,
  Calendar,
  AlertCircle,
  Coins,
} from "lucide-react";
import { Project } from "../types";

export type ActiveTab =
  | "dashboard"
  | "partidas"
  | "pedidos"
  | "compras"
  | "subcontratos"
  | "stock"
  | "frentes"
  | "parte-diario"
  | "directorio";

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  projects: Project[];
  selectedProjectId?: number;
  onSelectProject: (id: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
  currency: "PYG" | "USD";
  onToggleCurrency: () => void;
  pendingRequisitionsCount: number;
  pendingOrdersCount: number;
  pendingCertificatesCount: number;
  lowStockCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  projects,
  selectedProjectId,
  onSelectProject,
  refreshing,
  onRefresh,
  currency,
  onToggleCurrency,
  pendingRequisitionsCount,
  pendingOrdersCount,
  pendingCertificatesCount,
  lowStockCount,
}) => {
  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const navItems = [
    {
      id: "dashboard" as ActiveTab,
      label: "Dashboard Ejecutivo",
      icon: Building2,
      badge: null,
    },
    {
      id: "partidas" as ActiveTab,
      label: "Control Presupuestario",
      icon: FileSpreadsheet,
      badge: null,
    },
    {
      id: "pedidos" as ActiveTab,
      label: "Pedidos de Material (PM)",
      icon: HardHat,
      badge: pendingRequisitionsCount > 0 ? pendingRequisitionsCount : null,
      badgeColor: "bg-blue-600 text-white",
    },
    {
      id: "compras" as ActiveTab,
      label: "Órdenes de Compra (OC)",
      icon: Receipt,
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : null,
      badgeColor: "bg-amber-600 text-white",
    },
    {
      id: "subcontratos" as ActiveTab,
      label: "Subcontratos & Avance",
      icon: FileCheck,
      badge: pendingCertificatesCount > 0 ? pendingCertificatesCount : null,
      badgeColor: "bg-purple-600 text-white",
    },
    {
      id: "stock" as ActiveTab,
      label: "Pañol & Almacén",
      icon: Package,
      badge: lowStockCount > 0 ? lowStockCount : null,
      badgeColor: "bg-rose-600 text-white",
    },
    {
      id: "frentes" as ActiveTab,
      label: "Frentes & Maquinaria",
      icon: Truck,
      badge: null,
    },
    {
      id: "parte-diario" as ActiveTab,
      label: "Parte Diario",
      icon: BookOpen,
      badge: null,
    },
    {
      id: "directorio" as ActiveTab,
      label: "Proveedores & Personal",
      icon: Users,
      badge: null,
    },
  ];

  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-40 shadow-sm">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500 text-stone-950 flex items-center justify-center font-black text-xl shadow-md border border-amber-400">
              IT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-stone-50 font-display">
                  InfraTrack ERP
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Obras Viales
                </span>
              </div>
              <p className="text-xs text-stone-400">Control Presupuestario & Compras en Faena</p>
            </div>
          </div>

          {/* Project Selector & Actions */}
          <div className="flex items-center gap-3">
            {/* Project Switcher */}
            {projects.length > 0 && (
              <div className="flex items-center bg-stone-800/80 border border-stone-700 rounded-lg px-3 py-1.5 text-sm">
                <MapPin className="w-4 h-4 text-amber-400 mr-2 shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="text-[10px] uppercase font-semibold text-stone-400 tracking-wider">
                    Obra Activa
                  </span>
                  <select
                    id="project-selector"
                    value={selectedProjectId || projects[0]?.id}
                    onChange={(e) => onSelectProject(Number(e.target.value))}
                    className="bg-transparent text-xs font-semibold text-stone-200 outline-none cursor-pointer pr-4"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} className="bg-stone-900 text-stone-100">
                        {p.code} — {p.name} {p.roadSection ? `(${p.roadSection})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Currency Toggle */}
            <button
              id="currency-toggle-btn"
              onClick={onToggleCurrency}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-medium text-stone-300 border border-stone-700 transition"
              title="Cambiar moneda de visualización"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{currency === "PYG" ? "₲ PYG" : "$ USD"}</span>
            </button>

            {/* Refresh Button */}
            <button
              id="refresh-data-btn"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 active:scale-95 text-xs font-medium text-stone-200 border border-stone-700 transition disabled:opacity-50"
              title="Sincronizar datos"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-stone-300 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Project Sub-header info bar if project exists */}
      {currentProject && (
        <div className="bg-stone-950/80 border-t border-stone-800/80 px-4 sm:px-6 lg:px-8 py-1.5 text-xs text-stone-400 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-semibold text-stone-200">{currentProject.name}</span>
            {currentProject.roadSection && (
              <span className="inline-flex items-center gap-1 text-stone-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Tramo: {currentProject.roadSection}
              </span>
            )}
            {currentProject.contractNumber && (
              <span className="text-stone-400">
                Contrato: <span className="text-stone-300 font-mono">{currentProject.contractNumber}</span>
              </span>
            )}
            {currentProject.clientName && (
              <span className="text-stone-400">
                Comitente: <span className="text-stone-300">{currentProject.clientName}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {currentProject.status || "EN EJECUCIÓN"}
            </span>
          </div>
        </div>
      )}

      {/* Navigation Tabs Bar */}
      <nav className="bg-stone-900 px-4 sm:px-6 lg:px-8 overflow-x-auto border-t border-stone-800 scrollbar-none">
        <div className="flex space-x-1 max-w-7xl mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`tab-btn-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 py-3 px-3.5 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-amber-400 text-amber-300 bg-stone-800/40"
                    : "border-transparent text-stone-400 hover:text-stone-200 hover:border-stone-700"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-amber-400" : "text-stone-400"}`} />
                <span>{item.label}</span>
                {item.badge !== null && (
                  <span
                    className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      item.badgeColor || "bg-stone-700 text-stone-200"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
};
