import React, { useState, useMemo } from "react";
import {
  FileCheck,
  ClipboardCheck,
  Users,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ArrowRight,
  Camera,
  Trash2,
  Building2,
  Layers,
  DollarSign,
  AlertCircle,
  Eye,
  Check,
  X,
  Printer,
  Sparkles,
  Send,
} from "lucide-react";
import {
  Project,
  BudgetItem,
  Partner,
  SubcontractorContract,
  SubcontractCertificate,
  Certificacion,
  WorkFront,
} from "../types";
import { formatMoney, formatDate, formatPercent, parseFlexibleNumber } from "../utils/format";
import { api } from "../api";
import { SubcontractsTab } from "./SubcontractsTab";
import { AdvancedCertificationsView } from "./certifications/AdvancedCertificationsView";

interface EjecucionCertificacionesTabProps {
  project?: Project | null;
  projects?: Project[];
  budgetItems: BudgetItem[];
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  workFronts?: WorkFront[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onNavigateToFinance?: () => void;
}

type SubSection =
  | "mediciones-certificaciones-avanzadas"
  | "actas-campo"
  | "subcontratistas"
  | "certificaciones-cliente";

export const EjecucionCertificacionesTab: React.FC<EjecucionCertificacionesTabProps> = ({
  project,
  projects = [],
  budgetItems,
  partners,
  subcontracts,
  workFronts = [],
  currency,
  onRefresh,
  showToast,
  onNavigateToFinance,
}) => {
  const [subSection, setSubSection] = useState<SubSection>("mediciones-certificaciones-avanzadas");

  const effectiveProjects = useMemo(() => {
    if (projects && projects.length > 0) return projects;
    if (project) return [project];
    return [];
  }, [projects, project]);

  // Local state for Actas de Medición de Campo
  const storageKeyActas = `infratrack_actas_campo_${project?.id || 0}`;
  const [actas, setActas] = useState<Certificacion[]>(() => {
    try {
      const saved = localStorage.getItem(storageKeyActas);
      if (saved) return JSON.parse(saved);
    } catch {}

    // Seed realistic field measurement acts
    return [
      {
        id: 101,
        projectId: project?.id || 1,
        budgetItemId: budgetItems[0]?.id || 1,
        rubro: budgetItems[0]?.name || "Excavación en zanjas para cimientos",
        unidad: budgetItems[0]?.unit || "m³",
        cantidad_medida: 145.5,
        monto_total: 18915000,
        estado: "APROBADA",
        evidencia: "https://images.unsplash.com/photo-1541888946425-d0fbb18615f3?w=600&auto=format&fit=crop&q=80",
        esAdenda: false,
        createdAt: "2026-09-15T14:30:00.000Z",
      },
      {
        id: 102,
        projectId: project?.id || 1,
        budgetItemId: budgetItems[1]?.id || 2,
        rubro: budgetItems[1]?.name || "Hormigón de limpieza y nivelación",
        unidad: budgetItems[1]?.unit || "m³",
        cantidad_medida: 42.0,
        monto_total: 29400000,
        estado: "EN_REVISION",
        esAdenda: false,
        createdAt: "2026-09-18T10:15:00.000Z",
      },
    ];
  });

  const saveActas = (newActas: Certificacion[]) => {
    setActas(newActas);
    try {
      localStorage.setItem(storageKeyActas, JSON.stringify(newActas));
    } catch {}
  };

  // Client Certifications (Cuentas por Cobrar al comitente)
  const storageKeyClientCerts = `infratrack_certs_cliente_${project?.id || 0}`;
  const [clientCerts, setClientCerts] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem(storageKeyClientCerts);
      if (saved) return JSON.parse(saved);
    } catch {}

    return [
      {
        id: 1,
        number: "CERT-OBRA-01",
        period: "Mes 1 - Trabajos Preliminares y Estructura",
        issueDate: "2026-08-31",
        fiscalStatus: "APROBADO_POR_FISCAL",
        grossAmount: 185000000,
        advanceAmortization: 18500000,
        retentionAmount: 9250000,
        netPayable: 157250000,
        notes: "Aprobado por el Fiscal de Obra del MOPC sin objeciones.",
      },
    ];
  });

  const saveClientCerts = (newCerts: any[]) => {
    setClientCerts(newCerts);
    try {
      localStorage.setItem(storageKeyClientCerts, JSON.stringify(newCerts));
    } catch {}
  };

  // Modal: Nueva Acta de Medición
  const [showNewActaModal, setShowNewActaModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>(
    budgetItems[0]?.id ? String(budgetItems[0].id) : ""
  );
  const [actaQty, setActaQty] = useState("");
  const [actaFront, setActaFront] = useState("");
  const [actaNotes, setActaNotes] = useState("");
  const [actaEvidence, setActaEvidence] = useState("");
  const [submittingActa, setSubmittingActa] = useState(false);

  // Modal: Nueva Certificación Cliente
  const [showNewClientCertModal, setShowNewClientCertModal] = useState(false);
  const [clientCertForm, setClientCertForm] = useState({
    number: `CERT-OBRA-0${clientCerts.length + 1}`,
    period: `Mes ${clientCerts.length + 1} - Avance de Obra`,
    grossAmount: 220000000,
    advanceRate: 10,
    retentionRate: 5,
    notes: "",
  });

  // Selected item for Acta modal
  const selectedItemForActa = budgetItems.find((b) => String(b.id) === selectedBudgetId);

  // Calculations
  const totalMedidoActas = actas.reduce((acc, a) => acc + Number(a.monto_total || 0), 0);
  const totalSubcontratosCertificado = subcontracts.reduce(
    (acc, sc) => acc + Number(sc.certifiedAmount || 0),
    0
  );
  const totalClienteCertificado = clientCerts.reduce((acc, c) => acc + Number(c.netPayable || 0), 0);

  const handleCreateActa = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForActa) {
      showToast("Selecciona un rubro válido", "error");
      return;
    }
    const q = parseFlexibleNumber(actaQty) || 0;
    if (q <= 0) {
      showToast("La cantidad medida debe ser mayor a cero", "error");
      return;
    }

    const unitPrice = Number(selectedItemForActa.unitPrice || 0);
    const monto = Math.round(q * unitPrice);

    const newActa: Certificacion = {
      id: Date.now(),
      projectId: project?.id || 1,
      budgetItemId: selectedItemForActa.id,
      rubro: selectedItemForActa.name,
      unidad: selectedItemForActa.unit || "un",
      cantidad_medida: q,
      monto_total: monto,
      estado: "EN_REVISION",
      evidencia: actaEvidence || undefined,
      esAdenda: false,
      createdAt: new Date().toISOString(),
      budgetItem: selectedItemForActa,
    };

    saveActas([newActa, ...actas]);
    setShowNewActaModal(false);
    setActaQty("");
    setActaNotes("");
    setActaEvidence("");
    showToast(`Acta de medición por ${q} ${selectedItemForActa.unit || "un"} generada`);
  };

  const handleApproveActa = (id: number) => {
    const updated = actas.map((a) => (a.id === id ? { ...a, estado: "APROBADA" as const } : a));
    saveActas(updated);
    showToast("Acta de medición aprobada oficialmente por fiscalización");
  };

  const handleCreateClientCert = (e: React.FormEvent) => {
    e.preventDefault();
    const gross = Number(clientCertForm.grossAmount) || 0;
    const adv = Math.round(gross * (clientCertForm.advanceRate / 100));
    const ret = Math.round(gross * (clientCertForm.retentionRate / 100));
    const net = gross - adv - ret;

    const newCert = {
      id: Date.now(),
      number: clientCertForm.number,
      period: clientCertForm.period,
      issueDate: new Date().toISOString().split("T")[0],
      fiscalStatus: "PRESENTADO_POR_OBRA",
      grossAmount: gross,
      advanceAmortization: adv,
      retentionAmount: ret,
      netPayable: net,
      notes: clientCertForm.notes,
    };

    saveClientCerts([newCert, ...clientCerts]);
    setShowNewClientCertModal(false);
    showToast(`Certificación ${newCert.number} emitida y enviada a revisión fiscal`);
  };

  return (
    <div className="space-y-6 pb-12 text-slate-800">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Ejecución y Certificaciones de Obra
              </h1>
              <p className="text-xs text-slate-500">
                Gestión operativa de actas de medición de campo, certificaciones a subcontratistas y certificados al cliente.
              </p>
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="flex items-center gap-2">
          {subSection === "actas-campo" && (
            <button
              onClick={() => setShowNewActaModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Nueva Acta de Medición</span>
            </button>
          )}

          {subSection === "certificaciones-cliente" && (
            <button
              onClick={() => setShowNewClientCertModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Emitir Certificado al Cliente</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Actas de Medición de Campo
          </span>
          <p className="text-xl font-extrabold text-blue-700 font-mono">
            {formatMoney(totalMedidoActas, currency)}
          </p>
          <p className="text-[11px] text-slate-500">{actas.length} actas levantadas en pista</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Certificados Subcontratistas (Cuentas por Pagar)
          </span>
          <p className="text-xl font-extrabold text-purple-700 font-mono">
            {formatMoney(totalSubcontratosCertificado, currency)}
          </p>
          <p className="text-[11px] text-slate-500">{subcontracts.length} contratos activos</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Certificados al Cliente (Cuentas por Cobrar)
          </span>
          <p className="text-xl font-extrabold text-emerald-700 font-mono">
            {formatMoney(totalClienteCertificado, currency)}
          </p>
          <p className="text-[11px] text-slate-500">Monto neto acumulado por cobrar</p>
        </div>
      </div>

      {/* Subnav Pills */}
      <div className="bg-white border border-slate-200 p-2 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSubSection("mediciones-certificaciones-avanzadas")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              subSection === "mediciones-certificaciones-avanzadas"
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <FileCheck className="w-4 h-4 text-emerald-400" />
            <span>Mediciones y Certificaciones Avanzadas</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500 text-white">
              PRD PRO
            </span>
          </button>

          <button
            onClick={() => setSubSection("actas-campo")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subSection === "actas-campo"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Actas de Campo Básicas</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
              {actas.length}
            </span>
          </button>

          <button
            onClick={() => setSubSection("subcontratistas")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subSection === "subcontratistas"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Certificaciones a Subcontratistas (Cuentas por Pagar)</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
              {subcontracts.length}
            </span>
          </button>

          <button
            onClick={() => setSubSection("certificaciones-cliente")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              subSection === "certificaciones-cliente"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Certificaciones al Cliente (Cuentas por Cobrar)</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              {clientCerts.length}
            </span>
          </button>
        </div>
      </div>

      {/* VIEW 0: MEDICIONES Y CERTIFICACIONES AVANZADAS (PRD PRO) */}
      {subSection === "mediciones-certificaciones-avanzadas" && (
        <AdvancedCertificationsView
          projects={effectiveProjects}
          partners={partners}
          selectedProjectId={project?.id}
          onNavigateToInvoice={() => onNavigateToFinance?.()}
        />
      )}

      {/* VIEW 1: ACTAS DE MEDICION DE CAMPO */}
      {subSection === "actas-campo" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex items-start gap-3">
            <ClipboardCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-blue-900">Actas de Medición de Campo:</strong> Registro in-situ del avance físico
              de cada rubro. Las cantidades medidas son validadas contra el cómputo contractual antes de ser aprobadas
              por el fiscal de obras.
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">FECHA</th>
                    <th className="p-3">RUBRO MEDIDO</th>
                    <th className="p-3 text-center">UNIDAD</th>
                    <th className="p-3 text-right">CANTIDAD MEDIDA</th>
                    <th className="p-3 text-right">MONTO CALCULADO</th>
                    <th className="p-3 text-center">EVIDENCIA</th>
                    <th className="p-3 text-center">ESTADO</th>
                    <th className="p-3 text-center">ACCIÓN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {actas.map((acta) => (
                    <tr key={acta.id} className="hover:bg-slate-50 transition">
                      <td className="p-3 font-mono text-slate-700">
                        {formatDate(acta.createdAt || "2026-09-18")}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{acta.rubro}</div>
                      </td>
                      <td className="p-3 text-center font-mono text-slate-500">{acta.unidad || "un"}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-800">
                        {Number(acta.cantidad_medida).toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono font-extrabold text-blue-700">
                        {formatMoney(acta.monto_total, currency)}
                      </td>
                      <td className="p-3 text-center">
                        {acta.evidencia ? (
                          <a
                            href={acta.evidencia}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Ver Foto</span>
                          </a>
                        ) : (
                          <span className="text-slate-400 text-[10px]">Sin foto</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            acta.estado === "APROBADA"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {acta.estado}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {acta.estado !== "APROBADA" ? (
                          <button
                            onClick={() => handleApproveActa(acta.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs cursor-pointer"
                          >
                            Aprobar
                          </button>
                        ) : (
                          <span className="text-emerald-700 font-semibold text-[11px]">Validada</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: CERTIFICACIONES A SUBCONTRATISTAS */}
      {subSection === "subcontratistas" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 flex items-start justify-between gap-4">
            <div className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-purple-900">Certificaciones a Subcontratistas:</strong> Control de contratos de
              mano de obra y servicios especializados. Emite certificados parciales de avance que luego se transforman en
              facturas por pagar en <strong>Contabilidad y Finanzas</strong>.
            </div>
            {onNavigateToFinance && (
              <button
                onClick={onNavigateToFinance}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-purple-200 text-purple-700 hover:bg-purple-50 text-xs font-bold transition cursor-pointer"
              >
                <span>Ver Cuentas por Pagar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <SubcontractsTab
            project={project}
            subcontracts={subcontracts}
            partners={partners}
            budgetItems={budgetItems}
            currency={currency}
            onRefresh={onRefresh}
            showToast={showToast}
          />
        </div>
      )}

      {/* VIEW 3: CERTIFICACIONES AL CLIENTE */}
      {subSection === "certificaciones-cliente" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-start justify-between gap-4">
            <div className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-emerald-900">Certificaciones Oficiales al Cliente:</strong> Aquí se emiten los
              certificados mensuales presentados a la fiscalización del contratante (ej. MOPC, Itaipú). Cada certificado
              descuenta la amortización de anticipo y la retención del 5% de fondo de reparo.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {clientCerts.map((cert) => (
              <div
                key={cert.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold text-xs">
                      {cert.number}
                    </span>
                    <span className="text-sm font-bold text-slate-900">{cert.period}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                      {cert.fiscalStatus}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <div>
                      Fecha Emisión: <strong className="text-slate-800">{formatDate(cert.issueDate)}</strong>
                    </div>
                    <div>
                      Cliente:{" "}
                      <strong className="text-slate-800">{project?.clientName || "MOPC"}</strong>
                    </div>
                    <div>
                      Contrato N°:{" "}
                      <strong className="text-slate-800">{project?.contractNumber || "CT-2026/89"}</strong>
                    </div>
                  </div>

                  {cert.notes && <p className="text-xs text-slate-600 italic">{cert.notes}</p>}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-6 border-t sm:border-t-0 sm:border-l border-slate-200 pt-3 sm:pt-0 sm:pl-6 shrink-0">
                  <div className="space-y-1 text-right">
                    <div className="text-[11px] text-slate-400">
                      Monto Bruto: {formatMoney(cert.grossAmount, currency)}
                    </div>
                    <div className="text-[11px] text-rose-500">
                      - Anticipo (10%): -{formatMoney(cert.advanceAmortization, currency)}
                    </div>
                    <div className="text-[11px] text-amber-600">
                      - Fondo Reparo (5%): -{formatMoney(cert.retentionAmount, currency)}
                    </div>
                    <div className="text-base font-mono font-extrabold text-emerald-700 pt-1 border-t border-slate-100">
                      Líquido a Cobrar: {formatMoney(cert.netPayable, currency)}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (onNavigateToFinance) {
                        onNavigateToFinance();
                      } else {
                        showToast("Certificado listo para cobrar en Contabilidad & Finanzas");
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>Ir a Cobranzas</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: NUEVA ACTA DE MEDICION */}
      {showNewActaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowNewActaModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Nueva Acta de Medición de Campo</h3>
            </div>

            <form onSubmit={handleCreateActa} className="space-y-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Rubro del Centro de Costos a Medir *
                </label>
                <select
                  required
                  value={selectedBudgetId}
                  onChange={(e) => setSelectedBudgetId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium"
                >
                  {budgetItems.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.code}] {b.name} ({b.unit || "un"}) - PU: {formatMoney(Number(b.unitPrice || 0), currency)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedItemForActa && (
                <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center justify-between text-slate-700 font-mono">
                  <span>Cómputo Total Contractual:</span>
                  <span className="font-bold">
                    {Number(selectedItemForActa.totalQuantity || 1).toLocaleString()}{" "}
                    {selectedItemForActa.unit || "un"}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Cantidad Medida ({selectedItemForActa?.unit || "un"}) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. 25.5"
                    value={actaQty}
                    onChange={(e) => setActaQty(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Frente de Trabajo</label>
                  <input
                    type="text"
                    placeholder="Ej. Bloque 2 - Pista Sur"
                    value={actaFront}
                    onChange={(e) => setActaFront(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">URL de Evidencia Fotográfica / Acta</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={actaEvidence}
                  onChange={(e) => setActaEvidence(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Observaciones Técnicas</label>
                <textarea
                  rows={2}
                  placeholder="Detalles de cotas, progresivas o ensayos de probeta..."
                  value={actaNotes}
                  onChange={(e) => setActaNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewActaModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingActa}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  {submittingActa ? "Registrando..." : "Registrar Acta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA CERTIFICACION CLIENTE */}
      {showNewClientCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative text-xs">
            <button
              onClick={() => setShowNewClientCertModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">Emitir Certificación al Cliente</h3>
            </div>

            <form onSubmit={handleCreateClientCert} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">N° de Certificado *</label>
                  <input
                    type="text"
                    required
                    value={clientCertForm.number}
                    onChange={(e) => setClientCertForm({ ...clientCertForm, number: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Período Certificado</label>
                  <input
                    type="text"
                    value={clientCertForm.period}
                    onChange={(e) => setClientCertForm({ ...clientCertForm, period: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Monto Bruto Certificado ({currency}) *</label>
                <input
                  type="number"
                  required
                  value={clientCertForm.grossAmount}
                  onChange={(e) =>
                    setClientCertForm({ ...clientCertForm, grossAmount: Number(e.target.value) })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-base"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Amortización Anticipo %</label>
                  <input
                    type="number"
                    value={clientCertForm.advanceRate}
                    onChange={(e) =>
                      setClientCertForm({ ...clientCertForm, advanceRate: Number(e.target.value) })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fondo de Reparo %</label>
                  <input
                    type="number"
                    value={clientCertForm.retentionRate}
                    onChange={(e) =>
                      setClientCertForm({ ...clientCertForm, retentionRate: Number(e.target.value) })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notas para la Fiscalización</label>
                <textarea
                  rows={2}
                  value={clientCertForm.notes}
                  onChange={(e) => setClientCertForm({ ...clientCertForm, notes: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewClientCertModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  Emitir Certificado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
