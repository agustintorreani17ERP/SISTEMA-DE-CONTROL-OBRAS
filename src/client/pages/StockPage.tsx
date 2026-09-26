import React from "react";
import { Material, Project, StockMovement, WarehouseStock, WorkFront } from "../types";
import { Page, PageHeader, Stat, StatGrid } from "../ui";
import { StockWarehouseTab } from "../components/StockWarehouseTab";

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
  const now = new Date();
  const withStock = stock.filter((s) => Number(s.currentStock) > 0).length;
  const low = stock.filter((s) => Number(s.currentStock) <= 5).length;
  const monthMoves = movements.filter((m) => {
    const d = new Date(m.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <Page>
      <PageHeader title="Stock" help="Lo que hay en depósito. Entra al recibir una orden de compra y sale con cada salida a obra." />
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
