import React, { useState } from "react";
import {
  FileCheck,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ShieldCheck,
  CreditCard,
  Building2,
  Layers,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Users,
} from "lucide-react";
import {
  SubcontractorContract,
  SubcontractCertificate,
  Partner,
  BudgetItem,
  Project,
} from "../types";
import { formatMoney, formatDate, formatPercent } from "../utils/format";
import { getStatusBadge } from "../utils/statusBadges";
import { api } from "../api";
import { SubcontractorsScheduleTab } from "./SubcontractorsScheduleTab";

interface SubcontractsTabProps {
  project?: Project | null;
  subcontracts: SubcontractorContract[];
  partners: Partner[];
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  openNewModalByDefault?: boolean;
}

export const SubcontractsTab: React.FC<SubcontractsTabProps> = ({
  project,
  subcontracts,
  partners,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  openNewModalByDefault = false,
}) => {
  const [subcontractsSubTab, setSubcontractsSubTab] = useState<"contratos" | "calendario">("contratos");
  const [searchTerm, setSearchTerm] = useState("");
  const [showContractModal, setShowContractModal] = useState(openNewModalByDefault);
  const [showCertModal, setShowCertModal] = useState(false);
  const [selectedContractForCert, setSelectedContractForCert] = useState<SubcontractorContract | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedContractId, setExpandedContractId] = useState<number | null>(null);

  // New Contract form state
  const [contractForm, setContractForm] = useState({
    partnerId: partners.find((p) => p.kind === "SUBCONTRACTOR" || p.kind === "BOTH")?.id || partners[0]?.id || 1,
    budgetItemId: budgetItems[0]?.id || 1,
    description: "",
    contractAmount: 500000000,
    startDate: "",
    endDate: "",
  });

  // New Certificate form state
  const [certForm, setCertForm] = useState({
    amount: 100000000,
    advancePercentage: 10,
    notes: "",
    periodFrom: "",
    periodTo: "",
  });

  const subcontractorPartners = partners.filter(
    (p) => p.kind === "SUBCONTRACTOR" || p.kind === "BOTH"
  );

  const filteredContracts = subcontracts.filter((sc) => {
    const matchesSearch =
      sc.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sc.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (sc.partner?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const totalContracted = subcontracts.reduce((acc, sc) => acc + Number(sc.contractAmount || 0), 0);
  const totalCertified = subcontracts.reduce((acc, sc) => acc + Number(sc.certifiedAmount || 0), 0);
  const totalPaid = subcontracts.reduce((acc, sc) => {
    const certs = sc.certificates || [];
    const paidCerts = certs.filter((c) => c.status === "RECIBIDO" || (c as any).status === "PAGADO");
    return acc + paidCerts.reduce((cAcc, c) => cAcc + Number(c.amount || 0), 0);
  }, 0);

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project?.id) {
      showToast("Selecciona una obra válida", "error");
      return;
    }
    if (!contractForm.description.trim()) {
      showToast("Ingresa la descripción o alcance del subcontrato", "error");
      return;
    }

    setSubmitting(true);
    try {
      await api.createSubcontract({
        projectId: project.id,
        partnerId: Number(contractForm.partnerId),
        budgetItemId: Number(contractForm.budgetItemId),
        description: contractForm.description,
        contractAmount: Number(contractForm.contractAmount),
        startDate: contractForm.startDate || undefined,
        endDate: contractForm.endDate || undefined,
      });
      showToast("Subcontrato registrado exitosamente");
      setShowContractModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al registrar subcontrato", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContractForCert) return;

    setSubmitting(true);
    try {
      await api.createSubcontractCertificate({
        subcontractId: selectedContractForCert.id,
        amount: Number(certForm.amount),
        advancePercentage: Number(certForm.advancePercentage),
        notes: certForm.notes,
        periodFrom: certForm.periodFrom || new Date().toISOString(),
        periodTo: certForm.periodTo || new Date().toISOString(),
        physicalProgressPct: Number(certForm.advancePercentage),
      });
      showToast("Certificado de avance emitido exitosamente");
      setShowCertModal(false);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al emitir certificado", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCertify = async (certId: number) => {
    try {
      await api.certifySubcontractCertificate(certId);
      showToast("Certificado validado y computado");
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al certificar", "error");
    }
  };

  const handleApproveCert = async (certId: number) => {
    try {
      await api.approveSubcontractCertificate(certId);
      showToast("Certificado aprobado para pago");
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al aprobar certificado", "error");
    }
  };

  const handlePayCert = async (certId: number) => {
    try {
      await api.paySubcontractCertificate(certId);
      showToast("Pago de certificado registrado");
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al pagar certificado", "error");
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-purple-600" />
            <h1 className="text-xl font-bold text-stone-900 font-display">
              Subcontratos & Certificados de Avance Físico
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Gestión de empresas subcontratistas, medición de avances en tramo vial y retenciones de garantía de obra.
          </p>
        </div>

        <button
          id="btn-open-new-subcontract-modal"
          onClick={() => setShowContractModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Subcontrato</span>
        </button>
      </div>

      {/* Subnav Pills for Subcontracts */}
      <div className="bg-white border border-slate-200 p-2 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setSubcontractsSubTab("contratos")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              subcontractsSubTab === "contratos"
                ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <FileCheck className="w-4 h-4 text-blue-600" />
            <span>Contratos de Obra ({subcontracts.length})</span>
          </button>

          <button
            onClick={() => setSubcontractsSubTab("calendario")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              subcontractsSubTab === "calendario"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Calendario Automatizado & Subcontratistas</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
              Auto
            </span>
          </button>
        </div>
      </div>

      {subcontractsSubTab === "calendario" ? (
        <SubcontractorsScheduleTab
          partners={partners}
          subcontracts={subcontracts}
          budgetItems={budgetItems}
          currency={currency}
          onRefresh={onRefresh}
          showToast={showToast}
          onSelectSubcontractForCert={(contract) => {
            setSelectedContractForCert(contract);
            setShowCertModal(true);
          }}
        />
      ) : (
        <>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Total Subcontratado
          </span>
          <div className="mt-1 font-mono text-lg font-extrabold text-stone-900">
            {formatMoney(totalContracted, currency)}
          </div>
          <div className="mt-1 text-[11px] text-stone-500">{subcontracts.length} contratos activos</div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
            Avance Físico Certificado
          </span>
          <div className="mt-1 font-mono text-lg font-extrabold text-purple-900">
            {formatMoney(totalCertified, currency)}
          </div>
          <div className="mt-1 text-[11px] text-purple-700 font-mono font-semibold">
            {totalContracted > 0 ? ((totalCertified / totalContracted) * 100).toFixed(1) : 0}% de avance
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            Monto Pagado / Abonado
          </span>
          <div className="mt-1 font-mono text-lg font-extrabold text-emerald-900">
            {formatMoney(totalPaid, currency)}
          </div>
          <div className="mt-1 text-[11px] text-stone-500">Liquidación en fecha</div>
        </div>
      </div>

      {/* Search Input */}
      <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por N° de contrato, empresa subcontratista o descripción de tareas..."
            className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-xs outline-none focus:border-purple-500 transition"
          />
        </div>
      </div>

      {/* Subcontracts Accordion / Table */}
      <div className="space-y-4">
        {filteredContracts.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-stone-400 text-xs shadow-sm">
            No hay subcontratos registrados para esta obra vial.
          </div>
        ) : (
          filteredContracts.map((sc) => {
            const contractAmt = Number(sc.contractAmount || 0);
            const certifiedAmt = Number(sc.certifiedAmount || 0);
            const remaining = Math.max(0, contractAmt - certifiedAmt);
            const progressPct = contractAmt > 0 ? (certifiedAmt / contractAmt) * 100 : 0;
            const certificates = sc.certificates || [];
            const isExpanded = expandedContractId === sc.id;

            return (
              <div
                key={sc.id}
                className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden"
              >
                {/* Contract Summary Header */}
                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-stone-50/50">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center font-bold text-xs shrink-0">
                      SC
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-stone-900 text-sm">
                          {sc.number}
                        </span>
                        <span className="font-bold text-stone-800">{sc.partner?.name}</span>
                        {getStatusBadge(sc.status)}
                      </div>
                      <p className="text-xs text-stone-600 mt-0.5">{sc.description}</p>
                      <div className="flex items-center gap-4 text-[11px] text-stone-500 mt-1">
                        <span>
                          Partida: <strong className="font-mono text-stone-700">{sc.budgetItem?.code}</strong>
                        </span>
                        {sc.startDate && (
                          <span>
                            Plazo: {formatDate(sc.startDate)} a {formatDate(sc.endDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Financial Counters & Actions */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-stone-400">
                        Monto Contratado
                      </div>
                      <div className="font-mono font-bold text-stone-900 text-sm">
                        {formatMoney(contractAmt, currency)}
                      </div>
                      <div className="text-[10px] text-stone-500 font-mono">
                        Certificado: {formatMoney(certifiedAmt, currency)} ({progressPct.toFixed(1)}%)
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedContractForCert(sc);
                          const rem = Math.max(0, Number(sc.contractAmount) - Number(sc.certifiedAmount));
                          setCertForm({
                            amount: Math.min(rem, 50000000),
                            advancePercentage: 15,
                            notes: "",
                            periodFrom: new Date().toISOString().slice(0, 10),
                            periodTo: new Date().toISOString().slice(0, 10),
                          });
                          setShowCertModal(true);
                        }}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-xs transition flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Emitir Certificado</span>
                      </button>

                      <button
                        onClick={() => setExpandedContractId(isExpanded ? null : sc.id)}
                        className="p-1.5 border border-stone-200 hover:bg-stone-100 rounded-lg text-stone-600 transition"
                        title={isExpanded ? "Ocultar certificados" : "Ver certificados"}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-stone-200 h-1.5">
                  <div
                    className="bg-purple-600 h-1.5 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(1, progressPct))}%` }}
                  />
                </div>

                {/* Expanded Certificates List */}
                {isExpanded && (
                  <div className="p-4 border-t border-stone-200 bg-white">
                    <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">
                      Certificados de Avance del Contrato ({certificates.length})
                    </h4>
                    {certificates.length === 0 ? (
                      <p className="text-xs text-stone-400 py-3 text-center">
                        No hay certificados emitidos para este subcontrato.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                            <tr>
                              <th className="p-2.5">N° Certificado</th>
                              <th className="p-2.5">Fecha Emisión</th>
                              <th className="p-2.5">% Avance</th>
                              <th className="p-2.5 text-right">Monto Bruto</th>
                              <th className="p-2.5 text-center">Estado</th>
                              <th className="p-2.5 text-right">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {certificates.map((cert) => (
                              <tr key={cert.id} className="hover:bg-stone-50 transition">
                                <td className="p-2.5 font-mono font-bold text-stone-900">
                                  {cert.number}
                                </td>
                                <td className="p-2.5 text-stone-500">
                                  {formatDate(cert.issueDate || (cert as any).createdAt)}
                                </td>
                                <td className="p-2.5 font-mono text-purple-700 font-semibold">
                                  {cert.advancePercentage || (cert as any).physicalProgressPct || 0}%
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold text-stone-900">
                                  {formatMoney(cert.amount, currency)}
                                </td>
                                <td className="p-2.5 text-center">
                                  {getStatusBadge(cert.status)}
                                </td>
                                <td className="p-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {cert.status === "BORRADOR" && (
                                      <button
                                        onClick={() => handleCertify(cert.id)}
                                        className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-[10px] font-semibold transition"
                                      >
                                        Certificar
                                      </button>
                                    )}
                                    {((cert.status as any) === "CERTIFICADO" || cert.status === "APROBADO_PARA_COMPRA") && (
                                      <button
                                        onClick={() => handleApproveCert(cert.id)}
                                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-semibold transition"
                                      >
                                        Aprobar
                                      </button>
                                    )}
                                    {((cert.status as any) === "APROBADO" || (cert.status as any) === "APROBADO_PARA_COMPRA" || cert.status === "EMITIDA") && (
                                      <button
                                        onClick={() => handlePayCert(cert.id)}
                                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-semibold transition"
                                      >
                                        Pagar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  )}

      {/* New Subcontract Modal */}
      {showContractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-stone-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-bold text-stone-900">
                  Nuevo Subcontrato de Obra
                </h3>
              </div>
              <button
                onClick={() => setShowContractModal(false)}
                className="text-stone-400 hover:text-stone-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateContract} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Empresa Subcontratista
                </label>
                <select
                  value={contractForm.partnerId}
                  onChange={(e) => setContractForm({ ...contractForm, partnerId: Number(e.target.value) })}
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs font-medium bg-white"
                >
                  {subcontractorPartners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (RUC: {p.taxId})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Partida Presupuestaria Imputada
                </label>
                <select
                  value={contractForm.budgetItemId}
                  onChange={(e) => setContractForm({ ...contractForm, budgetItemId: Number(e.target.value) })}
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs font-medium bg-white"
                >
                  {budgetItems.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Alcance / Objeto del Subcontrato
                </label>
                <textarea
                  rows={2}
                  value={contractForm.description}
                  onChange={(e) => setContractForm({ ...contractForm, description: e.target.value })}
                  placeholder="Ej: Colocación de carpeta asfáltica en caliente e=5cm tramo Km 132 a Km 140..."
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Monto Total del Contrato
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={contractForm.contractAmount}
                  onChange={(e) => setContractForm({ ...contractForm, contractAmount: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha de Inicio
                  </label>
                  <input
                    type="date"
                    value={contractForm.startDate}
                    onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha de Culminación
                  </label>
                  <input
                    type="date"
                    value={contractForm.endDate}
                    onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowContractModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold hover:bg-stone-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {submitting ? "Creando..." : "Registrar Subcontrato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Certificate Modal */}
      {showCertModal && selectedContractForCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-stone-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-bold text-stone-900">
                  Emitir Certificado de Avance
                </h3>
              </div>
              <button
                onClick={() => setShowCertModal(false)}
                className="text-stone-400 hover:text-stone-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCertificate} className="mt-4 space-y-4">
              <div className="p-3 bg-purple-50 rounded-lg border border-purple-200 text-xs">
                <div className="font-semibold text-purple-900">Contrato:</div>
                <div className="font-bold text-purple-950 mt-0.5">
                  {selectedContractForCert.number} — {selectedContractForCert.partner?.name}
                </div>
                <div className="mt-1 text-[11px] text-purple-800 flex items-center justify-between">
                  <span>Monto Total: {formatMoney(selectedContractForCert.contractAmount, currency)}</span>
                  <span>
                    Saldo:{" "}
                    <strong>
                      {formatMoney(
                        Math.max(
                          0,
                          Number(selectedContractForCert.contractAmount) -
                            Number(selectedContractForCert.certifiedAmount)
                        ),
                        currency
                      )}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Monto a Certificar
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={certForm.amount}
                    onChange={(e) => setCertForm({ ...certForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    % Avance Físico Medido
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={certForm.advancePercentage}
                    onChange={(e) =>
                      setCertForm({ ...certForm, advancePercentage: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Periodo Desde
                  </label>
                  <input
                    type="date"
                    value={certForm.periodFrom}
                    onChange={(e) => setCertForm({ ...certForm, periodFrom: e.target.value })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Periodo Hasta
                  </label>
                  <input
                    type="date"
                    value={certForm.periodTo}
                    onChange={(e) => setCertForm({ ...certForm, periodTo: e.target.value })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Notas de Fiscalización / Medición
                </label>
                <textarea
                  rows={2}
                  value={certForm.notes}
                  onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })}
                  placeholder="Medición conjunta con supervisión MOPC..."
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowCertModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold hover:bg-stone-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {submitting ? "Emitiendo..." : "Emitir Certificado"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
