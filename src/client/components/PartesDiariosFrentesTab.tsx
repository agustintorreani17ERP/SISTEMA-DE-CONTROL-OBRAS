import React, { useState } from "react";
import { HardHat, Compass } from "lucide-react";
import { DailyLogTab } from "./DailyLogTab";
import { WorkFrontsTab } from "./WorkFrontsTab";
import { Project, WorkFront, Personnel } from "../types";

interface PartesDiariosFrentesTabProps {
  project?: Project | null;
  workFronts: WorkFront[];
  personnel: Personnel[];
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const PartesDiariosFrentesTab: React.FC<PartesDiariosFrentesTabProps> = ({
  project,
  workFronts,
  personnel,
  showToast,
}) => {
  const [subTab, setSubTab] = useState<"diario" | "frentes">("diario");

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 p-2 rounded-2xl flex items-center gap-2 shadow-xs">
        <button
          onClick={() => setSubTab("diario")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            subTab === "diario"
              ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <HardHat className="w-4 h-4" />
          <span>Partes Diarios de Obra</span>
        </button>

        <button
          onClick={() => setSubTab("frentes")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            subTab === "frentes"
              ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>Frentes de Trabajo & Tramos</span>
        </button>
      </div>

      {subTab === "diario" && (
        <DailyLogTab
          project={project}
          workFronts={workFronts}
          showToast={showToast}
        />
      )}

      {subTab === "frentes" && (
        <WorkFrontsTab
          project={project}
          workFronts={workFronts}
          personnel={personnel}
        />
      )}
    </div>
  );
};
