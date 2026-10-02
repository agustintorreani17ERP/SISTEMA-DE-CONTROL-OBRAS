import React, { useState } from "react";
import type { Project } from "../types";
import { Page, PageHeader, Tabs } from "../ui";
import { CostDashboard } from "./CostDashboard";
import { SolicitudesFondosPanel } from "../fondos/SolicitudesFondosPanel";

/** Inicio de la obra: el resumen general, el tablero de costos (motor de costos, hoja 8) o las solicitudes de fondos de la obra. */
export function DashboardHome({ project, overview, showToast }: { project: Project; overview: React.ReactNode; showToast: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [view, setView] = useState<"resumen" | "costos" | "fondos">("costos");
  return (
    <div className="space-y-4">
      <div className="px-0">
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: "costos", label: "Tablero de costos" },
            { value: "resumen", label: "Resumen general" },
            { value: "fondos", label: "Solicitudes de fondos" },
          ]}
        />
      </div>
      {view === "resumen" ? (
        overview
      ) : view === "fondos" ? (
        <Page>
          <PageHeader
            eyebrow={`${project.code}${project.clientName ? ` · ${project.clientName}` : ""}`}
            title="Solicitudes de fondos"
            help="Pagos pedidos a tesorería por certificados de subcontratistas aprobados y anticipos otorgados de esta obra."
          />
          <SolicitudesFondosPanel project={project} fixedProject showToast={showToast} />
        </Page>
      ) : (
        <Page>
          <PageHeader
            eyebrow={`${project.code}${project.clientName ? ` · ${project.clientName}` : ""}`}
            title="Tablero de costos"
            help="Costo real del motor de costos por rango: venta, margen real vs previsto, valor ganado, IC, IP, costo proyectado, curva S y alertas."
          />
          <CostDashboard project={project} showToast={showToast} />
        </Page>
      )}
    </div>
  );
}
