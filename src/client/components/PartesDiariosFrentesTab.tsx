import React, { useState } from "react";
import { Page, PageHeader, Tabs } from "../ui";
import { DailyLogTab } from "./DailyLogTab";
import { WorkFrontsTab } from "./WorkFrontsTab";
import { CombustiblePanel } from "../partes/CombustiblePanel";
import { ViajesPanel } from "../partes/ViajesPanel";
import { Project, WorkFront, Personnel } from "../types";

interface PartesDiariosFrentesTabProps {
  project?: Project | null;
  workFronts: WorkFront[];
  personnel: Personnel[];
  onRefresh?: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const PartesDiariosFrentesTab: React.FC<PartesDiariosFrentesTabProps> = ({
  project,
  workFronts,
  personnel,
  onRefresh,
  showToast,
}) => {
  const [subTab, setSubTab] = useState<"diario" | "combustible" | "viajes" | "frentes">("diario");

  return (
    <Page>
      <PageHeader
        title="Campo"
        help="Parte diario de la obra (horas por ítem, avance, combustible y viajes; funciona sin conexión), control de combustible y frentes de trabajo."
      />
      <Tabs
        value={subTab}
        onChange={setSubTab}
        items={[
          { value: "diario", label: "Parte diario" },
          { value: "combustible", label: "Combustible" },
          { value: "viajes", label: "Viajes" },
          { value: "frentes", label: "Frentes y equipos" },
        ]}
      />

      {subTab === "diario" && <DailyLogTab project={project} showToast={showToast} />}
      {subTab === "combustible" && project && <CombustiblePanel project={project} showToast={showToast} />}
      {subTab === "viajes" && project && <ViajesPanel project={project} showToast={showToast} />}

      {subTab === "frentes" && (
        <WorkFrontsTab project={project} workFronts={workFronts} personnel={personnel} onRefresh={onRefresh} showToast={showToast} />
      )}
    </Page>
  );
};
