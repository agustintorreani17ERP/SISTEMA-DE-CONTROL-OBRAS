import React, { useState } from "react";
import { Material, Partner, WarehouseStock } from "../types";
import { Page, PageHeader, Tabs } from "../ui";
import { MaterialsListTab } from "../components/MaterialsListTab";
import { SuppliersListTab } from "../components/SuppliersListTab";

interface ConfigPageProps {
  materials: Material[];
  partners: Partner[];
  stock: WarehouseStock[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Catálogos que se usan en todas las obras: materiales y proveedores / subcontratistas. */
export const ConfigPage: React.FC<ConfigPageProps> = ({ materials, partners, stock, currency, onRefresh, showToast }) => {
  const [tab, setTab] = useState<"materiales" | "proveedores">("materiales");
  return (
    <Page>
      <PageHeader title="Configuración" help="Catálogos compartidos por todas las obras." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "materiales", label: "Materiales", count: materials.length },
          { value: "proveedores", label: "Proveedores y subcontratistas", count: partners.length },
        ]}
      />
      {tab === "materiales" ? (
        <MaterialsListTab materials={materials} stock={stock} currency={currency} onRefresh={onRefresh} showToast={showToast} />
      ) : (
        <SuppliersListTab partners={partners} onRefresh={onRefresh} showToast={showToast} />
      )}
    </Page>
  );
};
