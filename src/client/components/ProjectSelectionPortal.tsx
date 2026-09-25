import React, { useState } from "react";
import {
  Building2,
  Plus,
  ArrowRight,
  MapPin,
  Calendar,
  DollarSign,
  Trash2,
  AlertTriangle,
  FolderOpen,
  LogOut,
  ShieldCheck,
  HardHat,
  RefreshCw,
  Layers,
} from "lucide-react";
import { Project, User } from "../types";
import { formatMoney } from "../utils/format";

interface ProjectSelectionPortalProps {
  projects: Project[];
  currentUser: User | null;
  currency: "PYG" | "USD";
  onSelectProject: (projectId: number) => void;
  onCreateProjectClick: () => void;
  onLogout: () => void;
  onDeleteProject: (projectId: number, projectName: string) => Promise<void>;
  onClearAllProjects: () => Promise<void>;
  onRefresh: () => void;
}

export const ProjectSelectionPortal: React.FC<ProjectSelectionPortalProps> = ({
  projects,
  currentUser,
  currency,
  onSelectProject,
  onCreateProjectClick,
  onLogout,
  onDeleteProject,
  onClearAllProjects,
  onRefresh,
}) => {
  const [clearing, setClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleClearAll = async () => {
    const confirm = window.confirm(
      "¿Estás seguro de que deseas ELIMINAR TODOS los proyectos de la base de datos? Esta acción dejará el sistema completamente en blanco para que puedas empezar de cero."
    );
    if (!confirm) return;

    setClearing(true);
    try {
      await onClearAllProjects();
    } finally {
      setClearing(false);
    }
  };

  const handleDeleteOne = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    const confirm = window.confirm(
      `¿Deseas archivar/eliminar la obra "${p.name}" (${p.code})?`
    );
    if (!confirm) return;

    setDeletingId(p.id);
    try {
      await onDeleteProject(p.id, p.name);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-slate-900 tracking-tight">
                  InfraTrack ERP
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                  Obras Civiles & Viales
                </span>
              </div>
              <p className="text-xs text-slate-500">
                CCC S.A. — Gestión Presupuestaria y Certificaciones
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {currentUser && (
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                  {(currentUser.fullName || "AU")
                    .split(" ")
                    .map((n: string) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-slate-900 leading-tight">
                    {currentUser.fullName}
                  </p>
                  <p className="text-[10px] text-slate-500 capitalize">
                    {currentUser.roleLabel || currentUser.role}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 transition cursor-pointer"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 bg-white">
        {/* Banner Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
              <FolderOpen className="w-4 h-4" />
              <span>Portal de Selección de Obra</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Obras y Proyectos Independientes
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Cada proyecto opera de forma totalmente aislada con sus propios rubros, cómputos, frentes de obra, certificaciones y almacenes.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={onRefresh}
              className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 transition cursor-pointer"
              title="Actualizar lista de proyectos"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {projects.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>{clearing ? "Borrando..." : "Borrar Todos los Proyectos"}</span>
              </button>
            )}

            <button
              onClick={onCreateProjectClick}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-xs font-bold transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Nuevo Proyecto</span>
            </button>
          </div>
        </div>

        {/* Projects Grid or Empty State */}
        {projects.length === 0 ? (
          <div className="my-12 py-16 px-6 bg-white border border-slate-200 rounded-3xl shadow-sm text-center max-w-xl mx-auto">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xs">
              <Building2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              No hay proyectos activos registrados
            </h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              La base de datos está limpia. Puedes crear un nuevo proyecto ahora mismo e ingresar sus datos o importar su planilla Excel de presupuesto.
            </p>
            <div className="mt-6 flex items-center justify-center">
              <button
                onClick={onCreateProjectClick}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition shadow-sm active:scale-[0.98] cursor-pointer"
              >
                <Plus className="w-5 h-5" />
                <span>+ Crear Primer Proyecto</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Proyectos Registrados ({projects.length})
              </h2>
              <span className="text-xs text-slate-400">
                Haz clic en una obra para acceder a todos los menús
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {projects.map((project) => {
                const isDeleting = deletingId === project.id;
                const budgetItemsCount = project.budgetItems?.length ?? 0;
                const contractualAmt =
                  Number(project.montoContractualManual) > 0
                    ? Number(project.montoContractualManual)
                    : Number(project.globalBudget) || 0;

                return (
                  <div
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    className="group bg-white border border-slate-200 hover:border-blue-400 rounded-3xl p-6 shadow-xs hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                  >
                    {/* Top Tag & Delete Action */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-mono text-xs font-bold">
                          {project.code || `OBR-${project.id}`}
                        </span>

                        <button
                          onClick={(e) => handleDeleteOne(e, project)}
                          disabled={isDeleting}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          title="Eliminar u archivar obra"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Project Title & Client */}
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition leading-snug line-clamp-2">
                        {project.name}
                      </h3>

                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                        <span className="font-medium text-slate-700">
                          {project.clientName || "Cliente No Asignado"}
                        </span>
                      </p>

                      {project.location && (
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{project.location}</span>
                        </p>
                      )}

                      {/* Financial & Contract Specs */}
                      <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-left">
                        <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Monto Contractual
                          </span>
                          <span className="text-xs font-bold text-blue-700 font-mono block mt-0.5">
                            {formatMoney(contractualAmt, currency)}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Plazo / Duración
                          </span>
                          <span className="text-xs font-bold text-slate-800 font-mono block mt-0.5 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-blue-600" />
                            {project.executionMonths || 12} Meses
                          </span>
                        </div>
                      </div>

                      {/* Sub-items status */}
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500 px-1">
                        <span className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-blue-600" />
                          <span>
                            {budgetItemsCount > 0
                              ? `${budgetItemsCount} rubros presupuestados`
                              : "Planilla pendiente de carga"}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Bottom Action Button */}
                    <div className="mt-6 pt-4 border-t border-slate-100">
                      <button
                        onClick={() => onSelectProject(project.id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                      >
                        <span>Ingresar a la Obra</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400 mt-auto">
        <p>InfraTrack ERP Construction System — Membrete Oficial CCC S.A.</p>
        <p className="mt-1 text-[11px] text-slate-400">
          Control estricto de certificación con cálculo acumulativo independiente por obra.
        </p>
      </footer>
    </div>
  );
};
