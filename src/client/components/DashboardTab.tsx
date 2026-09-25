import React from "react";
import {
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Receipt,
  FileCheck,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Layers,
  ChevronRight,
  Package,
  HardHat,
  Truck,
  Plus,
} from "lucide-react";
import { DashboardData, Project, BudgetItem, MaterialRequest, PurchaseOrder, SubcontractorContract } from "../types";
import { formatMoney, formatCompactMoney, formatPercent, formatDate } from "../utils/format";
import { getStatusBadge } from "../utils/statusBadges";

interface DashboardTabProps {
  project?: Project | null;
  dashboard: DashboardData | null;
  currency: "PYG" | "USD";
  materialRequests: MaterialRequest[];
  purchaseOrders: PurchaseOrder[];
  subcontracts: SubcontractorContract[];
  onNavigateTab: (tab: any) => void;
  onOpenNewRequest: () => void;
  onOpenNewOrder: () => void;
  onOpenNewSubcontract: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  project,
  dashboard,
  currency,
  materialRequests,
  purchaseOrders,
  subcontracts,
  onNavigateTab,
  onOpenNewRequest,
  onOpenNewOrder,
  onOpenNewSubcontract,
}) => {
  const kpis = dashboard?.kpis || {
    globalBudget: 0,
    contractualAmount: 0,
    realUpdated: 0,
    totalSpent: 0,
    availableReal: 0,
    committed: 0,
    realSpend: 0,
    issuedPurchaseOrders: 0,
    subcontractCertified: 0,
    subcontractPaid: 0,
  };

  const budgetItems = dashboard?.budgetByItem || [];
  const issuedOrders = dashboard?.issuedOrders || [];
  const recentCertificates = dashboard?.recentCertificates || [];

  // Compute percentages
  const contractual = kpis.contractualAmount || kpis.globalBudget || 1;
  const realTotal = kpis.realUpdated || contractual;
  const totalSpent = kpis.totalSpent || 0;
  const availableReal = kpis.availableReal || Math.max(0, realTotal - totalSpent);
  const spentPct = Math.min(100, (totalSpent / realTotal) * 100);

  // Requisitions pending approval
  const pendingRequests = materialRequests.filter((r) => r.status === "BORRADOR");
  // Orders pending issue or receive
  const pendingOrders = purchaseOrders.filter((o) => o.status === "BORRADOR" || o.status === "APROBADO_PARA_COMPRA");

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Top Banner with Quick Actions */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]"></span>
            <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
              Control Presupuestario & Estado de Obra
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Supervisión en tiempo real de partidas presupuestarias, abastecimiento y ejecución de obra.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="btn-quick-new-request"
            onClick={onOpenNewRequest}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Requisición</span>
          </button>
          <button
            id="btn-quick-new-order"
            onClick={onOpenNewOrder}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 active:scale-95 text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Orden (OC)</span>
          </button>
          <button
            id="btn-quick-new-subcontract"
            onClick={onOpenNewSubcontract}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 active:scale-95 text-slate-700 border border-slate-200 text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Subcontrato</span>
          </button>
        </div>
      </div>

      {/* Primary Financial Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Contractual Initial */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Presupuesto Contractual
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-extrabold text-slate-900">
            {formatMoney(contractual, currency)}
          </div>
          <div className="mt-2 flex items-center text-[11px] text-slate-500 justify-between border-t border-slate-100 pt-2">
            <span>Contrato Base</span>
            <span className="font-semibold text-slate-700">{project?.code || "CTN-01"}</span>
          </div>
        </div>

        {/* Metric 2: Real Updated with Adendas */}
        <div className="bg-white rounded-2xl p-4 border border-blue-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
              Monto Real Actualizado
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-extrabold text-blue-900">
            {formatMoney(realTotal, currency)}
          </div>
          <div className="mt-2 flex items-center text-[11px] text-slate-500 justify-between border-t border-slate-100 pt-2">
            <span>Incluye Adendas</span>
            <span className="font-semibold text-blue-700 font-mono">
              +{formatCompactMoney(Math.max(0, realTotal - contractual))}
            </span>
          </div>
        </div>

        {/* Metric 3: Total Spent & Committed */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              Comprometido + Ejecutado
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-extrabold text-slate-900">
            {formatMoney(totalSpent, currency)}
          </div>
          <div className="mt-2 flex items-center text-[11px] text-slate-500 justify-between border-t border-slate-100 pt-2">
            <span>Ratio Consumido</span>
            <span className="font-bold text-amber-700 font-mono">{spentPct.toFixed(1)}%</span>
          </div>
        </div>

        {/* Metric 4: Real Available */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Saldo Disponible Real
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-extrabold text-emerald-800">
            {formatMoney(availableReal, currency)}
          </div>
          <div className="mt-2 flex items-center text-[11px] text-slate-500 justify-between border-t border-slate-100 pt-2">
            <span>Margen de Obra</span>
            <span className="font-bold text-emerald-700 font-mono">
              {(100 - spentPct).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Progress Bar with Hard Budget Ceiling */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Ejecución Presupuestaria Global vs. Techo de Gasto
            </h2>
            <p className="text-xs text-slate-500">
              Monitoreo estricto del techo presupuestario para prevenir descalces financieros en obra.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
              Gastado: {formatCompactMoney(totalSpent)}
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
              Disponible: {formatCompactMoney(availableReal)}
            </span>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              spentPct > 90 ? "bg-rose-500" : spentPct > 75 ? "bg-amber-500" : "bg-blue-600"
            }`}
            style={{ width: `${Math.max(2, spentPct)}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>0 ₲</span>
          <span className="font-semibold text-slate-800">Techo: {formatMoney(realTotal, currency)}</span>
        </div>
      </div>

      {/* Two Column Layout: Budget Items Watchdog & Operational Action Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Budget Items Watchdog */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Techo Presupuestario por Rubro / Partida
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab("partidas")}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>Ver todas las partidas</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4 overflow-x-auto">
            {budgetItems.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No hay partidas registradas para esta obra.
              </div>
            ) : (
              <div className="space-y-4">
                {budgetItems.map((item) => {
                  const orig = Number(item.original ?? item.originalAmount ?? 0);
                  const comm = Number(item.committed ?? item.committedAmount ?? 0);
                  const exec = Number(item.executed ?? item.executedAmount ?? 0);
                  const rem = Number(item.remaining ?? item.available ?? orig - (comm + exec));
                  const pct = orig > 0 ? ((comm + exec) / orig) * 100 : 0;
                  const isCritical = pct >= 90;
                  const isWarning = pct >= 75 && pct < 90;

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-blue-50/20 hover:border-blue-200 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                            {item.code}
                          </span>
                          <span className="text-xs font-semibold text-slate-900">{item.name}</span>
                          <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {item.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-slate-500">
                            Gastado: <span className="font-semibold text-slate-900">{formatCompactMoney(comm + exec)}</span>
                          </span>
                          <span className="text-slate-300">/</span>
                          <span className="text-slate-700 font-bold">{formatCompactMoney(orig)}</span>
                        </div>
                      </div>

                      {/* Item progress bar */}
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCritical ? "bg-rose-500" : isWarning ? "bg-amber-500" : "bg-blue-600"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
                        />
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">
                          Saldo Disponible:{" "}
                          <span className="font-mono font-semibold text-emerald-700">
                            {formatMoney(rem, currency)}
                          </span>
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            isCritical
                              ? "text-rose-600"
                              : isWarning
                              ? "text-amber-600"
                              : "text-blue-600"
                          }`}
                        >
                          {pct.toFixed(1)}% utilizado
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: Operational Action Queues */}
        <div className="space-y-4">
          {/* Pending Approval Requisitions */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Requisiciones Pendientes ({pendingRequests.length})
                </h3>
              </div>
              <button
                onClick={() => onNavigateTab("pedidos")}
                className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
              >
                Ver todas
              </button>
            </div>

            {pendingRequests.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">
                No hay requisiciones en borrador pendientes.
              </p>
            ) : (
              <div className="space-y-2">
                {pendingRequests.slice(0, 3).map((req) => (
                  <div
                    key={req.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono font-bold text-blue-600">{req.number}</div>
                      <div className="text-[11px] text-slate-500">
                        {req.workFront?.name || "Sector de Obra"}
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateTab("pedidos")}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                    >
                      Revisar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Purchase Orders */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Órdenes en Gestión ({pendingOrders.length})
                </h3>
              </div>
              <button
                onClick={() => onNavigateTab("compras")}
                className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
              >
                Ver todas
              </button>
            </div>

            {pendingOrders.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">
                Todas las órdenes han sido emitidas o recibidas.
              </p>
            ) : (
              <div className="space-y-2">
                {pendingOrders.slice(0, 3).map((order) => (
                  <div
                    key={order.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono font-bold text-slate-900">{order.number}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {formatMoney(order.totalAmount, currency)}
                      </div>
                    </div>
                    {getStatusBadge(order.status)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Subcontractors Commitment Card */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700">
                Subcontratos de Obra
              </span>
              <FileCheck className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-xs text-slate-500">
              Certificados acumulados de avance físico y retenciones de garantía de obra.
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">Total Certificado</span>
              <span className="font-mono font-bold text-slate-900">
                {formatMoney(kpis.subcontractCertified, currency)}
              </span>
            </div>
            <button
              onClick={() => onNavigateTab("subcontratos")}
              className="mt-3 w-full py-2 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 active:scale-95 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Gestionar Subcontratos</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Issued Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Últimas Órdenes de Compra Emitidas
            </h3>
          </div>
          <button
            onClick={() => onNavigateTab("compras")}
            className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>Ver módulo de compras</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">N° Orden</th>
                <th className="p-3">Proveedor</th>
                <th className="p-3">Fecha Emisión</th>
                <th className="p-3 text-right">Monto Total</th>
                <th className="p-3 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issuedOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
                    No se han emitido órdenes de compra aún.
                  </td>
                </tr>
              ) : (
                issuedOrders.map((ord: any) => (
                  <tr key={ord.id} className="hover:bg-blue-50/30 transition">
                    <td className="p-3 font-mono font-bold text-blue-600">{ord.number}</td>
                    <td className="p-3 font-medium text-slate-900">
                      {ord.partner?.name || ord.partnerName || "Proveedor"}
                    </td>
                    <td className="p-3 text-slate-500">{formatDate(ord.issueDate)}</td>
                    <td className="p-3 text-right font-mono font-semibold text-slate-900">
                      {formatMoney(ord.totalAmount, currency)}
                    </td>
                    <td className="p-3 text-center">
                      {getStatusBadge(ord.status || "EMITIDA")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
