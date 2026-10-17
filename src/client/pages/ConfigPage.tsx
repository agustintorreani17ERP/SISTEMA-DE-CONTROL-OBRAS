import React from "react";
import { Material, Partner } from "../types";
import { Page, PageHeader } from "../ui";
import { APPS, type AppId } from "../apps";
import { InsumosPage } from "../insumos/InsumosPage";
import { SuppliersListTab } from "../components/SuppliersListTab";

interface ConfigPageProps {
  app: AppId;
  materials: Material[];
  partners: Partner[];
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/**
 * Catálogo que se edita en cada app y se usa en todas las obras: los insumos se editan en el ERP
 * (el ECMS solo los usa); los proveedores y subcontratistas, en el ECMS.
 */
export const ConfigPage: React.FC<ConfigPageProps> = ({ app, materials, partners, onRefresh, showToast }) => {
  const insumos = APPS[app].catalogo === "insumos";
  return (
    <Page>
      <PageHeader
        title={insumos ? "Insumos" : "Proveedores y subcontratistas"}
        help={insumos ? `Catálogo de insumos compartido por todas las obras (${materials.length}).` : `Proveedores y subcontratistas compartidos por todas las obras (${partners.length}).`}
      />
      {insumos ? <InsumosPage showToast={showToast} /> : <SuppliersListTab partners={partners} onRefresh={onRefresh} showToast={showToast} />}
    </Page>
  );
};
