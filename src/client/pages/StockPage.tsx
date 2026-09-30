import React from "react";
import { Material, Project, StockMovement, WarehouseStock, WorkFront } from "../types";
import { Page, PageHeader, Stat, StatGrid } from "../ui";
import { StockWarehouseTab } from "../components/StockWarehouseTab";
import { todayIso } from "../insumos/labels";

interface StockPageProps {
  project: Project;
  stock: WarehouseStock[];
  movements: StockMovement[];
  materials: Material[];
  workFronts: WorkFront[];
  intent?: { action: "out" | "adjust"; nonce: number } | null;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Stock de materiales de la obra: existencias, salidas a obra y ajustes. */
export function StockPage({ project, stock, movements, materials, workFronts, intent, onRefresh, showToast }: StockPageProps) {
  const month = todayIso().slice(0, 7);
  const withStock = stock.filter((s) => Number(s.currentStock) > 0).length;
  const low = stock.filter((s) => Number(s.currentStock) <= 5).length;
  const monthMoves = movements.filter((m) => (m.fecha ?? "").startsWith(month)).length;

  return (
    <Page>
      <PageHeader title="Stock" help="Stock de la obra por insumo, con movimientos fechados: compras, salidas, transferencias, ajustes y conteos." />
      <StatGrid>
        <Stat label="Materiales con existencia" value={withStock} hint={`${stock.length} materiales registrados`} />
        <Stat label="Sin stock o bajo" value={low} tone={low > 0 ? "warn" : "good"} hint="5 unidades o menos" />
        <Stat label="Movimientos del mes" value={monthMoves} />
      </StatGrid>
      <StockWarehouseTab
        project={project}
        stock={stock}
        movements={movements}
        materials={materials}
        workFronts={workFronts}
        intent={intent}
        onRefresh={onRefresh}
        showToast={showToast}
      />
    </Page>
  );
}
