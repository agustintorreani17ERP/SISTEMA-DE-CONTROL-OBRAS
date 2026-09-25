import React, { useState, useEffect } from "react";
import {
  Plus,
  FileSpreadsheet,
  Layers,
  Building2,
  Calendar,
  CheckCircle2,
  Lock,
  ArrowRight,
  Eye,
  Trash2,
  DollarSign,
  Filter,
  FileText,
  Search,
  Sparkles,
} from "lucide-react";
import { Project, Partner, Certification } from "../../types";
import { api } from "../../api";
import { MeasurementForm } from "./MeasurementForm";
import { CertificateExcelPreview } from "./CertificateExcelPreview";

interface AdvancedCertificationsViewProps {
  projects: Project[];
  partners: Partner[];
  selectedProjectId?: number;
  onNavigateToInvoice?: (invoiceId: number) => void;
}

export const AdvancedCertificationsView: React.FC<AdvancedCertificationsViewProps> = ({
  projects,
  partners,
  selectedProjectId: initialSelectedProjectId,
  onNavigateToInvoice,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<number>(
    initialSelectedProjectId || projects[0]?.id || 1
  );
  const [filterPartnerId, setFilterPartnerId] = useState<string>("ALL");
  const [filterEstado, setFilterEstado] = useState<string>("ALL");
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(false);

  // Vistas activas: "LIST" | "CREATE" | "PREVIEW"
  const [activeView, setActiveView] = useState<"LIST" | "CREATE" | "PREVIEW">("LIST");
  const [selectedCertId, setSelectedCertId] = useState<number | null>(null);

  // Cargar lista de certificaciones
  const loadCertifications = () => {
    setLoading(true);
    const params: any = {};
    if (selectedProjectId) params.projectId = selectedProjectId;
    if (filterPartnerId !== "ALL") {
      params.partnerId = filterPartnerId === "CLIENT" ? null : Number(filterPartnerId);
    }
    if (filterEstado !== "ALL") {
      params.estado = filterEstado;
    }

    api
      .getCertifications(params)
      .then((data) => {
        setCertifications(data);
      })
      .catch((err) => {
        console.error("Error al cargar certificaciones:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadCertifications();
  }, [selectedProjectId, filterPartnerId, filterEstado]);

  // Manejo de eliminación de certificación borrador
  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("¿Está seguro de eliminar esta medición/certificación borrador?")) return;
    try {
      await api.deleteCertification(id);
      loadCertifications();
      if (selectedCertId === id) {
        setActiveView("LIST");
        setSelectedCertId(null);
      }
    } catch (err: any) {
      alert("No se pudo eliminar: " + err.message);
    }
  };

  // KPIs
  const totalMontoObra = certifications
    .filter((c) => !c.partnerId && c.estado === "APROBADO")
    .reduce((sum, c) => sum + Number(c.montoTotal || 0), 0);

  const totalMontoSubcontratos = certifications
    .filter((c) => c.partnerId && c.estado === "APROBADO")
    .reduce((sum, c) => sum + Number(c.montoTotal || 0), 0);

  const countBorradores = certifications.filter(
    (c) => c.estado === "MEDICION_BORRADOR" || c.estado === "CERTIFICADO_BORRADOR"
  ).length;

  const countAprobadas = certifications.filter((c) => c.estado === "APROBADO").length;

  const selectedCertification = certifications.find((c) => c.id === selectedCertId);

  // Render según vista activa
  if (activeView === "CREATE") {
    return (
      <MeasurementForm
        projects={projects}
        partners={partners}
        initialProjectId={selectedProjectId}
        onSuccess={(newId) => {
          loadCertifications();
          setSelectedCertId(newId);
          setActiveView("PREVIEW");
        }}
        onCancel={() => setActiveView("LIST")}
      />
    );
  }

  if (activeView === "PREVIEW" && selectedCertification) {
    return (
      <CertificateExcelPreview
        certification={selectedCertification}
        onBack={() => setActiveView("LIST")}
        onRefresh={() => {
          loadCertifications();
        }}
        onNavigateToInvoice={onNavigateToInvoice}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold text-blue-600 uppercase tracking-widest block">
            Módulo Oficial de Ingeniería & Finanzas
          </span>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2 mt-0.5">
            Mediciones, Certificaciones Avanzadas e Integración Contable
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Gestión de ciclo completo: Medición en campo ➔ Cómputos auxiliares ➔ Planilla financiera estricta ➔ Facturación automática Three-Way Match.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView("CREATE")}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nueva Medición de Campo
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Certificado al Cliente (Aprobado)
          </span>
          <div className="text-lg font-black text-slate-900 mt-1 font-mono">
            {totalMontoObra.toLocaleString("es-PY")} Gs.
          </div>
          <span className="text-[11px] text-blue-600 font-semibold mt-1 block">
            Cuentas por Cobrar generadas
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Certificado a Subcontratistas
          </span>
          <div className="text-lg font-black text-emerald-700 mt-1 font-mono">
            {totalMontoSubcontratos.toLocaleString("es-PY")} Gs.
          </div>
          <span className="text-[11px] text-emerald-700 font-semibold mt-1 block">
            Three-Way Match 100% validado
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Mediciones en Proceso
          </span>
          <div className="text-lg font-black text-amber-600 mt-1 font-mono">
            {countBorradores} pendientes
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Borradores y cálculos auxiliares
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Certificados Aprobados
          </span>
          <div className="text-lg font-black text-blue-700 mt-1 font-mono">
            {countAprobadas} aprobados
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Con facturación fiscal enlazada
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Obra */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <Building2 className="w-4 h-4 text-slate-400" />
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(Number(e.target.value))}
              className="text-xs rounded-lg border border-slate-300 p-2 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>

          {/* Tipo / Beneficiario */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={filterPartnerId}
              onChange={(e) => setFilterPartnerId(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 p-2 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Todos los Destinatarios</option>
              <option value="CLIENT">Certificaciones al Cliente (Obra)</option>
              {partners
                .filter((p) => p.kind === "SUBCONTRACTOR" || p.kind === "BOTH")
                .map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    Subc: {s.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Estado */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 p-2 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Todos los Estados</option>
              <option value="MEDICION_BORRADOR">Medición Borrador</option>
              <option value="CERTIFICADO_BORRADOR">Certificado Borrador</option>
              <option value="APROBADO">Aprobado / Facturado</option>
            </select>
          </div>
        </div>

        <span className="text-xs text-slate-500">
          Mostrando {certifications.length} {certifications.length === 1 ? "registro" : "registros"}
        </span>
      </div>

      {/* List of Certifications */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4 w-28">N° Registro</th>
                <th className="py-3.5 px-3 w-32">Fecha Corte</th>
                <th className="py-3.5 px-3 min-w-[200px]">Tipo y Destinatario</th>
                <th className="py-3.5 px-3 w-32 text-center">Rubros / Evidencia</th>
                <th className="py-3.5 px-3 text-right w-36">Monto Total</th>
                <th className="py-3.5 px-3 w-36 text-center">Estado</th>
                <th className="py-3.5 px-3 w-40 text-center">Factura Three-Way Match</th>
                <th className="py-3.5 px-4 text-center w-28">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Cargando historial de certificaciones...
                  </td>
                </tr>
              ) : certifications.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileSpreadsheet className="w-8 h-8 text-slate-300" />
                      <p className="font-semibold text-slate-700">No hay certificaciones registradas en esta obra</p>
                      <button
                        onClick={() => setActiveView("CREATE")}
                        className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                      >
                        + Crear la primera medición de campo
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                certifications.map((c) => {
                  const isSubcontractor = Boolean(c.partnerId);
                  const isApproved = c.estado === "APROBADO";
                  const isCertDraft = c.estado === "CERTIFICADO_BORRADOR";
                  const linkedInvoice = c.invoices && c.invoices.length > 0 ? c.invoices[0] : null;

                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        setSelectedCertId(c.id);
                        setActiveView("PREVIEW");
                      }}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-sm">
                            N° {String(c.numero).padStart(2, "0")}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 font-medium text-slate-600">
                        {new Date(c.fecha).toLocaleDateString("es-PY")}
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-800">
                          {isSubcontractor ? c.partner?.name : "Certificación de Obra al Cliente"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {isSubcontractor ? (
                            <span className="text-emerald-700 font-medium">Subcontratista (Cuentas por Pagar)</span>
                          ) : (
                            <span className="text-blue-700 font-medium">{c.project?.clientName || "MOPC"} (Cuentas por Cobrar)</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-center">
                        <span className="text-slate-700 font-medium">
                          {c.items?.length || 0} rubros
                        </span>
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900 text-sm">
                        {Number(c.montoTotal || 0).toLocaleString("es-PY")} Gs.
                      </td>

                      <td className="py-3.5 px-3 text-center">
                        {isApproved ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> APROBADO
                          </span>
                        ) : isCertDraft ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                            <FileText className="w-3 h-3" /> CERTIFICADO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                            <Layers className="w-3 h-3" /> MEDICIÓN
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-center">
                        {linkedInvoice ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="font-mono text-emerald-800 font-bold text-[11px] bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-sm">
                              {linkedInvoice.numeroFactura}
                            </span>
                            <span className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                              Match 100% Validado
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Pendiente de Aprobación</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCertId(c.id);
                              setActiveView("PREVIEW");
                            }}
                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="Ver Previsualización y Planilla Excel"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {!isApproved && (
                            <button
                              type="button"
                              onClick={(e) => handleDelete(c.id, e)}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title="Eliminar borrador"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
