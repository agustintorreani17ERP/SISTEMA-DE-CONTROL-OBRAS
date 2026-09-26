import React, { useState, useEffect, useRef } from "react";
import {
  Calendar,
  Camera,
  Calculator,
  Lock,
  Building2,
  Users,
  AlertTriangle,
  Save,
  Send,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Project, Partner, AuxiliaryCalculation, ItemPhoto } from "../../types";
import { api } from "../../api";
import { AuxiliaryCalculationSubtable } from "./AuxiliaryCalculationSubtable";
import { ItemPhotoModal } from "./ItemPhotoModal";
import { NumCell, cellInputCls, focusCell, gridKeyDown, parseNum, readPastedMatrix } from "./sheetGrid";

import { formatGs, formatQty } from "../../utils/numbers";
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

// Fila visible de la planilla. Apunta a un rubro presupuestario o es un ítem adicional (fuera de contrato).
interface SheetLine {
  key: string;
  budgetItemId: number | null;
  adicional?: { name: string; unit: string; qty: number };
  obs: string;
}

interface MeasurementFormProps {
  projects: Project[];
  partners: Partner[];
  initialProjectId?: number;
  onSuccess: (certificationId: number) => void;
  onCancel: () => void;
}

const GRID = "med";
// Columnas editables de la planilla
const COL = { item: 0, desc: 1, unit: 2, periodo: 3, obs: 4 } as const;

let lineSeq = 0;
const mkLine = (budgetItemId: number | null, adicional?: SheetLine["adicional"]): SheetLine => ({
  key: `l${++lineSeq}`,
  budgetItemId,
  adicional,
  obs: "",
});

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
  const [lines, setLines] = useState<SheetLine[]>([]);
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
        setLines(rows.map((r) => mkLine(r.budgetItemId)));
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

  // Un rubro que sale de la planilla deja de medirse
  const clearRubro = (budgetItemId: number) => {
    setRubroRows((prev) =>
      prev.map((row) =>
        row.budgetItemId === budgetItemId
          ? { ...row, cantidadPresente: 0, auxiliaryCalculations: [], isLockedByAux: false, isAuxOpen: false }
          : row
      )
    );
  };

  // ---------- Operaciones de planilla ----------
  const rubroById = (id: number | null) => rubroRows.find((r) => r.budgetItemId === id);
  const usedIds = new Set(lines.map((l) => l.budgetItemId).filter((x): x is number => x != null));

  const updateLine = (key: string, patch: Partial<SheetLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const assignRubro = (line: SheetLine, budgetItemId: number) => {
    if (line.budgetItemId != null && line.budgetItemId !== budgetItemId) clearRubro(line.budgetItemId);
    updateLine(line.key, { budgetItemId, adicional: undefined });
  };

  const makeAdicional = (line: SheetLine, name: string) => {
    if (line.budgetItemId != null) clearRubro(line.budgetItemId);
    updateLine(line.key, { budgetItemId: null, adicional: { name, unit: "un", qty: 0 } });
  };

  const addLine = (afterIdx?: number) => {
    const idx = afterIdx == null ? lines.length : afterIdx + 1;
    setLines((prev) => [...prev.slice(0, idx), mkLine(null), ...prev.slice(idx)]);
    setTimeout(() => focusCell(GRID, idx, COL.item), 0);
  };

  const deleteLine = (line: SheetLine) => {
    if (line.budgetItemId != null) clearRubro(line.budgetItemId);
    setLines((prev) => prev.filter((l) => l.key !== line.key));
  };

  const setPeriodo = (line: SheetLine, n: number) => {
    if (line.budgetItemId != null) {
      const r = rubroById(line.budgetItemId);
      if (r && !r.isLockedByAux) handleQuantityChange(line.budgetItemId, n);
    } else if (line.adicional) {
      updateLine(line.key, { adicional: { ...line.adicional, qty: Math.max(0, n) } });
    }
  };

  // Pegado desde Excel: rellena desde la celda activa hacia la derecha/abajo, agregando filas si hace falta
  const handlePaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const matrix = readPastedMatrix(e);
    if (!matrix) return;
    e.preventDefault();

    const nextLines = [...lines];
    const qtyUpdates: Record<number, number> = {};
    const taken = new Set(usedIds);
    const cleared: number[] = [];

    matrix.forEach((cells, i) => {
      const idx = r + i;
      if (!nextLines[idx]) nextLines[idx] = mkLine(null);
      let line = { ...nextLines[idx] };
      cells.forEach((raw, j) => {
        const col = c + j;
        const val = raw.trim();
        if (col === COL.item) {
          if (!val) return;
          const match = rubroRows.find((x) => x.code.toLowerCase() === val.toLowerCase());
          if (match && (!taken.has(match.budgetItemId) || match.budgetItemId === line.budgetItemId)) {
            if (line.budgetItemId != null && line.budgetItemId !== match.budgetItemId) cleared.push(line.budgetItemId);
            taken.add(match.budgetItemId);
            line = { ...line, budgetItemId: match.budgetItemId, adicional: undefined };
          } else if (!match) {
            if (line.budgetItemId != null) cleared.push(line.budgetItemId);
            line = { ...line, budgetItemId: null, adicional: { name: val, unit: "un", qty: line.adicional?.qty || 0 } };
          }
        } else if (col === COL.desc && line.adicional) {
          line = { ...line, adicional: { ...line.adicional, name: val } };
        } else if (col === COL.unit && line.adicional) {
          line = { ...line, adicional: { ...line.adicional, unit: val || "un" } };
        } else if (col === COL.periodo) {
          const n = Math.max(0, parseNum(val));
          if (line.budgetItemId != null) qtyUpdates[line.budgetItemId] = n;
          else if (line.adicional) line = { ...line, adicional: { ...line.adicional, qty: n } };
        } else if (col === COL.obs) {
          line = { ...line, obs: val };
        }
      });
      nextLines[idx] = line;
    });

    setLines(nextLines);
    cleared.forEach(clearRubro);
    Object.entries(qtyUpdates).forEach(([id, n]) => {
      const rr = rubroById(Number(id));
      if (!rr || !rr.isLockedByAux) handleQuantityChange(Number(id), n);
    });
  };

  const onCellKey = (e: React.KeyboardEvent<HTMLElement>, idx: number) => {
    if (e.key === "Enter" && !e.shiftKey && idx === lines.length - 1) {
      e.preventDefault();
      addLine();
      return;
    }
    if (e.key === "Delete" && e.ctrlKey) {
      e.preventDefault();
      deleteLine(lines[idx]);
      setTimeout(() => focusCell(GRID, Math.max(0, idx - 1), COL.periodo), 0);
      return;
    }
    if (e.key === "Insert" && e.ctrlKey) {
      e.preventDefault();
      addLine(idx);
      return;
    }
    gridKeyDown(e, lines.length);
  };

  const cellProps = (idx: number, c: number) => ({
    "data-grid": GRID,
    "data-r": idx,
    "data-c": c,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onCellKey(e, idx),
    onPaste: (e: React.ClipboardEvent) => handlePaste(e, idx, c),
  });

  // Totales en vivo del formulario
  const totalMontoPresente = rubroRows.reduce((sum, r) => {
    return sum + Math.round(r.cantidadPresente * r.unitPrice);
  }, 0);

  const itemsConMedicion = rubroRows.filter((r) => r.cantidadPresente > 0);
  const adicionales = lines.filter((l) => l.adicional && l.adicional.name.trim());
  const excedidos = rubroRows.filter(
    (r) => r.totalContractQuantity > 0 && r.cantidadAnterior + r.cantidadPresente > r.totalContractQuantity + 1e-9
  );

  // Observaciones por ítem y adicionales se guardan dentro de las notas de la medición
  const buildNotes = () => {
    const extra: string[] = [];
    lines.forEach((l) => {
      if (!l.obs.trim()) return;
      const r = rubroById(l.budgetItemId);
      const label = r ? r.code : l.adicional?.name || "—";
      extra.push(`[Obs ${label}] ${l.obs.trim()}`);
    });
    adicionales.forEach((l) => {
      const a = l.adicional!;
      extra.push(`[ADICIONAL] ${a.name.trim()} — ${formatQty(a.qty)} ${a.unit}`);
    });
    return [notes.trim(), ...extra].filter(Boolean).join("\n");
  };

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
        notes: buildNotes(),
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

  const th = "border border-slate-300 px-2 py-1.5 font-semibold";
  const td = "border border-slate-200";

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4">
        {/* Encabezado */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-black text-slate-900">Nueva medición</h2>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-slate-900 text-white">
                {nextNumberInfo.displayLabel}
              </span>
              <StatusSteps current={0} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-xs font-semibold text-slate-600 space-y-1">
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Obra</span>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                className="w-full text-xs rounded-md border border-slate-300 p-2 bg-white"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600 space-y-1">
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Tipo</span>
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
                className="w-full text-xs rounded-md border border-slate-300 p-2 bg-white"
              >
                <option value="OBRA_CLIENTE">Certificación al cliente</option>
                <option value="SUBCONTRATISTA">Medición a subcontratista</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600 space-y-1">
              <span>{tipo === "SUBCONTRATISTA" ? "Subcontratista *" : "Comitente"}</span>
              {tipo === "SUBCONTRATISTA" ? (
                <select
                  value={selectedPartnerId || ""}
                  onChange={(e) => setSelectedPartnerId(Number(e.target.value) || null)}
                  className="w-full text-xs rounded-md border border-blue-300 p-2 bg-blue-50/50"
                >
                  <option value="">Seleccione...</option>
                  {subcontractors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (RUC: {s.taxId})
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" disabled value="Comitente principal" className="w-full text-xs rounded-md border border-slate-200 p-2 bg-slate-100 text-slate-500" />
              )}
            </label>

            <label className="text-xs font-semibold text-slate-600 space-y-1">
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Fecha de corte</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full text-xs rounded-md border border-slate-300 p-1.5 bg-white"
              />
            </label>
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas generales de la medición (progresivas, frente, etc.)"
            className="w-full text-xs rounded-md border border-slate-300 px-3 py-2"
          />
        </div>

        {excedidos.length > 0 && (
          <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg px-4 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong>Supera el 100% contratado:</strong>{" "}
              {excedidos.map((r) => r.code).join(", ")}. Revisá las cantidades o cargalo como adicional.
            </div>
          </div>
        )}

        {/* Planilla */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">
              Tab / Enter / flechas para moverse · Pegá celdas desde Excel · Ctrl+Insert agrega fila · Ctrl+Supr elimina fila
            </span>
            <span className="flex items-center gap-3">
              <span className="text-slate-500">{itemsConMedicion.length} ítems medidos</span>
              <span className="font-bold text-emerald-700 font-mono">{formatGs(totalMontoPresente)} Gs.</span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-[11px]">
                  <th className={`${th} w-8`}>#</th>
                  <th className={`${th} w-32 text-left`}>Ítem</th>
                  <th className={`${th} text-left min-w-[220px]`}>Descripción</th>
                  <th className={`${th} w-14`}>Un.</th>
                  <th className={`${th} w-24 text-right`}>Cant. contratada</th>
                  <th className={`${th} w-24 text-right`}>Acum. anterior</th>
                  <th className={`${th} w-28 text-right bg-blue-100 text-blue-900`}>Período</th>
                  <th className={`${th} w-24 text-right`}>Acum. actual</th>
                  <th className={`${th} w-16 text-right`}>%</th>
                  <th className={`${th} min-w-[160px] text-left`}>Obs.</th>
                  <th className={`${th} w-24`}></th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {loadingRubros ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-500 font-sans">
                      Cargando rubros y acumulados...
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => {
                    const r = rubroById(line.budgetItemId);
                    const ad = line.adicional;
                    const contratada = r?.totalContractQuantity || 0;
                    const anterior = r?.cantidadAnterior || 0;
                    const periodo = r ? r.cantidadPresente : ad?.qty || 0;
                    const actual = anterior + periodo;
                    const pct = contratada > 0 ? (actual / contratada) * 100 : null;
                    const over = pct != null && pct > 100 + 1e-7;
                    const hasAux = !!r && r.auxiliaryCalculations.length > 0;
                    const hasPhotos = !!r && r.photos.length > 0;

                    return (
                      <React.Fragment key={line.key}>
                        <tr className={over ? "bg-red-50" : ad ? "bg-violet-50/60" : periodo > 0 ? "bg-blue-50/30" : ""}>
                          <td className={`${td} text-center text-slate-400 text-[11px] font-sans`}>{idx + 1}</td>
                          <td className={`${td} p-0`}>
                            <ItemCombo
                              cell={cellProps(idx, COL.item)}
                              line={line}
                              rubros={rubroRows}
                              usedIds={usedIds}
                              onPick={(id) => assignRubro(line, id)}
                              onAdicional={(name) => makeAdicional(line, name)}
                            />
                          </td>
                          <td className={`${td} ${ad ? "p-0" : "px-2 font-sans"}`}>
                            {ad ? (
                              <div className="flex items-center">
                                <span className="ml-2 text-[9px] font-sans font-bold uppercase bg-violet-600 text-white rounded px-1">
                                  Adicional
                                </span>
                                <input
                                  {...cellProps(idx, COL.desc)}
                                  type="text"
                                  value={ad.name}
                                  onChange={(e) => updateLine(line.key, { adicional: { ...ad, name: e.target.value } })}
                                  className={`${cellInputCls} font-sans`}
                                  placeholder="Descripción del ítem nuevo"
                                />
                              </div>
                            ) : (
                              <span className="text-slate-800">{r?.name || <em className="text-slate-400">Elegí un ítem…</em>}</span>
                            )}
                          </td>
                          <td className={`${td} text-center ${ad ? "p-0" : "font-sans text-slate-600"}`}>
                            {ad ? (
                              <input
                                {...cellProps(idx, COL.unit)}
                                type="text"
                                value={ad.unit}
                                onChange={(e) => updateLine(line.key, { adicional: { ...ad, unit: e.target.value } })}
                                className={`${cellInputCls} text-center font-sans`}
                              />
                            ) : (
                              r?.unit
                            )}
                          </td>
                          <td className={`${td} px-2 text-right text-slate-600`}>{r ? formatQty(contratada) : "—"}</td>
                          <td className={`${td} px-2 text-right text-slate-500 bg-slate-50`}>{r ? formatQty(anterior) : "—"}</td>
                          <td className={`${td} p-0 bg-blue-50/40 relative`}>
                            <NumCell
                              {...cellProps(idx, COL.periodo)}
                              value={periodo}
                              onValue={(n) => setPeriodo(line, n)}
                              readOnly={!!r?.isLockedByAux || (!r && !ad)}
                              title={r?.isLockedByAux ? "Calculado por el cómputo auxiliar" : undefined}
                              className={`${cellInputCls} text-right font-bold ${
                                r?.isLockedByAux ? "text-amber-800 pr-6" : "text-blue-900"
                              }`}
                            />
                            {r?.isLockedByAux && <Lock className="w-3 h-3 text-amber-600 absolute right-1.5 top-2" />}
                          </td>
                          <td className={`${td} px-2 text-right font-semibold ${over ? "text-red-700" : "text-slate-800"}`}>
                            {r || ad ? formatQty(actual) : ""}
                          </td>
                          <td className={`${td} px-2 text-right ${over ? "text-red-700 font-bold" : "text-slate-600"}`}>
                            {pct != null ? `${pct.toFixed(1)}%` : ""}
                            {over && <AlertTriangle className="inline w-3 h-3 ml-0.5 -mt-0.5" />}
                          </td>
                          <td className={`${td} p-0`}>
                            <input
                              {...cellProps(idx, COL.obs)}
                              type="text"
                              value={line.obs}
                              onChange={(e) => updateLine(line.key, { obs: e.target.value })}
                              className={`${cellInputCls} font-sans`}
                            />
                          </td>
                          <td className={`${td} px-1`}>
                            <div className="flex items-center justify-center gap-0.5 font-sans">
                              {r && (
                                <>
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => toggleAuxTable(r.budgetItemId)}
                                    className={`p-1 rounded cursor-pointer ${hasAux || r.isAuxOpen ? "text-amber-700 bg-amber-100" : "text-slate-400 hover:bg-slate-100"}`}
                                    title="Cómputo auxiliar"
                                  >
                                    <Calculator className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => setActivePhotoRubroId(r.budgetItemId)}
                                    className={`p-1 rounded cursor-pointer ${hasPhotos ? "text-blue-700 bg-blue-100" : "text-slate-400 hover:bg-slate-100"}`}
                                    title={hasPhotos ? `${r.photos.length} fotos` : "Fotos"}
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => deleteLine(line)}
                                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                title="Eliminar fila"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {r?.isAuxOpen && (
                          <tr>
                            <td colSpan={11} className="p-2 pl-10 bg-slate-50 border border-slate-200 font-sans">
                              <AuxiliaryCalculationSubtable
                                rubroCode={r.code}
                                rubroName={r.name}
                                rubroUnit={r.unit}
                                calculations={r.auxiliaryCalculations}
                                onChange={(calcs) => handleAuxCalculationsChange(r.budgetItemId, calcs)}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={11} className="border border-slate-200 p-0">
                    <button
                      type="button"
                      onClick={() => addLine()}
                      className="w-full text-left px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50 flex items-center gap-1 cursor-pointer font-sans"
                    >
                      <Plus className="w-3.5 h-3.5" /> Agregar fila
                    </button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {adicionales.length > 0 && (
            <div className="px-4 py-2 border-t border-violet-200 bg-violet-50 text-[11px] text-violet-900 flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {adicionales.length} ítem(s) adicional(es) fuera del presupuesto: se registran en las notas de la medición
                y no suman al monto certificado hasta que se den de alta en el presupuesto.
              </span>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-lg"
          >
            Cancelar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || itemsConMedicion.length === 0}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>
            <button
              type="button"
              disabled={saving || itemsConMedicion.length === 0}
              onClick={(e) => handleSubmit(e, true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {saving ? "Procesando..." : "Enviar a revisión"}
            </button>
          </div>
        </div>
      </form>

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

// ---------- Estados: Borrador → Revisión → Aprobado ----------
export const STATUS_STEPS = ["Borrador", "Revisión", "Aprobado"] as const;

export const statusStepIndex = (estado: string) =>
  estado === "APROBADO" ? 2 : estado === "MEDICION_BORRADOR" ? 0 : 1;

export const StatusSteps: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex items-center gap-1 text-[11px] font-semibold">
    {STATUS_STEPS.map((s, i) => (
      <React.Fragment key={s}>
        {i > 0 && <span className="text-slate-300">→</span>}
        <span
          className={`px-2 py-0.5 rounded-full border ${
            i === current
              ? i === 2
                ? "bg-emerald-600 text-white border-emerald-600"
                : i === 1
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-slate-700 text-white border-slate-700"
              : i < current
              ? "bg-slate-100 text-slate-500 border-slate-200"
              : "text-slate-400 border-slate-200"
          }`}
        >
          {s}
        </span>
      </React.Fragment>
    ))}
  </div>
);

// ---------- Select buscable de ítem ----------
interface ItemComboProps {
  cell: Record<string, any> & { onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void };
  line: SheetLine;
  rubros: FormRubroRow[];
  usedIds: Set<number>;
  onPick: (budgetItemId: number) => void;
  onAdicional: (name: string) => void;
}

const ItemCombo: React.FC<ItemComboProps> = ({ cell, line, rubros, usedIds, onPick, onAdicional }) => {
  const current = rubros.find((r) => r.budgetItemId === line.budgetItemId);
  const display = current ? current.code : line.adicional ? "NUEVO" : "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const options = rubros
    .filter((r) => r.budgetItemId === line.budgetItemId || !usedIds.has(r.budgetItemId))
    .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    .slice(0, 50);
  const total = options.length + 1; // + "Agregar ítem nuevo"

  const pick = (i: number) => {
    if (i < options.length) onPick(options[i].budgetItemId);
    else onAdicional(query.trim() || "Ítem nuevo");
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  return (
    <div className="relative">
      <input
        {...cell}
        type="text"
        autoComplete="off"
        value={open ? query : display}
        placeholder={open ? "Buscar código o nombre…" : ""}
        onFocus={() => setQuery("")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(total - 1, h + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); return; }
            if (e.key === "Enter" || e.key === "Tab") {
              if (query) { e.preventDefault(); pick(hi); return; }
            }
            if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
          } else if (e.key === "F2" || (e.altKey && e.key === "ArrowDown")) {
            e.preventDefault();
            setOpen(true);
            setHi(0);
            return;
          }
          cell.onKeyDown(e);
        }}
        onDoubleClick={() => { setOpen(true); setHi(0); }}
        className={`${cellInputCls} font-bold ${line.adicional ? "text-violet-700" : "text-slate-800"}`}
      />
      {open && (
        <ul
          ref={listRef}
          className="absolute z-30 left-0 top-full mt-0.5 w-80 max-h-64 overflow-auto bg-white border border-slate-300 rounded-md shadow-lg font-sans text-xs"
        >
          {options.map((r, i) => (
            <li
              key={r.budgetItemId}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setHi(i)}
              className={`px-2 py-1.5 cursor-pointer flex gap-2 ${i === hi ? "bg-blue-100" : ""}`}
            >
              <span className="font-mono font-bold w-16 shrink-0">{r.code}</span>
              <span className="truncate text-slate-700">{r.name}</span>
            </li>
          ))}
          {options.length === 0 && <li className="px-2 py-1.5 text-slate-400">Sin coincidencias</li>}
          <li
            onMouseDown={(e) => { e.preventDefault(); pick(options.length); }}
            onMouseEnter={() => setHi(options.length)}
            className={`px-2 py-1.5 cursor-pointer border-t border-slate-200 text-violet-700 font-semibold flex items-center gap-1 ${
              hi === options.length ? "bg-violet-100" : ""
            }`}
          >
            <Plus className="w-3.5 h-3.5" /> Agregar ítem nuevo{query.trim() ? `: “${query.trim()}”` : ""} (adicional)
          </li>
        </ul>
      )}
    </div>
  );
};
