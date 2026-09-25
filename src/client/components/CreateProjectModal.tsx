import React, { useState } from "react";
import {
  Building2,
  X,
  FileSpreadsheet,
  Plus,
  Calendar,
  DollarSign,
  MapPin,
  UserCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Project } from "../types";
import { api } from "../api";
import { formatMoney, parseFlexibleNumber } from "../utils/format";

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProject: Project, initialMode: "excel" | "manual") => void;
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
  currency,
  showToast,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Project Details
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [clientName, setClientName] = useState("");
  const [executionMonths, setExecutionMonths] = useState<string>("12");
  const [globalBudget, setGlobalBudget] = useState<string>("1500000000");
  const [roadSection, setRoadSection] = useState("");
  const [contractNumber, setContractNumber] = useState("");

  // Step 2: Budget loading choice
  const [budgetLoadMode, setBudgetLoadMode] = useState<"excel" | "manual">("excel");

  if (!isOpen) return null;

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast("Ingresá al menos el nombre de la obra", "error");
      return;
    }
    setStep(2);
  };

  const handleFinishCreation = async (overrideMode?: "excel" | "manual") => {
    const finalMode = overrideMode || budgetLoadMode;
    if (!name.trim()) {
      showToast("Ingresá el nombre oficial de la obra", "error");
      return;
    }

    setSubmitting(true);
    try {
      const budgetNum = parseFlexibleNumber(globalBudget);
      const monthsNum = parseInt(String(executionMonths).replace(/\D/g, ""), 10) || 12;
      const finalCode = code.trim()
        ? code.trim().toUpperCase()
        : `OBR-${Date.now().toString().slice(-4)}`;

      const newProj = await api.createProject({
        code: finalCode,
        name: name.trim(),
        location: location.trim() || "Paraguay",
        clientName: clientName.trim() || "Cliente Principal",
        executionMonths: monthsNum,
        globalBudget: budgetNum,
        roadSection: roadSection.trim() || undefined,
        contractNumber: contractNumber.trim() || undefined,
        montoContractualManual: budgetNum,
      });

      showToast(`¡Obra "${newProj.name}" creada exitosamente!`);
      onProjectCreated(newProj, finalMode);
      onClose();
    } catch (err: any) {
      showToast(err.message || "Error al crear la obra en la base de datos", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Crear Nuevo Proyecto / Obra</h2>
              <p className="text-xs text-slate-500">
                {step === 1 ? "Paso 1: Datos Generales de la Obra" : "Paso 2: Carga de Presupuesto Inicial"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-center gap-3 bg-white">
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === 1 ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"
              }`}
            >
              {step > 1 ? "✓" : "1"}
            </span>
            <span className={`text-xs font-semibold ${step === 1 ? "text-slate-900" : "text-slate-500"}`}>
              Datos de Obra
            </span>
          </div>
          <div className="w-12 h-0.5 bg-slate-200" />
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === 2 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400 border border-slate-300"
              }`}
            >
              2
            </span>
            <span className={`text-xs font-semibold ${step === 2 ? "text-slate-900" : "text-slate-400"}`}>
              Cargar Presupuesto
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 bg-white">
          {step === 1 ? (
            <form onSubmit={handleNextStep} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Código de Obra * (ej. CTN-02)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. OBR-2026"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono uppercase outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Plazo de Ejecución (Meses) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="Ej. 12 o 24"
                    value={executionMonths}
                    onChange={(e) => setExecutionMonths(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none font-mono transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre Oficial del Proyecto *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Construcción de Nuevo Hospital Regional de Encarnación"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ubicación / Ciudad *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Asunción, Barrio Herrera"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Cliente / Contratante *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. MOPC / MEC / Cliente Privado"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Presupuesto Global Estimado ({currency}) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="Ej. 29565843516 o 29.565.843.516"
                    value={globalBudget}
                    onChange={(e) => setGlobalBudget(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono outline-none transition"
                  />
                  {globalBudget ? (
                    <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-700 font-mono">
                      <span>✓ Monto interpretado:</span>
                      <span className="font-bold">
                        {formatMoney(parseFlexibleNumber(globalBudget), currency)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    N° de Contrato / Licitación (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. LIC-2026/04"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono outline-none transition"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting || !name.trim()}
                    onClick={() => handleFinishCreation("excel")}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-50"
                    title="Crea el proyecto y abre directamente el importador de Excel"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{submitting ? "Creando..." : "Crear y Empezar"}</span>
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-950">
                <p className="font-bold text-slate-900 mb-1">
                  Tu obra "{name}" ({code}) se creará con los datos ingresados.
                </p>
                <p className="text-slate-600">
                  Seleccioná cómo querés inicializar la planilla de control de rubros y costos para empezar a operar.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Option 1: Excel Import */}
                <div
                  onClick={() => setBudgetLoadMode("excel")}
                  className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                    budgetLoadMode === "excel"
                      ? "bg-blue-50/70 border-blue-500 shadow-sm ring-1 ring-blue-400"
                      : "bg-white border-slate-200 hover:border-blue-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      {budgetLoadMode === "excel" && (
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Importar Archivo Excel (.xlsx)</h3>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      Cargá tu planilla con rubros, unidades, cómputo métrico y precios. El sistema detecta los títulos automáticamente.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-blue-700 mt-3 block">
                    Recomendado para obras con cómputo listo
                  </span>
                </div>

                {/* Option 2: Empty / Manual */}
                <div
                  onClick={() => setBudgetLoadMode("manual")}
                  className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                    budgetLoadMode === "manual"
                      ? "bg-blue-50/70 border-blue-500 shadow-sm ring-1 ring-blue-400"
                      : "bg-white border-slate-200 hover:border-blue-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                        <Plus className="w-4 h-4" />
                      </div>
                      {budgetLoadMode === "manual" && (
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Empezar con Planilla Vacía</h3>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      Creá la obra limpia y andá cargando los rubros y partidas uno a uno directamente desde la tabla de control.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-blue-700 mt-3 block">
                    Para obras en fase inicial de anteproyecto
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
                >
                  Volver a Datos de Obra
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleFinishCreation()}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <span>Creando obra...</span>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {budgetLoadMode === "excel" ? "Crear e Importar Excel" : "Crear y Empezar"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
