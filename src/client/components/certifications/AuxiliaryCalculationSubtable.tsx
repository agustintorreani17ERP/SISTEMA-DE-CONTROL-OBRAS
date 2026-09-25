import React from "react";
import { Plus, Trash2, Calculator, Lock, Info } from "lucide-react";
import { AuxiliaryCalculation } from "../../types";

interface AuxiliaryCalculationSubtableProps {
  rubroCode: string;
  rubroName: string;
  rubroUnit: string;
  calculations: AuxiliaryCalculation[];
  onChange: (calculations: AuxiliaryCalculation[]) => void;
  readOnly?: boolean;
}

export const AuxiliaryCalculationSubtable: React.FC<AuxiliaryCalculationSubtableProps> = ({
  rubroCode,
  rubroName,
  rubroUnit,
  calculations,
  onChange,
  readOnly = false,
}) => {
  const handleAddRow = () => {
    const newRow: AuxiliaryCalculation = {
      descripcion: `Tramo / Eje ${calculations.length + 1}`,
      largo: 1,
      ancho: 1,
      alto: 1,
      factor_repeticion: 1,
      subtotal: 1,
    };
    onChange([...calculations, newRow]);
  };

  const handleUpdateRow = (index: number, field: keyof AuxiliaryCalculation, value: any) => {
    const updated = [...calculations];
    const row = { ...updated[index], [field]: value };

    // Recalcular subtotal: largo * ancho * alto * factor
    const l = Number(field === "largo" ? value : row.largo || 0);
    const a = Number(field === "ancho" ? value : row.ancho || 0);
    const h = Number(field === "alto" ? value : row.alto || 0);
    const f = Number(field === "factor_repeticion" ? value : row.factor_repeticion || 1);

    row.subtotal = Number((l * a * h * f).toFixed(4));
    updated[index] = row;
    onChange(updated);
  };

  const handleDeleteRow = (index: number) => {
    const updated = calculations.filter((_, i) => i !== index);
    onChange(updated);
  };

  const totalSuma = calculations.reduce((sum, c) => sum + (Number(c.subtotal) || 0), 0);

  return (
    <div className="bg-slate-900 text-slate-100 rounded-xl p-4 my-2 border border-slate-700 shadow-xl space-y-4">
      {/* Header bar of mini spreadsheet */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700/50 px-2 py-0.5 rounded-sm">
                {rubroCode}
              </span>
              <h4 className="text-sm font-bold text-white tracking-tight">
                Planilla de Cómputo Auxiliar (Largo × Ancho × Alto × Factor)
              </h4>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-lg">
              {rubroName} — Unidad de medida: <strong className="text-slate-200">{rubroUnit}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800/90 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-slate-300">Cantidad resultante bloqueada:</span>
            <span className="text-sm font-bold text-amber-300 font-mono">
              {totalSuma.toLocaleString("es-PY", { maximumFractionDigits: 3 })} {rubroUnit}
            </span>
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={handleAddRow}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva Línea
            </button>
          )}
        </div>
      </div>

      {/* Embedded spreadsheet table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-slate-800/80 text-slate-300 font-semibold border-b border-slate-700 text-[11px] uppercase tracking-wider">
              <th className="py-2 px-3 w-10 text-center text-slate-400">#</th>
              <th className="py-2 px-3 min-w-[200px]">Descripción / Eje / Progresiva</th>
              <th className="py-2 px-3 w-28 text-right">Largo (m)</th>
              <th className="py-2 px-3 w-28 text-right">Ancho (m)</th>
              <th className="py-2 px-3 w-28 text-right">Alto / Espesor (m)</th>
              <th className="py-2 px-3 w-24 text-right">Cant. Veces</th>
              <th className="py-2 px-3 w-32 text-right text-emerald-400 font-bold">Subtotal ({rubroUnit})</th>
              {!readOnly && <th className="py-2 px-2 w-12 text-center">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 font-mono">
            {calculations.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 7 : 8} className="py-6 text-center text-slate-400 font-sans">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <Info className="w-4 h-4 text-slate-500" />
                    <p className="text-xs">No hay desglose auxiliar en este rubro.</p>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={handleAddRow}
                        className="text-xs text-emerald-400 hover:underline font-semibold mt-1 cursor-pointer"
                      >
                        + Agregar la primera línea de cálculo
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              calculations.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                  <td className="py-2 px-3 text-center text-slate-500 text-[11px]">{idx + 1}</td>
                  <td className="py-1.5 px-3">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={row.descripcion}
                      onChange={(e) => handleUpdateRow(idx, "descripcion", e.target.value)}
                      placeholder="Identificación del elemento..."
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 text-xs font-sans focus:outline-hidden focus:border-emerald-500 disabled:opacity-75"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={readOnly}
                      value={row.largo}
                      onChange={(e) => handleUpdateRow(idx, "largo", parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 text-xs focus:outline-hidden focus:border-emerald-500 disabled:opacity-75"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={readOnly}
                      value={row.ancho}
                      onChange={(e) => handleUpdateRow(idx, "ancho", parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 text-xs focus:outline-hidden focus:border-emerald-500 disabled:opacity-75"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={readOnly}
                      value={row.alto}
                      onChange={(e) => handleUpdateRow(idx, "alto", parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 text-xs focus:outline-hidden focus:border-emerald-500 disabled:opacity-75"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      disabled={readOnly}
                      value={row.factor_repeticion}
                      onChange={(e) =>
                        handleUpdateRow(idx, "factor_repeticion", parseInt(e.target.value, 10) || 1)
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 text-xs focus:outline-hidden focus:border-emerald-500 disabled:opacity-75"
                    />
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-400 font-bold text-xs bg-emerald-950/20">
                    {Number(row.subtotal || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 })}
                  </td>
                  {!readOnly && (
                    <td className="py-2 px-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(idx)}
                        className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-950/40 transition-colors cursor-pointer"
                        title="Eliminar fila"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {calculations.length > 0 && (
            <tfoot>
              <tr className="bg-slate-800/90 font-bold border-t border-slate-700 text-xs">
                <td colSpan={6} className="py-2.5 px-3 text-right text-slate-300 uppercase tracking-wider font-sans">
                  Total Cómputo Auxiliar Sumado:
                </td>
                <td className="py-2.5 px-3 text-right text-emerald-300 text-sm font-mono bg-emerald-950/40 border-l border-emerald-900">
                  {totalSuma.toLocaleString("es-PY", { maximumFractionDigits: 3 })} {rubroUnit}
                </td>
                {!readOnly && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-400" />
          Fórmula aplicada: <code>Subtotal = Largo × Ancho × Alto × Cant. Veces</code>.
        </span>
        <span className="text-slate-500">
          Los valores son certificados con valor legal de respaldo para la medición de campo.
        </span>
      </div>
    </div>
  );
};
