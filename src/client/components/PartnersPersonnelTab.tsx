import React, { useState } from "react";
import {
  Users,
  Building2,
  HardHat,
  Search,
  Filter,
  Phone,
  Mail,
  MapPin,
  FileBadge,
  ShieldCheck,
} from "lucide-react";
import { Partner, Personnel, Material } from "../types";

interface PartnersPersonnelTabProps {
  partners: Partner[];
  personnel: Personnel[];
  materials: Material[];
}

export const PartnersPersonnelTab: React.FC<PartnersPersonnelTabProps> = ({
  partners,
  personnel,
  materials,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"partners" | "personnel" | "materials">("partners");
  const [searchTerm, setSearchTerm] = useState("");
  const [partnerKindFilter, setPartnerKindFilter] = useState<string>("ALL");

  const filteredPartners = partners.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.taxId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.classification || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesKind = partnerKindFilter === "ALL" || p.kind === partnerKindFilter;
    return matchesSearch && matchesKind;
  });

  const filteredPersonnel = personnel.filter((per) => {
    return (
      per.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      per.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (per.email || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const filteredMaterials = materials.filter((m) => {
    return (
      m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600" />
            <h1 className="text-xl font-bold text-stone-900 font-display">
              Directorio de Proveedores, Subcontratistas & Personal
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Registro de actores de la cadena de suministro, contratistas especializados y nómina técnica en obra.
          </p>
        </div>

        {/* Sub-tab pills */}
        <div className="flex items-center bg-stone-100 p-1 rounded-lg border border-stone-200">
          <button
            onClick={() => setActiveSubTab("partners")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === "partners"
                ? "bg-white text-stone-900 shadow-xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Proveedores & Subcontratos ({partners.length})
          </button>
          <button
            onClick={() => setActiveSubTab("personnel")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === "personnel"
                ? "bg-white text-stone-900 shadow-xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Personal Técnico ({personnel.length})
          </button>
          <button
            onClick={() => setActiveSubTab("materials")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === "materials"
                ? "bg-white text-stone-900 shadow-xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Catálogo Insumos ({materials.length})
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre, RUC o rol..."
            className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-xs outline-none focus:border-amber-500 transition"
          />
        </div>

        {activeSubTab === "partners" && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-stone-400" />
            <select
              value={partnerKindFilter}
              onChange={(e) => setPartnerKindFilter(e.target.value)}
              className="border border-stone-200 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 bg-white"
            >
              <option value="ALL">Todos los Tipos</option>
              <option value="SUPPLIER">Solo Proveedores</option>
              <option value="SUBCONTRACTOR">Solo Subcontratistas</option>
              <option value="BOTH">Ambos</option>
            </select>
          </div>
        )}
      </div>

      {/* Sub-tab Content: Partners */}
      {activeSubTab === "partners" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPartners.map((partner) => (
            <div
              key={partner.id}
              className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm flex flex-col justify-between hover:border-amber-400 transition"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      partner.kind === "SUBCONTRACTOR"
                        ? "bg-purple-100 text-purple-800"
                        : partner.kind === "SUPPLIER"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {partner.kind === "SUBCONTRACTOR"
                      ? "Subcontratista"
                      : partner.kind === "SUPPLIER"
                      ? "Proveedor"
                      : "Proveedor & Subcontratista"}
                  </span>
                  <span className="font-mono text-xs font-bold text-stone-700">
                    RUC: {partner.taxId}
                  </span>
                </div>

                <h3 className="font-bold text-stone-900 text-sm mt-2">{partner.name}</h3>
                {partner.classification && (
                  <div className="text-xs text-amber-800 font-semibold mt-0.5">
                    Rubro: {partner.classification}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 space-y-1.5 text-xs text-stone-600">
                {partner.fiscalAddress && (
                  <div className="flex items-center gap-1.5 truncate">
                    <MapPin className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="truncate">{partner.fiscalAddress}</span>
                  </div>
                )}
                {partner.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>{partner.phone}</span>
                  </div>
                )}
                {partner.email && (
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="truncate">{partner.email}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tab Content: Personnel */}
      {activeSubTab === "personnel" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredPersonnel.map((person) => {
            const roleBadge = () => {
              switch (person.role) {
                case "GERENCIA":
                  return "bg-rose-100 text-rose-800 border-rose-200";
                case "JEFE_FRENTE":
                  return "bg-blue-100 text-blue-800 border-blue-200";
                case "COMPRAS":
                  return "bg-amber-100 text-amber-800 border-amber-200";
                case "ALMACEN":
                  return "bg-emerald-100 text-emerald-800 border-emerald-200";
                default:
                  return "bg-stone-100 text-stone-800";
              }
            };

            return (
              <div
                key={person.id}
                className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center font-bold text-stone-700 mb-2">
                    {person.fullName.slice(0, 2).toUpperCase()}
                  </div>
                  <h3 className="font-bold text-stone-900 text-sm">{person.fullName}</h3>
                  <span
                    className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded border ${roleBadge()}`}
                  >
                    {person.role.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-stone-100 text-xs text-stone-500">
                  {person.email ? (
                    <div className="flex items-center gap-1.5 truncate">
                      <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      <span className="truncate">{person.email}</span>
                    </div>
                  ) : (
                    <span>En faena sin email corporativo</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sub-tab Content: Materials */}
      {activeSubTab === "materials" && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Descripción Insumo</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3">Unidad de Medida</th>
                  <th className="p-3 text-right">Costo Estimado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredMaterials.map((mat) => (
                  <tr key={mat.id} className="hover:bg-stone-50 transition">
                    <td className="p-3 font-mono font-bold text-stone-900">{mat.code}</td>
                    <td className="p-3 font-semibold text-stone-800">{mat.description}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-700">
                        {mat.category}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-medium text-stone-600">{mat.unit}</td>
                    <td className="p-3 text-right font-mono font-semibold text-stone-900">
                      {mat.estimatedCost
                        ? new Intl.NumberFormat("es-PY").format(Number(mat.estimatedCost)) + " ₲"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
