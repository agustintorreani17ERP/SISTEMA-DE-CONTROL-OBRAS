import React, { useEffect, useState } from "react";
import {
  BudgetItem,
  Material,
  MaterialRequest,
  Partner,
  Personnel,
  Project,
  PurchaseOrder,
  StockMovement,
  User,
  WarehouseStock,
  WorkFront,
} from "../types";
import { Page, PageHeader, Tabs } from "../ui";
import { RequestsView } from "../compras/RequestsView";
import { OrdersView } from "../compras/OrdersView";
import { RequestForm } from "../compras/RequestForm";
import { OrderForm } from "../compras/OrderForm";

export type ComprasIntent = { action: "new-request" | "new-order"; nonce: number } | null;

interface SuministrosTabProps {
  project?: Project | null;
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
  initialSubTab?: "pedidos" | "compras" | "stock" | "materiales" | "proveedores";
  onSubTabChange?: (sub: "pedidos" | "compras" | "stock" | "materiales" | "proveedores") => void;
}

type Sub = "pedidos" | "compras";

/** Compras: 1. Pedidos de obra → 2. Órdenes de compra. El stock tiene su propio módulo. */
export const SuministrosTab: React.FC<SuministrosTabProps> = ({
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
  const [sub, setSubState] = useState<Sub>(initialSubTab === "compras" ? "compras" : "pedidos");
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [orderForm, setOrderForm] = useState<{ requestId: number | null } | null>(null);

  const setSub = (value: Sub) => {
    setSubState(value);
    onSubTabChange?.(value);
  };

  useEffect(() => {
    if (initialSubTab === "compras" || initialSubTab === "pedidos") setSubState(initialSubTab);
  }, [initialSubTab]);

  // Acciones que llegan desde el botón global "+ Crear"
  useEffect(() => {
    if (!intent) return;
    if (intent.action === "new-request") {
      setSub("pedidos");
      setRequestFormOpen(true);
    } else {
      setSub("compras");
      setOrderForm({ requestId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.nonce]);

  if (!project) return null;

  const pendingRequests = materialRequests.filter((r) => r.status === "BORRADOR" || r.status === "APROBADO_PARA_COMPRA").length;
  const pendingOrders = purchaseOrders.filter((o) => ["BORRADOR", "APROBADO_PARA_COMPRA", "EMITIDA"].includes(o.status)).length;

  return (
    <Page>
      <PageHeader title="Compras" help="Pedido de obra → orden de compra. Al emitir la OC se descuenta del rubro; al recibirla entra al stock." />
      <Tabs
        value={sub}
        onChange={setSub}
        items={[
          { value: "pedidos", label: "1. Pedidos", count: pendingRequests },
          { value: "compras", label: "2. Órdenes de compra", count: pendingOrders },
        ]}
      />

      {sub === "pedidos" ? (
        <RequestsView
          project={project}
          requests={materialRequests}
          onNew={() => setRequestFormOpen(true)}
          onCreateOrder={(r) => {
            setSub("compras");
            setOrderForm({ requestId: r.id });
          }}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      ) : (
        <OrdersView
          project={project}
          orders={purchaseOrders}
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
          requests={materialRequests}
          orders={purchaseOrders}
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
