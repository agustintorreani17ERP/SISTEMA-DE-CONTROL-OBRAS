import React, { useState } from "react";
import { Page, PageHeader, Tabs } from "../ui";
import { Project } from "../types";
import { LegajoTab } from "./rrhh/LegajoTab";
import { AsistenciaTab } from "./rrhh/AsistenciaTab";
import { LiquidacionTab } from "./rrhh/LiquidacionTab";
import { ConfigRRHHTab } from "./rrhh/ConfigRRHHTab";

interface RRHHTabProps {
  project?: Project | null;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Sub = "legajo" | "asistencia" | "liquidacion" | "config";

export const RRHHTab: React.FC<RRHHTabProps> = ({ project, showToast }) => {
  const [sub, setSub] = useState<Sub>("legajo");

  if (!project) {
    return (
      <Page>
        <PageHeader title="RRHH" help="Seleccioná una obra para gestionar el personal." />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Recursos Humanos"
        eyebrow={project.name}
        help="Legajo, asistencia diaria y liquidación de haberes."
      />
      <Tabs
        value={sub}
        onChange={setSub}
        items={[
          { value: "legajo", label: "Legajo" },
          { value: "asistencia", label: "Asistencia" },
          { value: "liquidacion", label: "Liquidación" },
          { value: "config", label: "Configuración" },
        ]}
      />

      {sub === "legajo" && <LegajoTab project={project} showToast={showToast} />}
      {sub === "asistencia" && <AsistenciaTab project={project} showToast={showToast} />}
      {sub === "liquidacion" && <LiquidacionTab project={project} showToast={showToast} />}
      {sub === "config" && <ConfigRRHHTab project={project} showToast={showToast} />}
    </Page>
  );
};
