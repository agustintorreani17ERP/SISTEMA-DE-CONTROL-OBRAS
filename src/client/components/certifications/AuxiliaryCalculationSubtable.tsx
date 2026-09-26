import React from "react";
import { Plus, Trash2, Calculator, Info } from "lucide-react";
import { AuxiliaryCalculation } from "../../types";
import { NumCell, cellInputCls, focusCell, gridKeyDown, parseNum, readPastedMatrix } from "./sheetGrid";

import { formatQty } from "../../utils/numbers";
interface AuxiliaryCalculationSubtableProps {
  rubroCode: string;
  rubroName: string;
  rubroUnit: string;
  calculations: AuxiliaryCalculation[];
  onChange: (calculations: AuxiliaryCalculation[]) => void;
  readOnly?: boolean;
}

// Columnas editables: 0 Descripción, 1 Largo, 2 Ancho, 3 Alto, 4 Piezas, 5 Descuento
const FIELDS: (keyof AuxiliaryCalculation)[] = [
  "descripcion",
  "largo",
  "ancho",
  "alto",
  "factor_repeticion",
  "isDeduction",
];

const computeSubtotal = (row: AuxiliaryCalculation) => {
  const l = Number(row.largo || 0);
  const a = Number(row.ancho || 0);
  const h = Number(row.alto || 0);
  const f = Number(row.factor_repeticion || 1);
  const v = Number((l * a * h * f).toFixed(4));
  return row.isDeduction ? -v : v;
};

const newRow = (n: number): AuxiliaryCalculation => ({
  descripcion: `Tramo / Eje ${n}`,
  largo: 1,
  ancho: 1,
  alto: 1,
  factor_repeticion: 1,
  subtotal: 1,
  isDeduction: false,
});

export const AuxiliaryCalculationSubtable: React.FC<AuxiliaryCalculationSubtableProps> = ({
  rubroCode,
  rubroName,
  rubroUnit,
  calculations,
  onChange,
  readOnly = false,
}) => {
  const grid = `aux-${rubroCode}`;

  const setField = (row: AuxiliaryCalculation, field: keyof AuxiliaryCalculation, raw: any) => {
    let value: any = raw;
    if (field === "isDeduction") {
      value = typeof raw === "boolean" ? raw : /^(s|si|sí|x|1|true|-)$/i.test(String(raw).trim());
    } else if (field === "factor_repeticion") {
      value = typeof raw === "number" ? raw : parseNum(raw) || 1;
    } else if (field !== "descripcion") {
      value = typeof raw === "number" ? raw : parseNum(raw);
    }
    const updated = { ...row, [field]: value };
    updated.subtotal = computeSubtotal(updated);
    return updated;
  };

  const handleUpdateRow = (index: number, field: keyof AuxiliaryCalculation, value: any) => {
    const updated = [...calculations];
    updated[index] = setField(updated[index], field, value);
    onChange(updated);
  };

  const handleAddRow = () => {
    onChange([...calculations, newRow(calculations.length + 1)]);
    setTimeout(() => focusCell(grid, calculations.length, 0), 0);
  };

  const handleDeleteRow = (index: number) => {
    onChange(calculations.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const matrix = readPastedMatrix(e);
    if (!matrix) return;
    e.preventDefault();
    const updated = [...calculations];
    matrix.forEach((cells, i) => {
      const idx = r + i;
      if (!updated[idx]) updated[idx] = newRow(idx + 1);
      cells.forEach((val, j) => {
        const field = FIELDS[c + j];
        if (field) updated[idx] = setField(updated[idx], field, val);
      });
    });
    onChange(updated);
  };

  const onKey = (e: React.KeyboardEvent<HTMLElement>, idx: number) => {
    // Enter en la última fila agrega una nueva línea
    if (e.key === "Enter" && !e.shiftKey && idx === calculations.length - 1 && !readOnly) {
      e.preventDefault();
      handleAddRow();
      return;
    }
    gridKeyDown(e, calculations.length);
  };

  const totalSuma = calculations.reduce((sum, c) => sum + (Number(c.subtotal) || 0), 0);

  const cellProps = (idx: number, c: number) => ({
    "data-grid": grid,
    "data-r": idx,
    "data-c": c,
    disabled: readOnly,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onKey(e, idx),
    onPaste: (e: React.ClipboardEvent) => handlePaste(e, idx, c),
  });

  return (
    <div className="bg-white rounded-lg border border-amber-300 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
        <div className="flex items-center gap-2 text-xs">
          <Calculator className="w-4 h-4 text-amber-700" />
          <span className="font-mono font-bold text-amber-900">{rubroCode}</span>
          <span className="font-semibold text-slate-700">Cómputo auxiliar</span>
          <span className="text-slate-500 truncate max-w-md">— {rubroName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">
            Suma al período:{" "}
            <strong className="font-mono text-amber-800">
              {formatQty(totalSuma)} {rubroUnit}
            </strong>
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddRow}
              className="px-2 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Fila
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-[11px] font-semibold">
              <th className="border border-slate-200 px-2 py-1 w-8">#</th>
              <th className="border border-slate-200 px-2 py-1 text-left min-w-[200px]">Descripción / Eje</th>
              <th className="border border-slate-200 px-2 py-1 w-24 text-right">L</th>
              <th className="border border-slate-200 px-2 py-1 w-24 text-right">A</th>
              <th className="border border-slate-200 px-2 py-1 w-24 text-right">H</th>
              <th className="border border-slate-200 px-2 py-1 w-20 text-right">Piezas</th>
              <th className="border border-slate-200 px-2 py-1 w-16 text-center" title="Marcar para restar (vanos, huecos, etc.)">
                Desc.
              </th>
              <th className="border border-slate-200 px-2 py-1 w-28 text-right">Parcial ({rubroUnit})</th>
              {!readOnly && <th className="border border-slate-200 w-8"></th>}
            </tr>
          </thead>
          <tbody className="font-mono">
            {calculations.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 8 : 9} className="py-4 text-center text-slate-400 font-sans">
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" /> Sin desglose.
                    {!readOnly && (
                      <button type="button" onClick={handleAddRow} className="text-amber-700 font-semibold hover:underline cursor-pointer">
                        Agregar primera fila
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ) : (
              calculations.map((row, idx) => (
                <tr key={idx} className={row.isDeduction ? "bg-red-50/60" : ""}>
                  <td className="border border-slate-200 text-center text-slate-400 text-[11px]">{idx + 1}</td>
                  <td className="border border-slate-200 p-0">
                    <input
                      {...cellProps(idx, 0)}
                      type="text"
                      value={row.descripcion}
                      onChange={(e) => handleUpdateRow(idx, "descripcion", e.target.value)}
                      className={`${cellInputCls} font-sans`}
                    />
                  </td>
                  {(["largo", "ancho", "alto", "factor_repeticion"] as const).map((f, k) => (
                    <td key={f} className="border border-slate-200 p-0">
                      <NumCell
                        {...cellProps(idx, k + 1)}
                        value={Number(row[f] || 0)}
                        onValue={(n) => handleUpdateRow(idx, f, n)}
                        className={`${cellInputCls} text-right`}
                      />
                    </td>
                  ))}
                  <td className="border border-slate-200 text-center">
                    <input
                      {...cellProps(idx, 5)}
                      type="checkbox"
                      checked={Boolean(row.isDeduction)}
                      onChange={(e) => handleUpdateRow(idx, "isDeduction", e.target.checked)}
                      className="accent-red-600 cursor-pointer"
                    />
                  </td>
                  <td
                    className={`border border-slate-200 px-2 text-right font-bold ${
                      Number(row.subtotal) < 0 ? "text-red-700" : "text-slate-800"
                    }`}
                  >
                    {formatQty(Number(row.subtotal || 0))}
                  </td>
                  {!readOnly && (
                    <td className="border border-slate-200 text-center">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => handleDeleteRow(idx)}
                        className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
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
              <tr className="bg-amber-50 font-bold">
                <td colSpan={7} className="border border-slate-200 px-2 py-1.5 text-right text-slate-600">
                  Total
                </td>
                <td className="border border-slate-200 px-2 text-right font-mono text-amber-800">
                  {formatQty(totalSuma)}
                </td>
                {!readOnly && <td className="border border-slate-200"></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!readOnly && (
        <p className="px-3 py-1.5 text-[10px] text-slate-500 border-t border-slate-100">
          Parcial = L × A × H × Piezas (negativo si es descuento). Enter en la última fila agrega otra. Podés pegar celdas desde Excel.
        </p>
      )}
    </div>
  );
};
