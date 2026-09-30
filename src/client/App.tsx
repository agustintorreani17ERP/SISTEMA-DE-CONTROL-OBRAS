import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Sidebar, ActiveTab, SuministrosSubTab } from "./components/Sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { CentroCostosTab } from "./components/CentroCostosTab";
import { SuministrosTab } from "./components/SuministrosTab";
import { PartesDiariosFrentesTab } from "./components/PartesDiariosFrentesTab";
import { ContabilidadFinanzasTab } from "./components/ContabilidadFinanzasTab";
import { RRHHTab } from "./components/RRHHTab";
import { LoginModal } from "./components/LoginModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { ToastContainer, ToastMessage } from "./components/Toast";
import { PortfolioPage } from "./pages/PortfolioPage";
import { OverviewPage } from "./pages/OverviewPage";
import { DashboardHome } from "./dashboard/DashboardHome";
import { ConfigPage } from "./pages/ConfigPage";
import { StockPage } from "./pages/StockPage";
import { CertificadosPage, CertificadosIntent } from "./certificados/CertificadosPage";
import { ComprasIntent } from "./components/SuministrosTab";
import { CreateAction, CreateMenu } from "./layout/CreateMenu";
import {
  BudgetItem,
  Material,
  MaterialRequest,
  Partner,
  PendingItem,
  Personnel,
  Project,
  PurchaseOrder,
  StockMovement,
  SubcontractorContract,
  User,
  WarehouseStock,
  WorkFront,
} from "./types";
import { api } from "./api";
import { cx } from "./ui";
import { cacheGetJson, cacheSetJson, flushOutbox } from "./offline/outbox";

type FinanzasSubTab = "facturas" | "auditoria-match" | "cuentas-pagar" | "cuentas-cobrar" | "caja-chica";

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [suministrosSubTab, setSuministrosSubTab] = useState<SuministrosSubTab>("pedidos");
  const [finanzasSubTab, setFinanzasSubTab] = useState<FinanzasSubTab>("facturas");
  const [currency, setCurrency] = useState<"PYG" | "USD">("PYG");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openImporterTrigger, setOpenImporterTrigger] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Acciones del botón global "+ Crear": cada módulo abre su formulario al recibirlas
  const [comprasIntent, setComprasIntent] = useState<ComprasIntent>(null);
  const [stockIntent, setStockIntent] = useState<{ action: "out" | "adjust"; nonce: number } | null>(null);
  const [certIntent, setCertIntent] = useState<CertificadosIntent>(null);
  const [laborImportNonce, setLaborImportNonce] = useState(0);

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem("infratrack_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Datos de la obra seleccionada
  // Última lista conocida: sin conexión se puede elegir la obra y cargar el parte diario
  const [projects, setProjects] = useState<Project[]>(() => cacheGetJson<Project[]>("infratrack_projects") ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
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

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const fetchData = useCallback(
    async (projId?: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const list = await api.getProjects();
        setProjects(list);
        cacheSetJson("infratrack_projects", list);
        const targetId = projId ?? selectedProjectId;
        if (!targetId) return;

        const results = await Promise.allSettled([
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
        const setters: ((v: any) => void)[] = [
          setBudgetItems,
          setWorkFronts,
          setPersonnel,
          setPartners,
          setMaterials,
          setMaterialRequests,
          setPurchaseOrders,
          setSubcontracts,
          setStock,
          setStockMovements,
        ];
        results.forEach((r, i) => r.status === "fulfilled" && setters[i](r.value));
      } catch (err: any) {
        setError(err.message || "No se pudo conectar con el servidor");
      } finally {
        setRefreshing(false);
        setRefreshKey((k) => k + 1);
      }
    },
    [selectedProjectId]
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Partes guardados sin conexión: se envían al abrir la app, al volver la señal y cada 2 minutos
  useEffect(() => {
    const sync = () => {
      if (!navigator.onLine) return;
      flushOutbox()
        .then((r) => {
          if (r.enviados.length) showToast(`${r.enviados.length} parte(s) guardados sin conexión fueron enviados`, "success");
          for (const e of r.enviados) for (const a of e.avisos) showToast(a, "error");
          if (r.rechazados.length) showToast(`${r.rechazados.length} parte(s) fueron rechazados: revisalos en Campo › Parte diario`, "error");
        })
        .catch(() => undefined);
    };
    sync();
    window.addEventListener("online", sync);
    const t = setInterval(sync, 120_000);
    return () => {
      window.removeEventListener("online", sync);
      clearInterval(t);
    };
  }, [showToast]);

  const openProject = (id: number) => {
    setSelectedProjectId(id);
    setActiveTab("dashboard");
    fetchData(id);
  };

  const goPortfolio = () => {
    setSelectedProjectId(undefined);
    fetchData(undefined, true);
  };

  const navigate = (tab: ActiveTab) => {
    setActiveTab(tab);
    setOpenImporterTrigger(false);
  };

  const navigateFromOverview = (tab: PendingItem["tab"], subTab?: string) => {
    if (tab === "suministros" && subTab) setSuministrosSubTab(subTab as SuministrosSubTab);
    if (tab === "contabilidad-finanzas" && subTab) setFinanzasSubTab(subTab as FinanzasSubTab);
    navigate(tab);
  };

  const handleRefresh = () => fetchData(selectedProjectId, true);

  const handleCreate = (action: CreateAction) => {
    const nonce = Date.now();
    switch (action) {
      case "new-request":
      case "new-order":
        setComprasIntent({ action, nonce });
        return navigate("suministros");
      case "stock-out":
      case "stock-adjust":
        setStockIntent({ action: action === "stock-out" ? "out" : "adjust", nonce });
        return navigate("stock");
      case "new-measurement":
      case "new-contract":
        setCertIntent({ action, nonce });
        return navigate("ejecucion-certificaciones");
      case "new-invoice":
        setFinanzasSubTab("facturas");
        return navigate("contabilidad-finanzas");
      case "petty-expense":
        setFinanzasSubTab("caja-chica");
        return navigate("contabilidad-finanzas");
      case "import-budget":
        navigate("centro-costos");
        return setOpenImporterTrigger(true);
      case "labor-prices":
        setLaborImportNonce(nonce);
        return navigate("centro-costos");
      case "new-project":
        return setShowCreateProject(true);
    }
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    try {
      localStorage.setItem("infratrack_user", JSON.stringify(user));
    } catch {}
    showToast(`Bienvenida/o, ${user.fullName}`);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSelectedProjectId(undefined);
    try {
      localStorage.removeItem("infratrack_user");
    } catch {}
  };

  const archiveProject = async (id: number, name: string) => {
    try {
      await api.archiveProject(id);
      showToast(`Obra "${name}" archivada`);
      if (selectedProjectId === id) setSelectedProjectId(undefined);
      fetchData(undefined, true);
    } catch (err: any) {
      showToast(err.message || "No se pudo archivar la obra", "error");
    }
  };

  const handleProjectCreated = (project: Project) => {
    setShowCreateProject(false);
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    setSelectedProjectId(project.id);
    setActiveTab("centro-costos");
    setOpenImporterTrigger(true);
    fetchData(project.id);
    showToast(`Obra "${project.name}" creada. Importá su presupuesto.`);
  };

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const badges = {
    compras:
      materialRequests.filter((r) => r.projectId === selectedProjectId && r.status === "BORRADOR").length +
      purchaseOrders.filter((o) => o.projectId === selectedProjectId && (o.status === "BORRADOR" || o.status === "APROBADO_PARA_COMPRA")).length,
    certificados: subcontracts
      .filter((sc) => sc.projectId === selectedProjectId)
      .reduce((acc, sc) => acc + (sc.certificates || []).filter((c) => c.status === "BORRADOR").length, 0),
  };

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <LoginModal onLoginSuccess={handleLogin} canCancel={false} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <SidebarProvider className="bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onNavigate={navigate}
        onGoPortfolio={goPortfolio}
        project={project}
        currentUser={currentUser}
        onLogout={handleLogout}
        badges={badges}
      />

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <SidebarTrigger />
          {projects.length > 0 && (
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => (e.target.value ? openProject(Number(e.target.value)) : goPortfolio())}
              className="max-w-xs truncate rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Todas las obras</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <CreateMenu hasProject={!!project} onAction={handleCreate} />
            <div className="flex rounded-xl border border-slate-200 p-0.5 text-xs font-medium">
              {(["PYG", "USD"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={cx("rounded-lg px-2.5 py-1", currency === c ? "bg-slate-900 text-white" : "text-slate-500")}
                >
                  {c === "PYG" ? "₲" : "US$"}
                </button>
              ))}
            </div>
            <button
              onClick={handleRefresh}
              className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              title="Actualizar datos"
            >
              <RefreshCw className={cx("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {error && (
            <div className="mx-auto mb-6 flex max-w-7xl items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {error}
              <button onClick={handleRefresh} className="ml-auto font-medium underline">
                Reintentar
              </button>
            </div>
          )}

          {!project && (
            <PortfolioPage
              currency={currency}
              userName={currentUser.fullName}
              onOpenProject={openProject}
              onCreateProject={() => setShowCreateProject(true)}
              onArchiveProject={archiveProject}
              showToast={showToast}
              refreshKey={refreshKey}
            />
          )}

          {project && activeTab === "dashboard" && (
            <DashboardHome
              project={project}
              showToast={showToast}
              overview={
                <OverviewPage
                  project={project}
                  currency={currency}
                  onNavigate={navigateFromOverview}
                  onImportBudget={() => {
                    setActiveTab("centro-costos");
                    setOpenImporterTrigger(true);
                  }}
                  refreshKey={refreshKey}
                  showToast={showToast}
                />
              }
            />
          )}

          {project && (activeTab === "centro-costos" || activeTab === "certificaciones") && (
            <CentroCostosTab
              project={project}
              budgetItems={budgetItems}
              purchaseOrders={purchaseOrders}
              currency={currency}
              onRefresh={handleRefresh}
              showToast={showToast}
              initialOpenImporter={openImporterTrigger}
              laborImportNonce={laborImportNonce}
            />
          )}

          {project && (activeTab === "ejecucion-certificaciones" || activeTab === "subcontratistas") && (
            <CertificadosPage
              project={project}
              budgetItems={budgetItems}
              partners={partners}
              subcontracts={subcontracts}
              currency={currency}
              intent={certIntent}
              onRefresh={handleRefresh}
              showToast={showToast}
            />
          )}

          {project && activeTab === "suministros" && (
            <SuministrosTab
              project={project}
              materialRequests={materialRequests.filter((r) => r.projectId === project.id)}
              purchaseOrders={purchaseOrders.filter((o) => o.projectId === project.id)}
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
              currentUser={currentUser}
              intent={comprasIntent}
            />
          )}

          {project && activeTab === "stock" && (
            <StockPage
              project={project}
              stock={stock}
              movements={stockMovements}
              materials={materials}
              workFronts={workFronts}
              intent={stockIntent}
              onRefresh={handleRefresh}
              showToast={showToast}
            />
          )}

          {project && activeTab === "partes-diarios" && (
            <PartesDiariosFrentesTab project={project} workFronts={workFronts} personnel={personnel} showToast={showToast} onRefresh={handleRefresh} />
          )}

          {project && activeTab === "contabilidad-finanzas" && (
            <ContabilidadFinanzasTab
              key={finanzasSubTab}
              project={project}
              purchaseOrders={purchaseOrders.filter((o) => o.projectId === project.id)}
              subcontracts={subcontracts.filter((s) => s.projectId === project.id)}
              budgetItems={budgetItems}
              partners={partners}
              currency={currency}
              onRefresh={handleRefresh}
              showToast={showToast}
              initialSubTab={finanzasSubTab}
            />
          )}

          {project && activeTab === "rrhh" && (
            <RRHHTab project={project} showToast={showToast} />
          )}

          {project && activeTab === "configuracion" && (
            <ConfigPage
              materials={materials}
              partners={partners}
              onRefresh={handleRefresh}
              showToast={showToast}
            />
          )}
        </main>
      </SidebarInset>

      {showCreateProject && (
        <CreateProjectModal
          isOpen
          onClose={() => setShowCreateProject(false)}
          onProjectCreated={handleProjectCreated}
          currency={currency}
          showToast={showToast}
        />
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </SidebarProvider>
  );
}

export default App;
