import React, { useState, useEffect, useRef } from "react";
import { Save, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { Project, Empleado, Asistencia, AsistenciaEstado, ImputableItem } from "../../types";
import { Page, Button, Card, EmptyState } from "../../ui";
import { NumCell, cellInputCls, gridKeyDown, readPastedMatrix, parseNum } from "../certifications/sheetGrid";

const ESTADO_OPTS: AsistenciaEstado[] = ["PRESENTE", "AUSENTE", "MEDIA_JORNADA", "FERIADO"];
const ESTADO_SHORT: Record<AsistenciaEstado, string> = {
  PRESENTE: "P",
  AUSENTE: "A",
  MEDIA_JORNADA: "½",
  FERIADO: "F",
};
const ESTADO_CLS: Record<AsistenciaEstado, string> = {
  PRESENTE: "text-emerald-700 bg-emerald-50",
  AUSENTE: "text-red-700 bg-red-50",
  MEDIA_JORNADA: "text-amber-700 bg-amber-50",
  FERIADO: "text-slate-600 bg-slate-100",
};

// Genera array de días del mes
function daysInMonth(year: number, month: number) {
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => i + 1);
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type RowData = {
  empleado: Empleado;
  /** dia (1-based) → asistencia editada */
  days: Record<number, Partial<Asistencia>>;
};

interface Props {
  project: Project;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const AsistenciaTab: React.FC<Props> = ({ project, showToast }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [items, setItems] = useState<ImputableItem[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const GRID = "asis";

  const days = daysInMonth(year, month);

  const load = async () => {
    const [emps, asis, its] = await Promise.all([
      api.getEmpleados(project.id),
      api.getAsistencias({ projectId: project.id }),
      api.getImputableItems(project.id),
    ]);
    setEmpleados(emps);
    setItems(its);
    // Construir matriz
    const rowMap: Record<number, RowData> = {};
    emps.filter((e: Empleado) => e.activo).forEach((e: Empleado) => {
      rowMap[e.id] = { empleado: e, days: {} };
    });
    (asis as Asistencia[]).forEach((a) => {
      const d = new Date(a.fecha);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      if (rowMap[a.empleadoId]) {
        rowMap[a.empleadoId].days[day] = a;
      }
    });
    setRows(Object.values(rowMap));
    setDirty(false);
  };

  useEffect(() => { load(); }, [project.id, year, month]);

  const updateCell = (empleadoId: number, day: number, patch: Partial<Asistencia>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.empleado.id !== empleadoId) return r;
        const existing = r.days[day] || { estado: "PRESENTE", horasNormales: 8, horasExtra: 0, jornal: 0 };
        return { ...r, days: { ...r.days, [day]: { ...existing, ...patch } } };
      })
    );
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const batch: any[] = [];
      rows.forEach((r) => {
        Object.entries(r.days).forEach(([dayStr, a]) => {
          const day = Number(dayStr);
          batch.push({
            empleadoId: r.empleado.id,
            projectId: project.id,
            budgetItemId: (a as any).budgetItemId || null,
            fecha: isoDate(year, month, day),
            estado: a.estado || "PRESENTE",
            horasNormales: Number(a.horasNormales ?? 8),
            horasExtra: Number(a.horasExtra ?? 0),
            jornal: Number(a.jornal ?? 0),
            notas: (a as any).notas || null,
          });
        });
      });
      if (batch.length > 0) {
        await api.saveAsistenciaBatch(batch);
      }
      showToast("Asistencia guardada", "success");
      setDirty(false);
    } catch (e: any) {
      showToast(e.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  const totalPresentes = rows.reduce((sum, r) => sum + Object.values(r.days).filter(d => d.estado === "PRESENTE").length, 0);
  const totalHorasExtra = rows.reduce((sum, r) => Object.values(r.days).reduce((s2, d) => s2 + Number(d.horasExtra || 0), sum), 0);

  return (
    <div className="space-y-3">
      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm font-bold text-slate-800 min-w-[110px] text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          <button onClick={load} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Presentes: <strong className="text-emerald-700">{totalPresentes}</strong></span>
          <span>Hs. extra: <strong className="text-amber-700">{totalHorasExtra}</strong></span>
        </div>
        <Button
          variant="primary"
          icon={<Save className="w-4 h-4" />}
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? "Guardando…" : "Guardar planilla"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Sin personal activo" help="Agregá empleados en el tab Legajo." />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto max-h-[70vh] relative">
            <table className="text-[11px] border-collapse w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-800 text-white">
                  <th className="sticky left-0 z-20 bg-slate-800 px-3 py-2 text-left min-w-[160px]">Empleado</th>
                  {days.map((d) => {
                    const dow = new Date(year, month, d).getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <th key={d} className={`px-1 py-2 text-center w-8 ${isWeekend ? "bg-slate-700 text-slate-300" : ""}`}>
                        <div>{d}</div>
                        <div className="text-[9px] text-slate-400">{["D", "L", "M", "X", "J", "V", "S"][dow]}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-right w-16 bg-slate-900">Hs N</th>
                  <th className="px-2 py-2 text-right w-16 bg-slate-900">Hs X</th>
                  <th className="px-2 py-2 text-right w-20 bg-slate-900">Rubro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, ri) => {
                  const totalHN = Object.values(row.days).reduce((s, d) => s + Number(d.horasNormales || 0), 0);
                  const totalHX = Object.values(row.days).reduce((s, d) => s + Number(d.horasExtra || 0), 0);
                  const rubroId = Object.values(row.days).find(d => (d as any).budgetItemId)?.budgetItemId as number | undefined;
                  const rubroItem = items.find(i => i.id === rubroId);

                  return (
                    <tr key={row.empleado.id} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">
                        <div>{row.empleado.fullName}</div>
                        <div className="text-[10px] text-slate-400">{row.empleado.oficio}</div>
                      </td>
                      {days.map((d) => {
                        const cell = row.days[d];
                        const estado = (cell?.estado || "PRESENTE") as AsistenciaEstado;
                        const dow = new Date(year, month, d).getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        return (
                          <td key={d} className={`border border-slate-100 text-center p-0 ${isWeekend ? "bg-slate-50" : ""}`}>
                            <select
                              value={estado}
                              onChange={(e) => updateCell(row.empleado.id, d, { estado: e.target.value as AsistenciaEstado })}
                              className={`w-8 h-8 text-center text-[11px] font-bold border-0 bg-transparent outline-none cursor-pointer ${ESTADO_CLS[estado]}`}
                              title={estado}
                            >
                              {ESTADO_OPTS.map((o) => (
                                <option key={o} value={o}>{ESTADO_SHORT[o]} — {o}</option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      {/* Totals */}
                      <td className="px-2 text-right font-mono bg-slate-50 text-slate-700">{totalHN}</td>
                      <td className="px-2 text-right font-mono bg-amber-50 text-amber-800">{totalHX}</td>
                      <td className="px-1 bg-slate-50">
                        <select
                          className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white"
                          value={rubroId || ""}
                          onChange={(e) => {
                            const id = Number(e.target.value) || null;
                            days.forEach(d => {
                              if (row.days[d]) updateCell(row.empleado.id, d, { budgetItemId: id } as any);
                            });
                          }}
                        >
                          <option value="">Sin rubro</option>
                          {items.map(i => (
                            <option key={i.id} value={i.id}>{i.code} {i.name.substring(0, 20)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Leyenda */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[10px]">
            {ESTADO_OPTS.map(e => (
              <span key={e} className={`font-bold px-1.5 py-0.5 rounded ${ESTADO_CLS[e]}`}>
                {ESTADO_SHORT[e]} = {e.replace("_", " ")}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
