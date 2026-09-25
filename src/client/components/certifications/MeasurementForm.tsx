import React, { useState, useEffect } from "react";
import {
  Calendar,
  Layers,
  Camera,
  Calculator,
  Lock,
  Building2,
  Users,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Save,
  FileCheck,
  RotateCcw,
} from "lucide-react";
import { Project, Partner, AuxiliaryCalculation, ItemPhoto } from "../../types";
import { api } from "../../api";
import { AuxiliaryCalculationSubtable } from "./AuxiliaryCalculationSubtable";
import { ItemPhotoModal } from "./ItemPhotoModal";

interface FormRubroRow {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  totalContractQuantity: number;
  cantidadAnterior: number;
  cantidadPresente: number;
  isLockedByAux: boolean;
  auxiliaryCalculations: AuxiliaryCalculation[];
  photos: ItemPhoto[];
  isAuxOpen: boolean;
}

interface MeasurementFormProps {
  projects: Project[];
  partners: Partner[];
  initialProjectId?: number;
  onSuccess: (certificationId: number) => void;
  onCancel: () => void;
}

export const MeasurementForm: React.FC<MeasurementFormProps> = ({
  projects,
  partners,
  initialProjectId,
  onSuccess,
  onCancel,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<number>(
    initialProjectId || projects[0]?.id || 1
  );
  const [tipo, setTipo] = useState<"OBRA_CLIENTE" | "SUBCONTRATISTA">("OBRA_CLIENTE");
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [fecha, setFecha] = useState<string>(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState<string>("");

  // Autonumeración inteligente
  const [nextNumberInfo, setNextNumberInfo] = useState<{
    nextNumber: number;
    displayLabel: string;
    tipo: string;
  }>({
    nextNumber: 1,
    displayLabel: "Medición N° [Automático]",
    tipo: "OBRA_CLIENTE",
  });

  // Lista de rubros a medir
  const [rubroRows, setRubroRows] = useState<FormRubroRow[]>([]);
  const [loadingRubros, setLoadingRubros] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal de fotos activo
  const [activePhotoRubroId, setActivePhotoRubroId] = useState<number | null>(null);

  // Subcontratistas disponibles
  const subcontractors = partners.filter(
    (p) => p.kind === "SUBCONTRACTOR" || p.kind === "BOTH"
  );

  // Efecto: consultar autonumeración inteligente cuando cambia obra o tipo/subcontratista
  useEffect(() => {
    if (!selectedProjectId) return;
    const partnerIdParam = tipo === "SUBCONTRATISTA" ? selectedPartnerId : null;

    api
      .getNextCertificationNumber(selectedProjectId, partnerIdParam)
      .then((info) => {
        setNextNumberInfo(info);
      })
      .catch((err) => {
        console.warn("Error al consultar autonumeración:", err);
      });
  }, [selectedProjectId, tipo, selectedPartnerId]);

  // Efecto: cargar rubros y acumulados históricos
  useEffect(() => {
    if (!selectedProjectId) return;
    setLoadingRubros(true);
    const partnerIdParam = tipo === "SUBCONTRATISTA" ? selectedPartnerId : null;

    api
      .getCertificationRubrosDisponibles(selectedProjectId, partnerIdParam)
      .then((data) => {
        const rows: FormRubroRow[] = data.map((r: any) => ({
          budgetItemId: r.id,
          code: r.code,
          name: r.name,
          unit: r.unit || "un",
          unitPrice: Number(r.unitPrice || 0),
          totalContractQuantity: Number(r.totalContractQuantity || 0),
          cantidadAnterior: Number(r.cantidadAnterior || 0),
          cantidadPresente: 0,
          isLockedByAux: false,
          auxiliaryCalculations: [],
          photos: [],
          isAuxOpen: false,
        }));
        setRubroRows(rows);
      })
      .catch((err) => {
        console.error("Error al cargar rubros disponibles:", err);
      })
      .finally(() => {
        setLoadingRubros(false);
      });
  }, [selectedProjectId, tipo, selectedPartnerId]);

  // Manejo de actualización de cantidad manual directa
  const handleQuantityChange = (budgetItemId: number, value: number) => {
    setRubroRows((prev) =>
      prev.map((row) => {
        if (row.budgetItemId !== budgetItemId) return row;
        return {
          ...row,
          cantidadPresente: Math.max(0, value),
        };
      })
    );
  };

  // Manejo de actualización de cómputo auxiliar
  const handleAuxCalculationsChange = (
    budgetItemId: number,
    calculations: AuxiliaryCalculation[]
  ) => {
    setRubroRows((prev) =>
      prev.map((row) => {
        if (row.budgetItemId !== budgetItemId) return row;
        const totalAux = calculations.reduce((sum, c) => sum + (Number(c.subtotal) || 0), 0);
        const hasAux = calculations.length > 0;

        return {
          ...row,
          auxiliaryCalculations: calculations,
          // Si tiene cómputos, se suma y bloquea el campo
          cantidadPresente: hasAux ? Number(totalAux.toFixed(4)) : row.cantidadPresente,
          isLockedByAux: hasAux,
        };
      })
    );
  };

  // Toggle abrir / cerrar sub-tabla de cómputo auxiliar
  const toggleAuxTable = (budgetItemId: number) => {
    setRubroRows((prev) =>
      prev.map((row) => {
        if (row.budgetItemId !== budgetItemId) return row;
        return {
          ...row,
          isAuxOpen: !row.isAuxOpen,
        };
      })
    );
  };

  // Manejo de guardado de fotos
  const handleSavePhotos = (budgetItemId: number, photos: ItemPhoto[]) => {
    setRubroRows((prev) =>
      prev.map((row) => {
        if (row.budgetItemId !== budgetItemId) return row;
        return {
          ...row,
          photos,
        };
      })
    );
  };

  // Totales en vivo del formulario
  const totalMontoPresente = rubroRows.reduce((sum, r) => {
    return sum + Math.round(r.cantidadPresente * r.unitPrice);
  }, 0);

  const itemsConMedicion = rubroRows.filter((r) => r.cantidadPresente > 0);

  // Envío del formulario
  const handleSubmit = async (e: React.FormEvent, andClose: boolean = false) => {
    e.preventDefault();
    if (itemsConMedicion.length === 0) {
      alert("Debe ingresar cantidad ejecutada en al menos un rubro para generar la medición.");
      return;
    }

    if (tipo === "SUBCONTRATISTA" && !selectedPartnerId) {
      alert("Debe seleccionar un subcontratista ejecutor.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        projectId: selectedProjectId,
        partnerId: tipo === "SUBCONTRATISTA" ? selectedPartnerId : null,
        fecha,
        notes,
        items: itemsConMedicion.map((r) => ({
          budgetItemId: r.budgetItemId,
          cantidadAnterior: r.cantidadAnterior,
          cantidadPresente: r.cantidadPresente,
          precioUnitario: r.unitPrice,
          auxiliaryCalculations: r.auxiliaryCalculations,
          photos: r.photos,
        })),
      };

      const created = await api.createCertification(payload);

      if (andClose) {
        await api.closeCertificationMeasurement(created.id);
      }

      onSuccess(created.id);
    } catch (err: any) {
      alert("Error al guardar medición: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const activePhotoRow = rubroRows.find((r) => r.budgetItemId === activePhotoRubroId);

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6">
        {/* Header and Initial Selectors */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">
                Carga de Avance de Campo
              </span>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-3 mt-0.5">
                Nueva Medición de Obra
                <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-slate-900 text-white border border-slate-800 shadow-2xs">
                  {nextNumberInfo.displayLabel}
                </span>
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Autonumeración:</span>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                Secuencia Inteligente #{nextNumberInfo.nextNumber}
              </span>
            </div>
          </div>

          {/* Selector Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Obra */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                Obra / Tramo
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                className="w-full text-xs rounded-lg border border-slate-300 p-2.5 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Tipo: Obra o Subcontratista */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-500" />
                Tipo de Medición
              </label>
              <select
                value={tipo}
                onChange={(e) => {
                  const newTipo = e.target.value as "OBRA_CLIENTE" | "SUBCONTRATISTA";
                  setTipo(newTipo);
                  if (newTipo === "OBRA_CLIENTE") {
                    setSelectedPartnerId(null);
                  } else if (subcontractors.length > 0) {
                    setSelectedPartnerId(subcontractors[0].id);
                  }
                }}
                className="w-full text-xs rounded-lg border border-slate-300 p-2.5 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              >
                <option value="OBRA_CLIENTE">Certificación al Cliente (MOPC / Comitente)</option>
                <option value="SUBCONTRATISTA">Medición a Subcontratista (Cuentas por Pagar)</option>
              </select>
            </div>

            {/* Subcontratista (si aplica) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                {tipo === "SUBCONTRATISTA" ? (
                  <span className="text-blue-700 font-bold">Subcontratista Ejecutor *</span>
                ) : (
                  <span className="text-slate-400">Beneficiario / Cliente</span>
                )}
              </label>
              {tipo === "SUBCONTRATISTA" ? (
                <select
                  value={selectedPartnerId || ""}
                  onChange={(e) => setSelectedPartnerId(Number(e.target.value) || null)}
                  className="w-full text-xs rounded-lg border border-blue-300 p-2.5 bg-blue-50/50 text-blue-900 font-semibold focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
                >
                  <option value="">Seleccione Subcontratista...</option>
                  {subcontractors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (RUC: {s.taxId})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  disabled
                  value="Comitente Principal / Certificación de Obra"
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-100 text-slate-500 italic"
                />
              )}
            </div>

            {/* Fecha de Medición */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Fecha de Corte de Medición
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-300 p-2 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          {/* Observaciones generales */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Observaciones / Notas del Frente de Obra
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Medición quincenal correspondiente a progresivas km 12+000 al km 14+500..."
              className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Grid de Rubros */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden space-y-0">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                Planilla de Carga de Rubros
                <span className="text-xs text-slate-500 font-normal">
                  ({rubroRows.length} rubros presupuestarios disponibles)
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Ingrese las cantidades presentes o abra el <strong>Cómputo Auxiliar</strong> para desglose geométrico.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-[11px] text-slate-500 block">Monto a Certificar (Presente):</span>
                <span className="text-base font-black text-emerald-700 font-mono">
                  {totalMontoPresente.toLocaleString("es-PY")} Gs.
                </span>
              </div>
              <div className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-lg">
                {itemsConMedicion.length} {itemsConMedicion.length === 1 ? "rubro medido" : "rubros medidos"}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-3 w-16 text-center">Ítem</th>
                  <th className="py-3 px-3 min-w-[220px]">Descripción del Rubro</th>
                  <th className="py-3 px-2 text-center w-14">Unid.</th>
                  <th className="py-3 px-3 text-right w-28">Precio Unit. (Gs.)</th>
                  <th className="py-3 px-3 text-right w-28 bg-slate-200/50">Cant. Anterior</th>
                  <th className="py-3 px-3 text-center w-40 bg-blue-50 text-blue-900">
                    Cant. Presente
                  </th>
                  <th className="py-3 px-3 text-right w-32 bg-emerald-50 text-emerald-900">
                    Monto Presente (Gs.)
                  </th>
                  <th className="py-3 px-3 text-center w-48">Herramientas de Campo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingRubros ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      Cargando rubros y acumulados históricos de la obra...
                    </td>
                  </tr>
                ) : rubroRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      No hay rubros presupuestarios registrados en esta obra.
                    </td>
                  </tr>
                ) : (
                  rubroRows.map((row) => {
                    const rowMontoPresente = Math.round(row.cantidadPresente * row.unitPrice);
                    const hasAux = row.auxiliaryCalculations.length > 0;
                    const hasPhotos = row.photos.length > 0;

                    return (
                      <React.Fragment key={row.budgetItemId}>
                        <tr
                          className={`hover:bg-slate-50/80 transition-colors ${
                            row.cantidadPresente > 0 ? "bg-blue-50/20" : ""
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-mono font-bold text-slate-700">
                            {row.code}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-800">{row.name}</div>
                            {row.totalContractQuantity > 0 && (
                              <div className="text-[11px] text-slate-400">
                                Contrato Total: {row.totalContractQuantity.toLocaleString("es-PY")} {row.unit}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center text-slate-600 font-medium">
                            {row.unit}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-700">
                            {row.unitPrice.toLocaleString("es-PY")}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-500 bg-slate-50">
                            {row.cantidadAnterior.toLocaleString("es-PY", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="py-2 px-3 bg-blue-50/30">
                            <div className="relative">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                disabled={row.isLockedByAux}
                                value={row.cantidadPresente === 0 ? "" : row.cantidadPresente}
                                onChange={(e) =>
                                  handleQuantityChange(
                                    row.budgetItemId,
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                placeholder="0"
                                className={`w-full text-right font-mono text-xs rounded-lg px-2.5 py-1.5 border transition-all ${
                                  row.isLockedByAux
                                    ? "bg-amber-50/80 border-amber-300 text-amber-900 font-bold cursor-not-allowed pr-7"
                                    : "bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                }`}
                              />
                              {row.isLockedByAux && (
                                <span
                                  className="absolute right-2 top-2 text-amber-600 flex items-center"
                                  title="Bloqueado por Cómputo Auxiliar (Largo × Ancho × Alto)"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            {row.isLockedByAux && (
                              <span className="text-[10px] text-amber-700 font-medium flex items-center gap-1 mt-0.5">
                                Cómputo auxiliar vinculado
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 bg-emerald-50/30">
                            {rowMontoPresente.toLocaleString("es-PY")}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Botón Abrir Cómputo Auxiliar */}
                              <button
                                type="button"
                                onClick={() => toggleAuxTable(row.budgetItemId)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                  hasAux
                                    ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300"
                                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                                }`}
                                title="Abrir planilla interactiva de cómputo auxiliar (Largo x Ancho x Alto)"
                              >
                                <Calculator className="w-3.5 h-3.5" />
                                <span>Cómputo</span>
                                {hasAux && (
                                  <span className="bg-emerald-700 text-white text-[10px] px-1 rounded-full">
                                    {row.auxiliaryCalculations.length}
                                  </span>
                                )}
                                {row.isAuxOpen ? (
                                  <ChevronUp className="w-3 h-3 ml-0.5" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 ml-0.5" />
                                )}
                              </button>

                              {/* Botón Fotos / Evidencia */}
                              <button
                                type="button"
                                onClick={() => setActivePhotoRubroId(row.budgetItemId)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                  hasPhotos
                                    ? "bg-blue-100 hover:bg-blue-200 text-blue-800 border border-blue-300"
                                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                                }`}
                                title="Adjuntar fotos de campo de este rubro"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                {hasPhotos ? (
                                  <span className="bg-blue-700 text-white text-[10px] px-1.5 rounded-full">
                                    {row.photos.length}
                                  </span>
                                ) : (
                                  <span>Fotos</span>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Sub-tabla interactiva de Cómputo Auxiliar incrustada (tipo Google Sheets) */}
                        {row.isAuxOpen && (
                          <tr>
                            <td colSpan={8} className="p-3 bg-slate-950">
                              <AuxiliaryCalculationSubtable
                                rubroCode={row.code}
                                rubroName={row.name}
                                rubroUnit={row.unit}
                                calculations={row.auxiliaryCalculations}
                                onChange={(calcs) =>
                                  handleAuxCalculationsChange(row.budgetItemId, calcs)
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 text-xs font-bold rounded-lg hover:bg-slate-100 transition-colors"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || itemsConMedicion.length === 0}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? "Guardando..." : "Guardar Borrador de Medición"}
            </button>

            <button
              type="button"
              disabled={saving || itemsConMedicion.length === 0}
              onClick={(e) => handleSubmit(e, true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
            >
              <FileCheck className="w-4 h-4" />
              {saving ? "Procesando..." : "Cerrar Medición y Previsualizar Certificado"}
            </button>
          </div>
        </div>
      </form>

      {/* Modal de Fotos Activo */}
      {activePhotoRow && (
        <ItemPhotoModal
          isOpen={Boolean(activePhotoRow)}
          onClose={() => setActivePhotoRubroId(null)}
          rubroCode={activePhotoRow.code}
          rubroName={activePhotoRow.name}
          photos={activePhotoRow.photos}
          onSavePhotos={(photos) => handleSavePhotos(activePhotoRow.budgetItemId, photos)}
        />
      )}
    </div>
  );
};
