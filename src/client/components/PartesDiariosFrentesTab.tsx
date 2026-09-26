import React, { useState } from "react";
import { Page, PageHeader, Tabs } from "../ui";
import { DailyLogTab } from "./DailyLogTab";
import { WorkFrontsTab } from "./WorkFrontsTab";
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
  const [subTab, setSubTab] = useState<"diario" | "frentes">("diario");

  return (
    <Page>
      <PageHeader title="Campo" help="Parte diario de la obra y frentes de trabajo." />
      <Tabs
        value={subTab}
        onChange={setSubTab}
        items={[
          { value: "diario", label: "Parte diario" },
          { value: "frentes", label: "Frentes y equipos" },
        ]}
      />

      {subTab === "diario" && (
        <DailyLogTab
          project={project}
          workFronts={workFronts}
          showToast={showToast}
        />
      )}

      {subTab === "frentes" && (
        <WorkFrontsTab project={project} workFronts={workFronts} personnel={personnel} onRefresh={onRefresh} showToast={showToast} />
      )}
    </Page>
  );
};
