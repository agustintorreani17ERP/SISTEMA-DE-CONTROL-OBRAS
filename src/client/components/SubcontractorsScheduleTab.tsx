import React, { useState, useMemo } from "react";
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Filter,
  Users,
  Building2,
  FileCheck,
  Edit2,
  Trash2,
  X,
  Phone,
  Mail,
  ArrowRight,
  ChevronRight,
  Sparkles,
  UserX,
  UserCheck,
  History,
  DollarSign,
  Briefcase,
} from "lucide-react";
import { Partner, SubcontractorContract, BudgetItem } from "../types";
import { api } from "../api";
import { formatMoney } from "../utils/format";

interface SubcontractorsScheduleTabProps {
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onSelectSubcontractForCert?: (contract: SubcontractorContract) => void;
}

export type Frequency = "QUINCENAL" | "SEMANAL" | "CADA_SEMANA" | "MENSUAL";

export interface SubcontractorMeta {
  partner: Partner;
  frequency: Frequency;
  cutOffRule: string;
  contracts: SubcontractorContract[];
  certifiesThisWeek: boolean;
  nextCutoffDate: string;
  statusThisWeek: "PENDIENTE" | "CERTIFICADO" | "NO_CORRESPONDE";
  totalContractedAmount: number;
  totalCertifiedAmount: number;
  isActive: boolean;
}

export const SubcontractorsScheduleTab: React.FC<SubcontractorsScheduleTabProps> = ({
  partners,
  subcontracts,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  onSelectSubcontractForCert,
}) => {
  const [activeSubView, setActiveSubView] = useState<"calendario" | "lista">("calendario");
  const [searchQuery, setSearchQuery] = useState("");
  const [frequencyFilter, setFrequencyFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // CRUD modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [partnerToToggleStatus, setPartnerToToggleStatus] = useState<Partner | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formState, setFormState] = useState({
    name: "",
    taxId: "",
    specialization: "OBRA CIVIL",
    frequency: "QUINCENAL" as Frequency,
    cutOffRule: "Días 15 y 30 de cada mes",
    phone: "",
    email: "",
    fiscalAddress: "",
  });

  const subcontractorPartners = useMemo(() => {
    return partners.filter((p) => p.kind === "SUBCONTRACTOR" || p.kind === "BOTH");
  }, [partners]);

  // Automated Schedule Calculation
  const scheduleData: SubcontractorMeta[] = useMemo(() => {
    const today = new Date();
    const dayOfMonth = today.getDate();
    const dayOfWeek = today.getDay(); // 0 = Sun, 5 = Fri

    return subcontractorPartners.map((p) => {
      // Decode frequency from classification or default
      let frequency: Frequency = "QUINCENAL";
      let cutOffRule = "Días 15 y 30 de cada mes";

      const classText = (p.classification || "").toUpperCase();
      if (classText.includes("SEMANAL") || classText.includes("SEMANA")) {
        frequency = "SEMANAL";
        cutOffRule = "Viernes de cada semana";
      } else if (classText.includes("MENSUAL")) {
        frequency = "MENSUAL";
        cutOffRule = "Fin de mes (último día hábil)";
      }

      const pContracts = subcontracts.filter((sc) => sc.partnerId === p.id);

      // Financial history records
      const totalContractedAmount = pContracts.reduce(
        (acc, c) => acc + Number((c as any).totalAmount || c.contractAmount || 0),
        0
      );
      const totalCertifiedAmount = pContracts.reduce((acc, c) => {
        const certSum = (c.certificates || []).reduce(
          (cAcc, cert) => cAcc + Number((cert as any).totalAmount || cert.amount || 0),
          0
        );
        return acc + certSum;
      }, 0);

      const isActive = (p as any).active !== false;

      // Automated evaluation of who certifies this week
      let certifiesThisWeek = false;
      let nextCutoffDate = "";

      if (!isActive) {
        certifiesThisWeek = false;
        nextCutoffDate = "Dado de baja (inactivo)";
      } else if ((frequency as string) === "SEMANAL" || (frequency as string) === "CADA_SEMANA") {
        certifiesThisWeek = true;
        const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
        const friday = new Date(today);
        friday.setDate(today.getDate() + daysUntilFriday);
        nextCutoffDate = `Viernes ${friday.getDate()}/${friday.getMonth() + 1}`;
      } else if (frequency === "QUINCENAL") {
        if ((dayOfMonth >= 10 && dayOfMonth <= 17) || dayOfMonth >= 25 || dayOfMonth <= 2) {
          certifiesThisWeek = true;
        }
        if (dayOfMonth <= 15) {
          nextCutoffDate = `15/${today.getMonth() + 1}/${today.getFullYear()} (1ra Quincena)`;
        } else {
          nextCutoffDate = `30/${today.getMonth() + 1}/${today.getFullYear()} (2da Quincena)`;
        }
      } else {
        // Mensual
        if (dayOfMonth >= 25) {
          certifiesThisWeek = true;
        }
        nextCutoffDate = `Fin de mes (${today.getMonth() + 1}/${today.getFullYear()})`;
      }

      // Check if certificate exists this week
      const hasRecentCert = pContracts.some((sc) =>
        (sc.certificates || []).some((c) => {
          const cDate = new Date(c.issueDate || new Date());
          const diffDays = Math.abs((today.getTime() - cDate.getTime()) / (1000 * 3600 * 24));
          return diffDays <= 7;
        })
      );

      const statusThisWeek = certifiesThisWeek
        ? hasRecentCert
          ? "CERTIFICADO"
          : "PENDIENTE"
        : "NO_CORRESPONDE";

      return {
        partner: p,
        frequency,
        cutOffRule,
        contracts: pContracts,
        certifiesThisWeek,
        nextCutoffDate,
        statusThisWeek,
        totalContractedAmount,
        totalCertifiedAmount,
        isActive,
      };
    });
  }, [subcontractorPartners, subcontracts]);

  const thisWeekDue = scheduleData.filter(
    (s) => s.isActive && s.certifiesThisWeek && s.statusThisWeek === "PENDIENTE"
  );
  const thisWeekDone = scheduleData.filter(
    (s) => s.isActive && s.certifiesThisWeek && s.statusThisWeek === "CERTIFICADO"
  );

  const activeCount = scheduleData.filter((s) => s.isActive).length;
  const inactiveCount = scheduleData.filter((s) => !s.isActive).length;

  const filteredSchedule = scheduleData.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      s.partner.name.toLowerCase().includes(q) ||
      s.partner.taxId.toLowerCase().includes(q) ||
      (s.partner.classification || "").toLowerCase().includes(q);
    const matchesFreq = frequencyFilter === "ALL" || s.frequency === frequencyFilter;
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "ACTIVE" && s.isActive) ||
      (statusFilter === "INACTIVE" && !s.isActive);
    return matchesSearch && matchesFreq && matchesStatus;
  });

  const handleOpenCreate = () => {
    setFormState({
      name: "",
      taxId: "",
      specialization: "OBRA CIVIL",
      frequency: "QUINCENAL",
      cutOffRule: "Días 15 y 30 de cada mes",
      phone: "",
      email: "",
      fiscalAddress: "",
    });
    setShowCreateModal(true);
  };

  const handleOpenEdit = (p: Partner) => {
    setEditingPartner(p);
    const classText = (p.classification || "").toUpperCase();
    let freq: Frequency = "QUINCENAL";
    if (classText.includes("SEMANAL")) freq = "SEMANAL";
    else if (classText.includes("MENSUAL")) freq = "MENSUAL";

    setFormState({
      name: p.name,
      taxId: p.taxId,
      specialization: p.classification?.split("-")[0]?.trim() || "OBRA CIVIL",
      frequency: freq,
      cutOffRule:
        freq === "SEMANAL"
          ? "Viernes de cada semana"
          : freq === "MENSUAL"
          ? "Fin de mes"
          : "Días 15 y 30 de cada mes",
      phone: p.phone || "",
      email: p.email || "",
      fiscalAddress: p.fiscalAddress || "",
    });
  };

  const handleSaveSubcontractor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim() || !formState.taxId.trim()) {
      showToast("Completá el nombre y RUC del subcontratista", "error");
      return;
    }

    setSubmitting(true);
    try {
      const combinedClassification = `${formState.specialization} - CORTE_${formState.frequency}`;

      if (editingPartner) {
        await api.updatePartner(editingPartner.id, {
          name: formState.name.trim(),
          taxId: formState.taxId.trim(),
          classification: combinedClassification,
          phone: formState.phone.trim() || undefined,
          email: formState.email.trim() || undefined,
          fiscalAddress: formState.fiscalAddress.trim() || undefined,
        });
        showToast(`Subcontratista "${formState.name}" actualizado con éxito.`);
      } else {
        await api.createPartner({
          name: formState.name.trim(),
          taxId: formState.taxId.trim(),
          kind: "SUBCONTRACTOR",
          classification: combinedClassification,
          phone: formState.phone.trim() || undefined,
          email: formState.email.trim() || undefined,
          fiscalAddress: formState.fiscalAddress.trim() || undefined,
        });
        showToast(`Subcontratista "${formState.name}" registrado con éxito.`);
      }

      setShowCreateModal(false);
      setEditingPartner(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al guardar el subcontratista", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Quick inline frequency change
  const handleInlineChangeFrequency = async (partner: Partner, newFreq: Frequency) => {
    const spec = (partner.classification || "OBRA CIVIL").split("-")[0]?.trim() || "OBRA CIVIL";
    const combinedClassification = `${spec} - CORTE_${newFreq}`;

    try {
      await api.updatePartner(partner.id, {
        classification: combinedClassification,
      });
      showToast(`Frecuencia de "${partner.name}" actualizada a ${newFreq}`);
      onRefresh();
    } catch (err: any) {
      showToast("Error al actualizar frecuencia: " + err.message, "error");
    }
  };

  // Toggle active / "Dar de baja" preserving all history
  const handleToggleActiveStatus = async () => {
    if (!partnerToToggleStatus) return;
    setSubmitting(true);
    try {
      const newActive = partnerToToggleStatus.active === false ? true : false;
      await api.updatePartner(partnerToToggleStatus.id, {
        active: newActive,
      });

      showToast(
        newActive
          ? `Subcontratista "${partnerToToggleStatus.name}" reactivado exitosamente.`
          : `Subcontratista "${partnerToToggleStatus.name}" dado de baja. Todo su historial de obras y contratos se conserva intacto.`
      );
      setPartnerToToggleStatus(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al cambiar estado del subcontratista", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePartner = async () => {
    if (!partnerToDelete) return;
    setSubmitting(true);
    try {
      await api.deletePartner(partnerToDelete.id);
      showToast(`Subcontratista "${partnerToDelete.name}" eliminado del catálogo.`);
      setPartnerToDelete(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar el subcontratista", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-12 animate-in fade-in duration-150">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">Subcontratistas & Empresas Tercerizadas</h1>
              <p className="text-xs text-slate-500">
                Calendario automatizado de cortes de quincena/semana, lista de contratistas y control de bajas con historial de trabajo.
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher & New Subcontractor Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setActiveSubView("calendario")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSubView === "calendario"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Calendario de Certificaciones</span>
            </button>

            <button
              onClick={() => setActiveSubView("lista")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSubView === "lista"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Lista de Subcontratistas ({subcontractorPartners.length})</span>
            </button>
          </div>

          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs active:scale-98 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo Subcontratista</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Certifican Esta Semana
            </span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </div>
          <p className="text-xl font-mono font-extrabold text-amber-700 mt-1">
            {thisWeekDue.length} pendientes
          </p>
          <span className="text-[10px] text-slate-500">
            {thisWeekDone.length} ya certificados esta semana
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Subcontratistas Activos
          </span>
          <p className="text-xl font-mono font-extrabold text-emerald-700 mt-1">
            {activeCount} empresas
          </p>
          <span className="text-[10px] text-slate-500">
            {inactiveCount > 0 ? `${inactiveCount} dados de baja` : "100% operativos"}
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Corte Quincenal Automático
          </span>
          <p className="text-sm font-mono font-bold text-blue-700 mt-1">
            {new Date().getDate() <= 15 ? "1ra Quincena (Día 15)" : "2da Quincena (Día 30)"}
          </p>
          <span className="text-[10px] text-slate-500">Regla estandarizada de faena</span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Total Contratado en Obra
          </span>
          <p className="text-base font-mono font-bold text-slate-900 mt-1">
            {formatMoney(
              scheduleData.reduce((acc, s) => acc + s.totalContractedAmount, 0),
              currency
            )}
          </p>
          <span className="text-[10px] text-slate-500">Monto acumulado histórico</span>
        </div>
      </div>

      {/* VIEW 1: CALENDARIO DE CERTIFICACIONES */}
      {activeSubView === "calendario" && (
        <div className="space-y-4">
          {/* Action alert box for current week */}
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                  <span>Semana Operativa de Certificaciones</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-200/70 text-amber-900 border border-amber-300">
                    Corte Activo
                  </span>
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  El sistema detecta automáticamente qué subcontratistas deben presentar su medición semanal o quincenal según su frecuencia de contrato.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-amber-900 font-bold bg-amber-100 px-3 py-1.5 rounded-xl border border-amber-300">
                {thisWeekDue.length} pendientes de emitir
              </span>
            </div>
          </div>

          {/* Schedule Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-3 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar por contratista, RUC o rubro..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Filtrar por frecuencia:</span>
                <select
                  value={frequencyFilter}
                  onChange={(e) => setFrequencyFilter(e.target.value)}
                  className="bg-white text-slate-700 text-xs rounded-xl px-2.5 py-1.5 border border-slate-200 outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ALL">Todas las frecuencias</option>
                  <option value="QUINCENAL">Quincenal (Días 15 y 30)</option>
                  <option value="SEMANAL">Semanal (Viernes)</option>
                  <option value="MENSUAL">Mensual (Fin de mes)</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[560px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="p-3 w-16 text-center">ESTADO</th>
                    <th className="p-3 w-28">RUC</th>
                    <th className="p-3">SUBCONTRATISTA / EMPRESA</th>
                    <th className="p-3">FRECUENCIA DE PAGO</th>
                    <th className="p-3">PRÓXIMO CORTE</th>
                    <th className="p-3 text-right">CONTRATOS</th>
                    <th className="p-3 text-center w-36">ACCIÓN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {filteredSchedule.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No se encontraron subcontratistas para los criterios seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredSchedule.map((s) => (
                      <tr
                        key={s.partner.id}
                        className={`hover:bg-blue-50/40 transition ${
                          !s.isActive ? "opacity-60 bg-slate-50" : ""
                        }`}
                      >
                        <td className="p-3 text-center">
                          {!s.isActive ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                              DE BAJA
                            </span>
                          ) : s.certifiesThisWeek ? (
                            s.statusThisWeek === "CERTIFICADO" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>LISTO</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse flex items-center justify-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>TOCA CORTE</span>
                              </span>
                            )
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                              PRÓX. CICLO
                            </span>
                          )}
                        </td>

                        <td className="p-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                          {s.partner.taxId}
                        </td>

                        <td className="p-3">
                          <p className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{s.partner.name}</span>
                            {!s.isActive && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                Inactivo
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {s.partner.classification || "OBRA CIVIL"}
                          </p>
                        </td>

                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              s.frequency === "SEMANAL"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : s.frequency === "MENSUAL"
                                ? "bg-sky-50 text-sky-700 border-sky-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                          >
                            {s.frequency} ({s.cutOffRule})
                          </span>
                        </td>

                        <td className="p-3 font-mono text-slate-600">
                          {s.nextCutoffDate}
                        </td>

                        <td className="p-3 text-right">
                          <span className="font-mono font-bold text-slate-900">
                            {s.contracts.length} contrato(s)
                          </span>
                          <span className="block text-[10px] text-slate-500 font-mono">
                            {formatMoney(s.totalContractedAmount, currency)}
                          </span>
                        </td>

                        <td className="p-3 text-center whitespace-nowrap">
                          {s.contracts.length > 0 ? (
                            <button
                              onClick={() => {
                                if (onSelectSubcontractForCert) {
                                  onSelectSubcontractForCert(s.contracts[0]);
                                } else {
                                  showToast(
                                    `Seleccioná el contrato de ${s.partner.name} en la pestaña de Certificaciones.`
                                  );
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-1 mx-auto cursor-pointer"
                            >
                              <span>Certificar</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">
                              Sin contrato asignado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LISTA DE SUBCONTRATISTAS (CRUD COMPLETO + FRECUENCIA + DAR DE BAJA) */}
      {activeSubView === "lista" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-3 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-md w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por nombre, RUC o especialidad..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
              />
            </div>

            {/* Status Filter Chips: Todos / Activos / Dados de Baja */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <button
                onClick={() => setStatusFilter("ALL")}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === "ALL"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Todos ({scheduleData.length})
              </button>

              <button
                onClick={() => setStatusFilter("ACTIVE")}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === "ACTIVE"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Activos ({activeCount})
              </button>

              <button
                onClick={() => setStatusFilter("INACTIVE")}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === "INACTIVE"
                    ? "bg-rose-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Dados de Baja ({inactiveCount})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[560px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-3 w-28">ESTADO</th>
                  <th className="p-3 w-28">RUC</th>
                  <th className="p-3">RAZÓN SOCIAL / NOMBRE</th>
                  <th className="p-3">ESPECIALIDAD</th>
                  <th className="p-3 text-center">FRECUENCIA DE CORTE</th>
                  <th className="p-3 text-right">HISTORIAL TRABAJOS</th>
                  <th className="p-3 text-center w-36">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredSchedule.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      No hay subcontratistas para mostrar. Hacé clic en "Nuevo Subcontratista" para registrar.
                    </td>
                  </tr>
                ) : (
                  filteredSchedule.map((s) => (
                    <tr
                      key={s.partner.id}
                      className={`hover:bg-blue-50/40 transition ${
                        !s.isActive ? "opacity-60 bg-slate-50" : ""
                      }`}
                    >
                      {/* Active / Inactive Badge */}
                      <td className="p-3">
                        {s.isActive ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-max">
                            <UserCheck className="w-3 h-3" />
                            <span>ACTIVO</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1 w-max">
                            <UserX className="w-3 h-3" />
                            <span>DE BAJA</span>
                          </span>
                        )}
                      </td>

                      <td className="p-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                        {s.partner.taxId}
                      </td>

                      <td className="p-3">
                        <p className="font-bold text-slate-900">{s.partner.name}</p>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                          {s.partner.phone && (
                            <span className="flex items-center gap-1 font-mono">
                              <Phone className="w-2.5 h-2.5 text-slate-400" />
                              {s.partner.phone}
                            </span>
                          )}
                          {s.partner.email && (
                            <span className="flex items-center gap-1 font-mono">
                              <Mail className="w-2.5 h-2.5 text-slate-400" />
                              {s.partner.email}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {s.partner.classification?.split("-")[0]?.trim() || "OBRA CIVIL"}
                        </span>
                      </td>

                      {/* Frequency Selector - Quick Inline Dropdown */}
                      <td className="p-3 text-center">
                        <select
                          value={s.frequency}
                          onChange={(e) => handleInlineChangeFrequency(s.partner, e.target.value as Frequency)}
                          className="bg-white border border-blue-200 text-blue-700 font-bold text-xs rounded-lg px-2 py-1 outline-none cursor-pointer hover:border-blue-400 transition"
                        >
                          <option value="QUINCENAL">Quincenal (15 y 30)</option>
                          <option value="SEMANAL">Semanal (Viernes)</option>
                          <option value="MENSUAL">Mensual (Fin mes)</option>
                        </select>
                      </td>

                      {/* Historical records of what they did */}
                      <td className="p-3 text-right">
                        <div className="text-right">
                          <span className="font-mono font-bold text-slate-900 block">
                            {s.contracts.length} contrato(s)
                          </span>
                          <span className="text-[10px] text-emerald-700 font-mono block">
                            Certificado: {formatMoney(s.totalCertifiedAmount, currency)}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            Total: {formatMoney(s.totalContractedAmount, currency)}
                          </span>
                        </div>
                      </td>

                      {/* Actions: Edit, Deactivate/Reactivate, Delete */}
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(s.partner)}
                            title="Modificar Datos"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 text-blue-600 hover:text-blue-700 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Active / Deactivate */}
                          <button
                            onClick={() => setPartnerToToggleStatus(s.partner)}
                            title={s.isActive ? "Dar de Baja (conservando historial)" : "Reactivar Subcontratista"}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              s.isActive
                                ? "bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600"
                                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {s.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            onClick={() => setPartnerToDelete(s.partner)}
                            title="Eliminar Subcontratista del Catálogo"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create or Edit Subcontractor */}
      {(showCreateModal || editingPartner) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-900">
            <button
              onClick={() => {
                setShowCreateModal(false);
                setEditingPartner(null);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                {editingPartner ? "Modificar Subcontratista" : "Registrar Nuevo Subcontratista"}
              </h3>
            </div>

            <form onSubmit={handleSaveSubcontractor} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">RUC / Cédula Fiscal *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. 80012345-6"
                    value={formState.taxId}
                    onChange={(e) => setFormState({ ...formState, taxId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono uppercase outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Frecuencia de Corte *</label>
                  <select
                    value={formState.frequency}
                    onChange={(e) => {
                      const freq = e.target.value as Frequency;
                      setFormState({
                        ...formState,
                        frequency: freq,
                        cutOffRule:
                          freq === "SEMANAL"
                            ? "Viernes de cada semana"
                            : freq === "MENSUAL"
                            ? "Fin de mes"
                            : "Días 15 y 30 de cada mes",
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="QUINCENAL">Quincenal (Días 15 y 30)</option>
                    <option value="SEMANAL">Semanal (Viernes)</option>
                    <option value="MENSUAL">Mensual (Fin de mes)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Razón Social / Nombre Comercial *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Instalaciones Eléctricas Guaraní S.R.L."
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Especialidad / Rubro</label>
                  <input
                    type="text"
                    placeholder="Ej. ESTRUCTURAS, ELECTRICIDAD, PISOS"
                    value={formState.specialization}
                    onChange={(e) => setFormState({ ...formState, specialization: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Teléfono de Contacto</label>
                  <input
                    type="text"
                    placeholder="Ej. 0981-123456"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  placeholder="administracion@proveedor.com.py"
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dirección Fiscal / Taller</label>
                <input
                  type="text"
                  placeholder="Ej. Avda. Eusebio Ayala km 4.5, Asunción"
                  value={formState.fiscalAddress}
                  onChange={(e) => setFormState({ ...formState, fiscalAddress: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingPartner(null);
                  }}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Guardando..." : editingPartner ? "Guardar Cambios" : "Registrar Subcontratista"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Toggle Active / Dar de Baja */}
      {partnerToToggleStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl text-slate-900">
            <div className="flex items-center gap-3 mb-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  partnerToToggleStatus.active === false
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                {partnerToToggleStatus.active === false ? (
                  <UserCheck className="w-5 h-5" />
                ) : (
                  <UserX className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {partnerToToggleStatus.active === false
                    ? "¿Reactivar Subcontratista?"
                    : "¿Dar de Baja al Subcontratista?"}
                </h3>
                <p className="text-xs text-slate-500 font-mono">{partnerToToggleStatus.name}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2 mb-4">
              <p>
                {partnerToToggleStatus.active === false
                  ? "El subcontratista volverá a aparecer como activo en el calendario de cortes y listas de asignación."
                  : "Al dar de baja, el subcontratista ya no figurará en las fechas de corte activas, pero TODO su registro de obras, mediciones y certificados históricos se conserva intacto en el sistema."}
              </p>
              <div className="flex items-center gap-2 text-blue-700 font-semibold pt-1">
                <History className="w-3.5 h-3.5" />
                <span>Historial de contratos y certificados 100% preservado.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPartnerToToggleStatus(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleToggleActiveStatus}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition shadow-xs disabled:opacity-50 cursor-pointer ${
                  partnerToToggleStatus.active === false
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {submitting
                  ? "Procesando..."
                  : partnerToToggleStatus.active === false
                  ? "Confirmar Reactivación"
                  : "Confirmar Baja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete */}
      {partnerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl text-slate-900">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0 border border-rose-200">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Eliminar del Catálogo?</h3>
                <p className="text-xs text-slate-500 font-mono">{partnerToDelete.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              ¿Estás seguro de que deseas eliminar permanentemente a este subcontratista? Si ya tiene contratos vinculados, se sugiere usar "Dar de baja" en su lugar.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPartnerToDelete(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleDeletePartner}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "Eliminando..." : "Eliminar Subcontratista"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
