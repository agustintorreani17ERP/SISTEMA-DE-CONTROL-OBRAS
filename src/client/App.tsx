import React, { useState, useEffect, useCallback } from "react";
import { Sidebar, ActiveTab, SuministrosSubTab } from "./components/Sidebar";
import { DashboardTab } from "./components/DashboardTab";
import { CentroCostosTab } from "./components/CentroCostosTab";
import { EjecucionCertificacionesTab } from "./components/EjecucionCertificacionesTab";
import { SuministrosTab } from "./components/SuministrosTab";
import { PartesDiariosFrentesTab } from "./components/PartesDiariosFrentesTab";
import { ContabilidadFinanzasTab } from "./components/ContabilidadFinanzasTab";
import { CertificacionesHubTab } from "./components/CertificacionesHubTab";
import { SubcontractsTab } from "./components/SubcontractsTab";
import { LoginModal } from "./components/LoginModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { ProjectSelectionPortal } from "./components/ProjectSelectionPortal";
import { ToastContainer, ToastMessage } from "./components/Toast";
import {
  Project,
  BudgetItem,
  WorkFront,
  Personnel,
  Partner,
  Material,
  MaterialRequest,
  PurchaseOrder,
  SubcontractorContract,
  WarehouseStock,
  StockMovement,
  DashboardData,
  User,
} from "./types";
import { api } from "./api";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  LogIn,
  Menu,
  X,
  CheckCircle2,
  Plus,
  ArrowLeft,
  FolderOpen,
  DollarSign,
  Building2,
} from "lucide-react";

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [suministrosSubTab, setSuministrosSubTab] = useState<SuministrosSubTab>("pedidos");
  const [currency, setCurrency] = useState<"PYG" | "USD">("PYG");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authentication State: Start at login screen per user requirement
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem("infratrack_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Core entities
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [workFronts, setWorkFronts] = useState<WorkFront[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialRequests, setMaterialRequests] = useState<MaterialRequest[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [subcontracts, setSubcontracts] = useState<SubcontractorContract[]>([]);
  const [stock, setStock] = useState<WarehouseStock[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  // Mobile sidebar toggle
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Budget importer trigger
  const [openImporterTrigger, setOpenImporterTrigger] = useState(false);

  // Create Project Modal trigger
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);

  // Toast feedback state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Fetch all primary project data
  const fetchData = useCallback(
    async (projId?: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const currentProjects = await api.getProjects();
        const targetId = projId || selectedProjectId;
        setProjects((prev) => {
          const list = [...currentProjects];
          if (targetId && !list.some((p) => p.id === targetId)) {
            const existing = prev.find((p) => p.id === targetId);
            if (existing) list.unshift(existing);
          }
          return list;
        });

        if (!targetId) {
          // In portal mode (no specific project selected yet)
          setLoading(false);
          setRefreshing(false);
          return;
        }

        const [
          dashRes,
          budRes,
          wfRes,
          persRes,
          partRes,
          matRes,
          reqRes,
          poRes,
          scRes,
          stockRes,
          movRes,
        ] = await Promise.allSettled([
          api.getDashboard(targetId),
          api.getBudgetItems(targetId),
          api.getWorkFronts(targetId),
          api.getPersonnel(),
          api.getPartners(),
          api.getMaterials(),
          api.getMaterialRequests(),
          api.getPurchaseOrders(),
          api.getSubcontracts(),
          api.getStock(targetId),
          api.getStockMovements(targetId),
        ]);

        if (dashRes.status === "fulfilled") setDashboard(dashRes.value);
        if (budRes.status === "fulfilled") setBudgetItems(budRes.value);
        if (wfRes.status === "fulfilled") setWorkFronts(wfRes.value);
        if (persRes.status === "fulfilled") setPersonnel(persRes.value);
        if (partRes.status === "fulfilled") setPartners(partRes.value);
        if (matRes.status === "fulfilled") setMaterials(matRes.value);
        if (reqRes.status === "fulfilled") setMaterialRequests(reqRes.value);
        if (poRes.status === "fulfilled") setPurchaseOrders(poRes.value);
        if (scRes.status === "fulfilled") setSubcontracts(scRes.value);
        if (stockRes.status === "fulfilled") setStock(stockRes.value);
        if (movRes.status === "fulfilled") setStockMovements(movRes.value);
      } catch (err: any) {
        console.error("Error loading ERP data:", err);
        setError(err.message || "Error al conectar con el servidor de la obra");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedProjectId]
  );

  useEffect(() => {
    fetchData();
  }, []);

  const handleSelectProject = (id: number) => {
    setSelectedProjectId(id);
    setActiveTab("dashboard");
    fetchData(id, false);
  };

  const handleRefresh = () => {
    if (selectedProjectId) {
      fetchData(selectedProjectId, true);
    } else {
      fetchData(undefined, true);
    }
  };

  const handleToggleCurrency = () => {
    setCurrency((prev) => (prev === "PYG" ? "USD" : "PYG"));
  };

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    try {
      localStorage.setItem("infratrack_user", JSON.stringify(user));
    } catch {}
    showToast(`Bienvenida/o, ${user.fullName} (${user.roleLabel || user.role})`);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSelectedProjectId(undefined);
    try {
      localStorage.removeItem("infratrack_user");
    } catch {}
    showToast("Sesión cerrada correctamente", "info");
  };

  const handleClearAllProjects = async () => {
    try {
      await api.clearAllProjects();
      setProjects([]);
      setSelectedProjectId(undefined);
      setBudgetItems([]);
      showToast("Todos los proyectos y presupuestos han sido eliminados correctamente");
    } catch (err: any) {
      showToast(err.message || "Error al eliminar proyectos", "error");
    }
  };

  const handleDeleteProject = async (id: number, name: string) => {
    try {
      await api.archiveProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedProjectId === id) {
        setSelectedProjectId(undefined);
      }
      showToast(`Proyecto "${name}" eliminado correctamente`);
    } catch (err: any) {
      showToast(err.message || "Error al eliminar proyecto", "error");
    }
  };

  const handleProjectCreated = (newProject: Project, initialMode: "excel" | "manual") => {
    setProjects((prev) => [newProject, ...prev.filter((p) => p.id !== newProject.id)]);
    setSelectedProjectId(newProject.id);
    setShowCreateProjectModal(false);
    setActiveTab("certificaciones");
    if (initialMode === "excel") {
      setOpenImporterTrigger(true);
    } else {
      setOpenImporterTrigger(false);
    }
    fetchData(newProject.id, false);
    showToast(`Proyecto "${newProject.name}" creado con éxito. Carga tu presupuesto base.`);
  };

  const currentProject = projects.find((p) => p.id === selectedProjectId);

  // Counters for sidebar badges
  const pendingRequisitionsCount = materialRequests.filter((r) => r.status === "BORRADOR").length;
  const pendingOrdersCount = purchaseOrders.filter(
    (o) => o.status === "BORRADOR" || o.status === "APROBADO_PARA_COMPRA"
  ).length;
  const pendingCertificatesCount = subcontracts.reduce((acc, sc) => {
    const pendingCerts = (sc.certificates || []).filter((c) => c.status === "BORRADOR");
    return acc + pendingCerts.length;
  }, 0);
  const lowStockCount = stock.filter((s) => Number(s.currentStock || 0) <= 5).length;

  // STEP 1: If not authenticated, require login first
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <LoginModal
          onLoginSuccess={handleLoginSuccess}
          canCancel={false}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // STEP 2: If no project selected, show Project Selection Portal (Select existing or Create new)
  if (!selectedProjectId || !currentProject) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
        <ProjectSelectionPortal
          projects={projects}
          currentUser={currentUser}
          currency={currency}
          onSelectProject={handleSelectProject}
          onCreateProjectClick={() => setShowCreateProjectModal(true)}
          onLogout={handleLogout}
          onDeleteProject={handleDeleteProject}
          onClearAllProjects={handleClearAllProjects}
          onRefresh={() => fetchData(undefined, true)}
        />

        {showCreateProjectModal && (
          <CreateProjectModal
            isOpen={showCreateProjectModal}
            onClose={() => setShowCreateProjectModal(false)}
            onProjectCreated={handleProjectCreated}
            currency={currency}
            showToast={showToast}
          />
        )}

        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // STEP 3: Project selected -> Show full ERP Workspace with all menus
  return (
    <div className="flex h-screen bg-white text-slate-900 font-sans overflow-hidden">
      {/* Left-Aligned Sidebar Menu */}
      <div className="hidden md:flex shrink-0">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setOpenImporterTrigger(false);
          }}
          suministrosSubTab={suministrosSubTab}
          setSuministrosSubTab={setSuministrosSubTab}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onBackToPortal={() => setSelectedProjectId(undefined)}
          currentUser={currentUser}
          onLogout={handleLogout}
          currency={currency}
          onToggleCurrency={handleToggleCurrency}
          pendingRequisitionsCount={pendingRequisitionsCount}
          pendingOrdersCount={pendingOrdersCount}
          pendingCertificatesCount={pendingCertificatesCount}
          lowStockCount={lowStockCount}
          onOpenBudgetImporter={() => {
            setActiveTab("centro-costos");
            setOpenImporterTrigger(true);
          }}
          onOpenCreateProject={() => setShowCreateProjectModal(true)}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-full">
            <Sidebar
              activeTab={activeTab}
              setActiveTab={(tab) => {
                setActiveTab(tab);
                setSidebarOpen(false);
                setOpenImporterTrigger(false);
              }}
              suministrosSubTab={suministrosSubTab}
              setSuministrosSubTab={setSuministrosSubTab}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={(id) => {
                handleSelectProject(id);
                setSidebarOpen(false);
              }}
              onBackToPortal={() => {
                setSelectedProjectId(undefined);
                setSidebarOpen(false);
              }}
              currentUser={currentUser}
              onLogout={handleLogout}
              currency={currency}
              onToggleCurrency={handleToggleCurrency}
              pendingRequisitionsCount={pendingRequisitionsCount}
              pendingOrdersCount={pendingOrdersCount}
              pendingCertificatesCount={pendingCertificatesCount}
              lowStockCount={lowStockCount}
              onOpenBudgetImporter={() => {
                setActiveTab("centro-costos");
                setOpenImporterTrigger(true);
                setSidebarOpen(false);
              }}
              onOpenCreateProject={() => {
                setSidebarOpen(false);
                setShowCreateProjectModal(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
        {/* Top Operational Header */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 z-10 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile menu hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 md:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Back to Projects Portal Button */}
            <button
              onClick={() => setSelectedProjectId(undefined)}
              title="Volver al portal de selección de proyectos"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-xs font-semibold border border-slate-200 hover:border-blue-200 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-blue-600" />
              <span>Obras</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                {currentProject?.code || "OBRA"}
              </span>
              <div className="truncate">
                <span className="text-xs font-extrabold text-slate-900 truncate block sm:inline">
                  {currentProject?.name}
                </span>
                <span className="hidden sm:inline text-xs text-slate-300 mx-1.5">|</span>
                <span className="text-xs font-medium text-slate-600 truncate hidden sm:inline">
                  {activeTab === "dashboard" && "Dashboard de Control Gerencial & Curva S"}
                  {(activeTab === "centro-costos" || activeTab === "certificaciones") &&
                    "Centro de Costos (WBS) & Presupuesto Base"}
                  {(activeTab === "ejecucion-certificaciones" || activeTab === "subcontratistas") &&
                    "Ejecución de Obra & Certificaciones (Mediciones, Subcontratos, Cliente)"}
                  {activeTab === "suministros" &&
                    "Suministros y Logística (Requisiciones, Órdenes de Compra, Pañol)"}
                  {activeTab === "partes-diarios" && "Partes Diarios de Obra & Frentes de Trabajo"}
                  {activeTab === "contabilidad-finanzas" &&
                    "Contabilidad y Finanzas (Facturación Fiscal, Pagos, Cobranzas, Caja)"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Currency toggle */}
            <button
              onClick={handleToggleCurrency}
              title="Alternar moneda (Guaraníes / Dólares)"
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-xs font-mono font-bold border border-slate-200 hover:border-blue-200 transition"
            >
              <DollarSign className="w-3.5 h-3.5 text-blue-600" />
              <span>{currency}</span>
            </button>

            <button
              id="btn-create-project-top"
              onClick={() => setShowCreateProjectModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nueva Obra</span>
            </button>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Sincronizar datos"
              className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-blue-600" : ""}`} />
            </button>
          </div>
        </header>

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-28 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-3" />
              <p className="text-sm font-semibold text-slate-700">Cargando base de datos de la obra...</p>
              <p className="text-xs text-slate-500 mt-1">Sincronizando rubros, mediciones y presupuestos</p>
            </div>
          ) : error ? (
            <div className="bg-white border border-rose-200 rounded-2xl p-6 text-center max-w-lg mx-auto my-12 text-slate-800 shadow-sm">
              <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
              <h2 className="text-base font-bold text-slate-900">Error de Conexión ERP</h2>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
              <button
                onClick={() => fetchData(selectedProjectId, false)}
                className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-sm transition"
              >
                Reintentar Conexión
              </button>
            </div>
          ) : (
            <>
              {/* 1. 📊 Tab: Dashboard de Obra */}
              {activeTab === "dashboard" && (
                <DashboardTab
                  project={currentProject}
                  dashboard={dashboard}
                  currency={currency}
                  materialRequests={materialRequests}
                  purchaseOrders={purchaseOrders}
                  subcontracts={subcontracts}
                  onNavigateTab={(tab: any) => {
                    if (tab === "pedidos") {
                      setActiveTab("suministros");
                      setSuministrosSubTab("pedidos");
                    } else if (tab === "compras") {
                      setActiveTab("suministros");
                      setSuministrosSubTab("compras");
                    } else if (tab === "stock") {
                      setActiveTab("suministros");
                      setSuministrosSubTab("stock");
                    } else if (tab === "partidas" || tab === "presupuesto") {
                      setActiveTab("centro-costos");
                    } else if (tab === "subcontratos" || tab === "mediciones") {
                      setActiveTab("ejecucion-certificaciones");
                    } else if (tab === "frentes" || tab === "parte-diario") {
                      setActiveTab("partes-diarios");
                    } else if (tab === "finanzas" || tab === "facturas" || tab === "caja") {
                      setActiveTab("contabilidad-finanzas");
                    }
                  }}
                  onOpenNewRequest={() => {
                    setActiveTab("suministros");
                    setSuministrosSubTab("pedidos");
                  }}
                  onOpenNewOrder={() => {
                    setActiveTab("suministros");
                    setSuministrosSubTab("compras");
                  }}
                  onOpenNewSubcontract={() => setActiveTab("ejecucion-certificaciones")}
                />
              )}

              {/* 2. 🏗️ Tab: Centro de Costos (WBS & Presupuesto Base) */}
              {(activeTab === "centro-costos" || activeTab === "certificaciones") && (
                <CentroCostosTab
                  project={currentProject}
                  budgetItems={budgetItems}
                  purchaseOrders={purchaseOrders}
                  currency={currency}
                  onRefresh={handleRefresh}
                  showToast={showToast}
                  initialOpenImporter={openImporterTrigger}
                />
              )}

              {/* 3. 📐 Tab: Ejecución y Certificaciones */}
              {(activeTab === "ejecucion-certificaciones" || activeTab === "subcontratistas") && (
                <EjecucionCertificacionesTab
                  project={currentProject}
                  projects={projects}
                  budgetItems={budgetItems}
                  partners={partners}
                  subcontracts={subcontracts}
                  workFronts={workFronts}
                  currency={currency}
                  onRefresh={handleRefresh}
                  showToast={showToast}
                  onNavigateToFinance={() => setActiveTab("contabilidad-finanzas")}
                />
              )}

              {/* 4. 📦 Tab: Suministros y Logística */}
              {activeTab === "suministros" && (
                <SuministrosTab
                  project={currentProject}
                  materialRequests={materialRequests}
                  purchaseOrders={purchaseOrders}
                  stock={stock}
                  stockMovements={stockMovements}
                  materials={materials}
                  workFronts={workFronts}
                  personnel={personnel}
                  partners={partners}
                  budgetItems={budgetItems}
                  currency={currency}
                  onRefresh={handleRefresh}
                  showToast={showToast}
                  initialSubTab={suministrosSubTab}
                  onSubTabChange={setSuministrosSubTab}
                />
              )}

              {/* 5. 🚜 Tab: Partes Diarios & Frentes */}
              {activeTab === "partes-diarios" && (
                <PartesDiariosFrentesTab
                  project={currentProject}
                  workFronts={workFronts}
                  personnel={personnel}
                  showToast={showToast}
                />
              )}

              {/* 6. 💼 Tab: Contabilidad y Finanzas */}
              {activeTab === "contabilidad-finanzas" && (
                <ContabilidadFinanzasTab
                  project={currentProject}
                  purchaseOrders={purchaseOrders}
                  subcontracts={subcontracts}
                  budgetItems={budgetItems}
                  partners={partners}
                  currency={currency}
                  onRefresh={handleRefresh}
                  showToast={showToast}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Create Project Wizard Modal */}
      {showCreateProjectModal && (
        <CreateProjectModal
          isOpen={showCreateProjectModal}
          onClose={() => setShowCreateProjectModal(false)}
          onProjectCreated={handleProjectCreated}
          currency={currency}
          showToast={showToast}
        />
      )}

      {/* Global Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
