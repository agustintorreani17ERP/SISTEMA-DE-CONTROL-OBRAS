import React, { useState, useEffect } from "react";
import { Package, ShoppingCart, Warehouse, Boxes, Building2 } from "lucide-react";
import { MaterialRequestsTab } from "./MaterialRequestsTab";
import { PurchaseOrdersTab } from "./PurchaseOrdersTab";
import { StockWarehouseTab } from "./StockWarehouseTab";
import { MaterialsListTab } from "./MaterialsListTab";
import { SuppliersListTab } from "./SuppliersListTab";
import {
  Project,
  MaterialRequest,
  PurchaseOrder,
  WarehouseStock,
  StockMovement,
  Material,
  WorkFront,
  Personnel,
  Partner,
  BudgetItem,
} from "../types";

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
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  initialSubTab?: "pedidos" | "compras" | "stock" | "materiales" | "proveedores";
  onSubTabChange?: (sub: "pedidos" | "compras" | "stock" | "materiales" | "proveedores") => void;
}

export const SuministrosTab: React.FC<SuministrosTabProps> = ({
  project,
  materialRequests,
  purchaseOrders,
  stock,
  stockMovements,
  materials,
  workFronts,
  personnel,
  partners,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  initialSubTab,
  onSubTabChange,
}) => {
  const [subTab, setSubTabState] = useState<"pedidos" | "compras" | "stock" | "materiales" | "proveedores">(
    initialSubTab || "pedidos"
  );

  useEffect(() => {
    if (initialSubTab && initialSubTab !== subTab) {
      setSubTabState(initialSubTab);
    }
  }, [initialSubTab]);

  const setSubTab = (newTab: "pedidos" | "compras" | "stock" | "materiales" | "proveedores") => {
    setSubTabState(newTab);
    onSubTabChange?.(newTab);
  };
  const [selectedRequestForPO, setSelectedRequestForPO] = useState<MaterialRequest | null>(null);

  const pendingRequests = materialRequests.filter((r) => r.status === "BORRADOR").length;
  const pendingOrders = purchaseOrders.filter(
    (o) => o.status === "BORRADOR" || o.status === "APROBADO_PARA_COMPRA"
  ).length;
  const lowStock = stock.filter((s) => Number(s.currentStock || 0) <= 5).length;
  const suppliersCount = partners.filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH").length;

  return (
    <div className="space-y-4">
      {/* Subnav Pills for Suministros */}
      <div className="bg-white border border-slate-200 p-2 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSubTab("pedidos")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "pedidos"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Requisiciones / Pedidos</span>
            {pendingRequests > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {pendingRequests}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab("compras")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "compras"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Órdenes de Compra</span>
            {pendingOrders > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {pendingOrders}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab("stock")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "stock"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Warehouse className="w-4 h-4" />
            <span>Control de Stock</span>
            {lowStock > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                {lowStock} bajo
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab("materiales")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "materiales"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>Catálogo de Materiales ({materials.length})</span>
          </button>

          <button
            onClick={() => setSubTab("proveedores")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subTab === "proveedores"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Building2 className="w-4 h-4 text-blue-600" />
            <span>Proveedores ({suppliersCount})</span>
          </button>
        </div>
      </div>

      {/* Render selected Suministros sub-module */}
      {subTab === "pedidos" && (
        <MaterialRequestsTab
          project={project}
          materialRequests={materialRequests}
          workFronts={workFronts}
          personnel={personnel}
          materials={materials}
          budgetItems={budgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
          onOpenCreatePOForRequest={(req) => {
            setSelectedRequestForPO(req);
            setSubTab("compras");
          }}
        />
      )}

      {subTab === "compras" && (
        <PurchaseOrdersTab
          project={project}
          purchaseOrders={purchaseOrders}
          materialRequests={materialRequests}
          partners={partners}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
          selectedRequestForNewPO={selectedRequestForPO}
          onClearSelectedRequestForPO={() => setSelectedRequestForPO(null)}
        />
      )}

      {subTab === "stock" && (
        <StockWarehouseTab
          project={project}
          stock={stock}
          movements={stockMovements}
          materials={materials}
          workFronts={workFronts}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {subTab === "materiales" && (
        <MaterialsListTab
          materials={materials}
          stock={stock}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}

      {subTab === "proveedores" && (
        <SuppliersListTab
          partners={partners}
          onRefresh={onRefresh}
          showToast={showToast}
        />
      )}
    </div>
  );
};
