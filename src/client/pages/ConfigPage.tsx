import React, { useState } from "react";
import { Material, Partner } from "../types";
import { Page, PageHeader, Tabs } from "../ui";
import { InsumosPage } from "../insumos/InsumosPage";
import { SuppliersListTab } from "../components/SuppliersListTab";

interface ConfigPageProps {
  materials: Material[];
  partners: Partner[];
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Catálogos que se usan en todas las obras: insumos y proveedores / subcontratistas. */
export const ConfigPage: React.FC<ConfigPageProps> = ({ materials, partners, onRefresh, showToast }) => {
  const [tab, setTab] = useState<"insumos" | "proveedores">("insumos");
  return (
    <Page>
      <PageHeader title="Configuración" help="Catálogos compartidos por todas las obras." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "insumos", label: "Insumos", count: materials.length },
          { value: "proveedores", label: "Proveedores y subcontratistas", count: partners.length },
        ]}
      />
      {tab === "insumos" ? (
        <InsumosPage showToast={showToast} />
      ) : (
        <SuppliersListTab partners={partners} onRefresh={onRefresh} showToast={showToast} />
      )}
    </Page>
  );
};
