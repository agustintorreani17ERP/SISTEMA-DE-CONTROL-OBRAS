import React, { useEffect, useState } from "react";
import {
  BudgetItem,
  Material,
  MaterialRequest,
  Partner,
  Personnel,
  Project,
  PurchaseOrder,
  Requisicion,
  StockMovement,
  User,
  WarehouseStock,
  WorkFront,
} from "../types";
import { Inbox, PackageSearch, ShoppingCart } from "lucide-react";
import { api } from "../api";
import { BackButton, Page, PageHeader, SectionNav } from "../ui";
import { APPS, type AppId } from "../apps";
import { RequestsView } from "../compras/RequestsView";
import { OrdersView } from "../compras/OrdersView";
import { RequestForm } from "../compras/RequestForm";
import { OrderForm } from "../compras/OrderForm";
import { BandejaView } from "../compras/BandejaView";

export type ComprasIntent = { action: "new-request" | "new-order"; nonce: number } | null;

interface SuministrosTabProps {
  app: AppId;
  project?: Project | null;
  /** Pedidos y OC de todas las obras: el filtro de alcance decide cuáles se ven. */
  materialRequests: MaterialRequest[];
  purchaseOrders: PurchaseOrder[];
  stock: WarehouseStock[];
  stockMovements: StockMovement[];
  materials: Material[];
  workFronts: WorkFront[];
  personnel: Personnel[];
  partners: Partner[];
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  currentUser?: User | null;
  intent?: ComprasIntent;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  initialSubTab?: "pedidos" | "compras" | "bandeja" | "stock" | "materiales" | "proveedores" | null;
  onSubTabChange?: (sub: "pedidos" | "compras" | "bandeja" | "stock" | "materiales" | "proveedores" | null) => void;
}

type Sub = "pedidos" | "compras" | "bandeja";
type Alcance = "obra" | "todas";
const ALCANCE_KEY = "compras.alcance";

const readAlcance = (): Alcance => {
  try {
    return localStorage.getItem(ALCANCE_KEY) === "todas" ? "todas" : "obra";
  } catch {
    return "obra";
  }
};

/** Compras: 1. Pedidos de obra → 2. Órdenes de compra. El stock tiene su propio módulo. */
export const SuministrosTab: React.FC<SuministrosTabProps> = ({
  app,
  project,
  materialRequests,
  purchaseOrders,
  materials,
  workFronts,
  personnel,
  partners,
  currency,
  currentUser,
  intent,
  onRefresh,
  showToast,
  initialSubTab,
  onSubTabChange,
}) => {
  const def = APPS[app].suministros;
  const subs = def.subs as Sub[];
  /** Con una sola sección (ECMS: pedidos) no hay menú intermedio. */
  const unica = subs.length === 1 ? subs[0] : null;
  const elegible = (v: unknown): v is Sub => typeof v === "string" && (subs as string[]).includes(v);
  const [sub, setSubState] = useState<Sub | null>(elegible(initialSubTab) ? initialSubTab : unica);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [orderForm, setOrderForm] = useState<{ requestId: number | null } | null>(null);
  const [alcance, setAlcanceState] = useState<Alcance>(readAlcance);
  const [bandeja, setBandeja] = useState<Requisicion[]>([]);

  const loadBandeja = async () => {
    try {
      setBandeja(await api.getBandeja());
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar la bandeja de pedidos", "error");
    }
  };

  // La bandeja la usa el ERP; se recarga al abrirla y cada vez que cambian los datos
  const hayBandeja = subs.includes("bandeja");
  useEffect(() => {
    if (hayBandeja) loadBandeja();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayBandeja, purchaseOrders, materialRequests]);

  const setAlcance = (value: Alcance) => {
    setAlcanceState(value);
    try {
      localStorage.setItem(ALCANCE_KEY, value);
    } catch {
      /* sin almacenamiento: solo dura la sesión */
    }
  };

  const setSub = (value: Sub | null) => {
    setSubState(value ?? unica);
    onSubTabChange?.(value);
  };

  useEffect(() => {
    if (elegible(initialSubTab)) setSubState(initialSubTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubTab]);

  // Acciones que llegan desde el botón global "+ Crear"
  useEffect(() => {
    if (!intent) return;
    if (intent.action === "new-request" && subs.includes("pedidos")) {
      setSub("pedidos");
      setRequestFormOpen(true);
    } else if (intent.action === "new-order" && subs.includes("compras")) {
      setSub("compras");
      setOrderForm({ requestId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.nonce]);

  if (!project) return null;

  // Los formularios de OC siempre trabajan sobre la obra seleccionada
  const projectRequests = materialRequests.filter((r) => r.projectId === project.id);
  const projectOrders = purchaseOrders.filter((o) => o.projectId === project.id);
  const todas = alcance === "todas";
  const requests = todas ? materialRequests : projectRequests;
  const orders = todas ? purchaseOrders : projectOrders;

  const pendingRequests = requests.filter((r) => r.status === "BORRADOR" || r.status === "APROBADO_PARA_COMPRA").length;
  const pendingOrders = orders.filter((o) => ["BORRADOR", "APROBADO_PARA_COMPRA", "EMITIDA"].includes(o.status)).length;

  const alcanceToggle = (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
      {(
        [
          ["obra", `Esta obra · ${project.name}`],
          ["todas", "Todas las obras"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          onClick={() => setAlcance(value)}
          className={`max-w-[220px] truncate rounded-md px-3 py-1.5 transition ${alcance === value ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Page>
      <PageHeader title={def.title} help={def.help} />
      <div className="flex justify-end">{alcanceToggle}</div>
      {sub === null ? (
        <SectionNav<Sub>
          onSelect={setSub}
          groups={[
            {
              title: def.title,
              items: [
                ...(subs.includes("bandeja")
                  ? [{ value: "bandeja" as const, label: "Bandeja de pedidos", description: "Pedidos de obra y del Taller por comprar", icon: <Inbox className="h-5 w-5" />, badge: bandeja.filter((r) => r.estado === "RECIBIDA" || r.estado === "COMPRADA_PARCIAL").length }]
                  : []),
                ...(subs.includes("pedidos")
                  ? [{ value: "pedidos" as const, label: "Pedidos", description: "Pedidos de materiales del frente de obra", icon: <PackageSearch className="h-5 w-5" />, badge: pendingRequests }]
                  : []),
                ...(subs.includes("compras")
                  ? [{ value: "compras" as const, label: "Órdenes de compra", description: "Emitir y recibir órdenes de compra", icon: <ShoppingCart className="h-5 w-5" />, badge: pendingOrders }]
                  : []),
              ],
            },
          ]}
        />
      ) : (
        !unica && <BackButton onClick={() => setSub(null)} />
      )}

      {sub === "pedidos" && (
        <RequestsView
          project={project}
          requests={requests}
          showProject={todas}
          onNew={() => setRequestFormOpen(true)}
          onCreateOrder={
            subs.includes("compras")
              ? (r) => {
                  setSub("compras");
                  setOrderForm({ requestId: r.id });
                }
              : undefined
          }
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {sub === "bandeja" && (
        <BandejaView
          requisiciones={bandeja}
          partners={partners}
          currency={currency}
          onComprarPedidoDeObra={(materialRequestId) => {
            const pedido = materialRequests.find((r) => r.id === materialRequestId);
            if (pedido && pedido.projectId !== project.id) {
              showToast("Ese pedido es de otra obra: elegila arriba para armar su OC con los ítems de su presupuesto.", "info");
              return;
            }
            setSub("compras");
            setOrderForm({ requestId: materialRequestId });
          }}
          onRefresh={() => {
            onRefresh();
            loadBandeja();
          }}
          showToast={showToast}
        />
      )}

      {sub === "compras" && (
        <OrdersView
          project={project}
          orders={orders}
          showProject={todas}
          currency={currency}
          onNew={() => setOrderForm({ requestId: null })}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {requestFormOpen && (
        <RequestForm
          project={project}
          workFronts={workFronts}
          personnel={personnel}
          materials={materials}
          currentUser={currentUser}
          currency={currency}
          onClose={() => setRequestFormOpen(false)}
          onSaved={() => {
            setRequestFormOpen(false);
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {orderForm && (
        <OrderForm
          project={project}
          requests={projectRequests}
          orders={projectOrders}
          partners={partners}
          initialRequestId={orderForm.requestId}
          currency={currency}
          onClose={() => setOrderForm(null)}
          onSaved={() => {
            setOrderForm(null);
            onRefresh();
          }}
          onGoToRequests={() => {
            setOrderForm(null);
            setSub("pedidos");
          }}
          showToast={showToast}
        />
      )}
    </Page>
  );
};
