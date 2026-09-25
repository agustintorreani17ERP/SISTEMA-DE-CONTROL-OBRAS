import React, { useState, useMemo } from "react";
import {
  FilePlus2,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Calendar,
  DollarSign,
  TrendingUp,
  Tag,
  ArrowRight,
  X,
  FileText,
  Clock,
  Sparkles,
  Layers,
} from "lucide-react";
import { Project, BudgetItem } from "../types";
import { api } from "../api";
import { formatMoney } from "../utils/format";

export interface AdendaItem {
  id: string;
  adendaNumber: string;
  title: string;
  justification: string;
  approvalDate: string;
  status: "APROBADA" | "EN_REVISION" | "EN_TRAMITACION";
  resolutionNumber?: string;
  items: {
    code: string;
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    executedQuantity: number;
  }[];
}

interface RubrosExtrasTabProps {
  project?: Project | null;
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onOpenCertifyExtra?: (item: { code: string; name: string; unit: string; unitPrice: number; quantity: number }) => void;
}

const INITIAL_ADENDAS: AdendaItem[] = [
  {
    id: "AD-01",
    adendaNumber: "Convenio Modificatorio N° 1",
    title: "Ampliación de zapatas y fundaciones por nivel freático alto",
    justification: "Estudio geotécnico complementario indicó necesidad de profundización de cimientos en Bloque B.",
    approvalDate: "15/01/2026",
    status: "APROBADA",
    resolutionNumber: "RES-MOPC-2026/89",
    items: [
      {
        code: "EXT-01",
        name: "Excavación adicional en suelo con presencia de agua",
        unit: "m³",
        quantity: 180,
        unitPrice: 75000,
        totalAmount: 13500000,
        executedQuantity: 120,
      },
      {
        code: "EXT-02",
        name: "Hormigón armado para zapatas de mayor cota H-30",
        unit: "m³",
        quantity: 45,
        unitPrice: 920000,
        totalAmount: 41400000,
        executedQuantity: 30,
      },
    ],
  },
  {
    id: "AD-02",
    adendaNumber: "Adenda N° 2",
    title: "Incorporación de grupo electrógeno y tablero de transferencia automática",
    justification: "Requerimiento de respaldo para quirófanos y banco de sangre.",
    approvalDate: "02/02/2026",
    status: "APROBADA",
    resolutionNumber: "RES-INT-2026/14",
    items: [
      {
        code: "EXT-03",
        name: "Grupo electrógeno diesel insonorizado 150 kVA",
        unit: "gl",
        quantity: 1,
        unitPrice: 145000000,
        totalAmount: 145000000,
        executedQuantity: 0,
      },
    ],
  },
];

export const RubrosExtrasTab: React.FC<RubrosExtrasTabProps> = ({
  project,
  budgetItems,
  currency,
  onRefresh,
  showToast,
  onOpenCertifyExtra,
}) => {
  const [adendas, setAdendas] = useState<AdendaItem[]>(INITIAL_ADENDAS);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Adenda Form
  const [adendaNumber, setAdendaNumber] = useState("");
  const [adendaTitle, setAdendaTitle] = useState("");
  const [justification, setJustification] = useState("");
  const [resolutionNumber, setResolutionNumber] = useState("");
  const [extraItems, setExtraItems] = useState<
    { code: string; name: string; unit: string; quantity: number; unitPrice: number }[]
  >([{ code: "EXT-04", name: "", unit: "m²", quantity: 10, unitPrice: 50000 }]);

  // Certified Extra Modal
  const [selectedExtraItemForCert, setSelectedExtraItemForCert] = useState<{
    adendaId: string;
    code: string;
    name: string;
    unit: string;
    unitPrice: number;
    maxQty: number;
    currentExec: number;
  } | null>(null);
  const [certExecQty, setCertExecQty] = useState("");

  const originalBudgetAmount = useMemo(() => {
    return budgetItems.reduce((acc, it) => acc + Number(it.originalAmount || 0), 0);
  }, [budgetItems]);

  const totalExtrasAmount = useMemo(() => {
    return adendas.reduce((acc, ad) => {
      const adSum = ad.items.reduce((iAcc, it) => iAcc + it.totalAmount, 0);
      return acc + adSum;
    }, 0);
  }, [adendas]);

  const totalExtrasExecuted = useMemo(() => {
    return adendas.reduce((acc, ad) => {
      const adSum = ad.items.reduce((iAcc, it) => iAcc + it.executedQuantity * it.unitPrice, 0);
      return acc + adSum;
    }, 0);
  }, [adendas]);

  const percentageContractIncrease =
    originalBudgetAmount > 0 ? ((totalExtrasAmount / originalBudgetAmount) * 100).toFixed(2) : "0.00";

  const handleAddExtraItemRow = () => {
    const nextNum = extraItems.length + 4;
    setExtraItems((prev) => [
      ...prev,
      { code: `EXT-${String(nextNum).padStart(2, "0")}`, name: "", unit: "un", quantity: 1, unitPrice: 100000 },
    ]);
  };

  const handleRemoveExtraItemRow = (idx: number) => {
    if (extraItems.length <= 1) return;
    setExtraItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveAdenda = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adendaNumber.trim() || !adendaTitle.trim()) {
      showToast("Completá el número y título de la adenda", "error");
      return;
    }

    const validItems = extraItems.filter((it) => it.name.trim().length > 0);
    if (validItems.length === 0) {
      showToast("Agregá al menos un rubro extra con descripción", "error");
      return;
    }

    const newAdenda: AdendaItem = {
      id: `AD-${Date.now().toString().slice(-4)}`,
      adendaNumber: adendaNumber.trim(),
      title: adendaTitle.trim(),
      justification: justification.trim(),
      resolutionNumber: resolutionNumber.trim() || undefined,
      approvalDate: new Date().toLocaleDateString("es-PY"),
      status: "APROBADA",
      items: validItems.map((it) => ({
        code: it.code.trim().toUpperCase(),
        name: it.name.trim(),
        unit: it.unit.trim() || "un",
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        totalAmount: Math.round((Number(it.quantity) || 1) * (Number(it.unitPrice) || 0)),
        executedQuantity: 0,
      })),
    };

    setAdendas((prev) => [newAdenda, ...prev]);
    setShowCreateModal(false);
    showToast(`Adenda / Convenio "${adendaNumber}" registrada con éxito.`);

    // Reset
    setAdendaNumber("");
    setAdendaTitle("");
    setJustification("");
    setResolutionNumber("");
    setExtraItems([{ code: "EXT-05", name: "", unit: "m²", quantity: 10, unitPrice: 50000 }]);
  };

  const handleSaveCertifyExtra = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExtraItemForCert) return;

    const qty = parseFloat(certExecQty);
    if (isNaN(qty) || qty <= 0) {
      showToast("Ingresá una cantidad ejecutada válida", "error");
      return;
    }

    const newExec = selectedExtraItemForCert.currentExec + qty;
    if (newExec > selectedExtraItemForCert.maxQty) {
      showToast(
        `La cantidad supera el límite aprobado en la adenda (${selectedExtraItemForCert.maxQty} ${selectedExtraItemForCert.unit})`,
        "error"
      );
      return;
    }

    setAdendas((prev) =>
      prev.map((ad) => {
        if (ad.id !== selectedExtraItemForCert.adendaId) return ad;
        return {
          ...ad,
          items: ad.items.map((it) =>
            it.code === selectedExtraItemForCert.code ? { ...it, executedQuantity: newExec } : it
          ),
        };
      })
    );

    showToast(`Certificación de ${qty} ${selectedExtraItemForCert.unit} de "${selectedExtraItemForCert.name}" asentada.`);
    setSelectedExtraItemForCert(null);
    setCertExecQty("");
  };

  const filteredAdendas = adendas.filter((ad) => {
    const q = searchQuery.toLowerCase();
    return (
      ad.adendaNumber.toLowerCase().includes(q) ||
      ad.title.toLowerCase().includes(q) ||
      ad.items.some((it) => it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-12 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
              <FilePlus2 className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">Rubros Extras, Adicionales & Adendas</h1>
              <p className="text-xs text-slate-500">
                Sección separada para convenios modificatorios, partidas imprevistas y adicionales al contrato original.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs active:scale-98 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Registrar Nueva Adenda / Rubro Extra</span>
        </button>
      </div>

      {/* Financial Impact Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Presupuesto Base Original
          </span>
          <p className="text-base font-mono font-bold text-slate-800 mt-1 truncate">
            {formatMoney(originalBudgetAmount, currency)}
          </p>
          <span className="text-[10px] text-slate-400">Planilla contractual original</span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">
            Monto Total Adendas / Extras
          </span>
          <p className="text-base font-mono font-extrabold text-blue-700 mt-1 truncate">
            +{formatMoney(totalExtrasAmount, currency)}
          </p>
          <span className="text-[10px] text-blue-600 font-semibold">
            +{percentageContractIncrease}% del contrato original
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
            Nuevo Monto Contractual
          </span>
          <p className="text-base font-mono font-extrabold text-emerald-700 mt-1 truncate">
            {formatMoney(originalBudgetAmount + totalExtrasAmount, currency)}
          </p>
          <span className="text-[10px] text-slate-400">Base contractual consolidada</span>
        </div>

        <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
            Ejecutado de Rubros Extras
          </span>
          <p className="text-base font-mono font-bold text-slate-900 mt-1 truncate">
            {formatMoney(totalExtrasExecuted, currency)}
          </p>
          <span className="text-[10px] text-slate-400">
            Saldo extra: {formatMoney(Math.max(0, totalExtrasAmount - totalExtrasExecuted), currency)}
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por número de adenda, concepto o código de rubro extra..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500 transition"
          />
        </div>
        <span className="text-xs text-slate-500">
          Mostrando <strong className="text-slate-800">{filteredAdendas.length}</strong> adendas
        </span>
      </div>

      {/* Adendas Accordion / Cards List */}
      <div className="space-y-4">
        {filteredAdendas.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 shadow-xs">
            <FilePlus2 className="w-10 h-10 mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-semibold text-slate-800">No se encontraron adendas registradas</p>
            <p className="text-xs text-slate-500 mt-1">
              Podés registrar una nueva adenda con sus respectivos ítems adicionales haciendo clic en "Registrar Nueva Adenda".
            </p>
          </div>
        ) : (
          filteredAdendas.map((ad) => {
            const adendaTotal = ad.items.reduce((acc, it) => acc + it.totalAmount, 0);
            const adendaExec = ad.items.reduce((acc, it) => acc + it.executedQuantity * it.unitPrice, 0);
            const adendaPct = adendaTotal > 0 ? (adendaExec / adendaTotal) * 100 : 0;

            return (
              <div
                key={ad.id}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs"
              >
                {/* Adenda Header Banner */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {ad.adendaNumber}
                      </span>
                      {ad.resolutionNumber && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-200">
                          {ad.resolutionNumber}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {ad.status}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Aprobado el {ad.approvalDate}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">{ad.title}</h3>
                    {ad.justification && (
                      <p className="text-xs text-slate-500 mt-1 italic leading-relaxed">
                        Justificación: "{ad.justification}"
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Monto de la Adenda
                    </span>
                    <span className="text-sm font-mono font-bold text-blue-700 block">
                      +{formatMoney(adendaTotal, currency)}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-700">
                      Ejecutado: {adendaPct.toFixed(1)}% ({formatMoney(adendaExec, currency)})
                    </span>
                  </div>
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="p-3 w-24">CÓDIGO</th>
                        <th className="p-3">DESCRIPCIÓN DEL RUBRO EXTRA</th>
                        <th className="p-3 text-center w-20">UNIDAD</th>
                        <th className="p-3 text-right w-24">CANT. EXTRA</th>
                        <th className="p-3 text-right w-24">EJECUTADA</th>
                        <th className="p-3 text-right w-24">FALTANTE</th>
                        <th className="p-3 text-right w-28">P. UNITARIO</th>
                        <th className="p-3 text-right w-32">MONTO TOTAL</th>
                        <th className="p-3 text-center w-28">ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {ad.items.map((it, idx) => {
                        const remaining = Math.max(0, it.quantity - it.executedQuantity);
                        const progress = it.quantity > 0 ? (it.executedQuantity / it.quantity) * 100 : 0;

                        return (
                          <tr key={idx} className="hover:bg-blue-50/30 transition">
                            <td className="p-3 font-mono font-bold text-blue-700">{it.code}</td>
                            <td className="p-3 font-bold text-slate-900">{it.name}</td>
                            <td className="p-3 text-center font-mono text-slate-500">{it.unit}</td>
                            <td className="p-3 text-right font-mono text-slate-900">
                              {it.quantity.toLocaleString("es-PY")}
                            </td>
                            <td className="p-3 text-right font-mono text-emerald-700 font-bold">
                              {it.executedQuantity.toLocaleString("es-PY")}
                            </td>
                            <td className="p-3 text-right font-mono text-amber-700">
                              {remaining.toLocaleString("es-PY")}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-600">
                              {formatMoney(it.unitPrice, currency)}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-slate-900">
                              {formatMoney(it.totalAmount, currency)}
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              <button
                                onClick={() => {
                                  setSelectedExtraItemForCert({
                                    adendaId: ad.id,
                                    code: it.code,
                                    name: it.name,
                                    unit: it.unit,
                                    unitPrice: it.unitPrice,
                                    maxQty: it.quantity,
                                    currentExec: it.executedQuantity,
                                  });
                                  setCertExecQty("");
                                }}
                                className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-bold transition flex items-center gap-1 mx-auto cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Certificar</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create Adenda */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <FilePlus2 className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Registrar Convenio Modificatorio / Adenda</h3>
            </div>

            <form onSubmit={handleSaveAdenda} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Número / Denominación de Adenda *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Adenda N° 3"
                    value={adendaNumber}
                    onChange={(e) => setAdendaNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Resolución / Acta de Aprobación
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. RES-2026/104"
                    value={resolutionNumber}
                    onChange={(e) => setResolutionNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Título o Resumen de la Modificación *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Ampliación de Red Eléctrica e Iluminación Perimetral"
                  value={adendaTitle}
                  onChange={(e) => setAdendaTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Justificación Técnica / Causa del Adicional
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej. Solicitado por fiscalización debido a modificaciones en el trazado vial..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Items List */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Rubros Extras de esta Adenda:</span>
                  <button
                    type="button"
                    onClick={handleAddExtraItemRow}
                    className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Agregar Fila</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {extraItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="col-span-2">
                        <input
                          type="text"
                          required
                          placeholder="Cód"
                          value={item.code}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExtraItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, code: val } : it))
                            );
                          }}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-blue-700 font-mono focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div className="col-span-4">
                        <input
                          type="text"
                          required
                          placeholder="Descripción del rubro extra"
                          value={item.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExtraItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, name: val } : it))
                            );
                          }}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div className="col-span-1">
                        <input
                          type="text"
                          required
                          placeholder="Un"
                          value={item.unit}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExtraItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, unit: val } : it))
                            );
                          }}
                          className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-700 font-mono text-center focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          step="any"
                          required
                          placeholder="Cant"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setExtraItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                            );
                          }}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 font-mono text-right focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          step="any"
                          required
                          placeholder="Precio"
                          value={item.unitPrice}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setExtraItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, unitPrice: val } : it))
                            );
                          }}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 font-mono text-right focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div className="col-span-1 text-center">
                        {extraItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveExtraItemRow(idx)}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 cursor-pointer transition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  Aprobar y Registrar Adenda
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Certify Extra Rubro */}
      {selectedExtraItemForCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">Certificar Rubro Extra</h3>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-xs mb-4">
              <p className="font-bold text-slate-900">
                [{selectedExtraItemForCert.code}] {selectedExtraItemForCert.name}
              </p>
              <div className="flex justify-between text-slate-600">
                <span>Cantidad Aprobada en Adenda:</span>
                <span className="font-mono text-slate-900">
                  {selectedExtraItemForCert.maxQty.toLocaleString("es-PY")} {selectedExtraItemForCert.unit}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Ya Ejecutada Anteriormente:</span>
                <span className="font-mono text-emerald-700">
                  {selectedExtraItemForCert.currentExec.toLocaleString("es-PY")} {selectedExtraItemForCert.unit}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-200">
                <span>Saldo Faltante Disponible:</span>
                <span className="font-mono font-bold text-blue-700">
                  {(selectedExtraItemForCert.maxQty - selectedExtraItemForCert.currentExec).toLocaleString(
                    "es-PY"
                  )}{" "}
                  {selectedExtraItemForCert.unit}
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveCertifyExtra} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Cantidad Medida en este Certificado *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={selectedExtraItemForCert.maxQty - selectedExtraItemForCert.currentExec}
                    required
                    placeholder="0"
                    value={certExecQty}
                    onChange={(e) => setCertExecQty(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-xs font-bold text-slate-500">
                    {selectedExtraItemForCert.unit}
                  </span>
                </div>
              </div>

              {Number(certExecQty) > 0 && (
                <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 flex justify-between text-xs">
                  <span className="text-blue-900 font-bold">Monto a Certificar:</span>
                  <span className="font-mono font-bold text-blue-700">
                    {formatMoney(Number(certExecQty) * selectedExtraItemForCert.unitPrice, currency)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedExtraItemForCert(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  Confirmar Certificación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
