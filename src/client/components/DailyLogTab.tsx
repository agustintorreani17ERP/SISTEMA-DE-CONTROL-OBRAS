import React, { useState } from "react";
import {
  BookOpen,
  CloudSun,
  Sun,
  CloudRain,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Calendar,
  Thermometer,
} from "lucide-react";
import { DailySiteLog, WorkFront, Project } from "../types";
import { formatDate } from "../utils/format";

interface DailyLogTabProps {
  project?: Project | null;
  workFronts: WorkFront[];
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const INITIAL_LOGS: DailySiteLog[] = [
  {
    id: "LOG-001",
    date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    workFrontId: 1,
    weather: "DESPEJADO",
    temperatureC: 31,
    workStatus: "NORMAL",
    directLaborCount: 24,
    subcontractorLaborCount: 18,
    hoursWorked: 9.5,
    activitiesDescription:
      "Distribución y compactación de base granular estabilizada en calzada este (Km 133+400 al Km 134+200). Prueba de densidad in situ satisfactoria con 98.4% Proctor modificado.",
    incidentsOrDelays: "Sin incidentes ni demoras climáticas.",
    supervisorName: "Ing. Carlos Mendoza (Jefe de Obra)",
  },
  {
    id: "LOG-002",
    date: new Date(Date.now() - 172800000).toISOString().slice(0, 10),
    workFrontId: 2,
    weather: "NUBLADO",
    temperatureC: 27,
    workStatus: "NORMAL",
    directLaborCount: 16,
    subcontractorLaborCount: 12,
    hoursWorked: 8.0,
    activitiesDescription:
      "Armado de encofrado y colocación de armaduras para cabezal de alcantarilla triple en Km 148+100. Excavación mecánica para drenaje longitudinal.",
    incidentsOrDelays: "Llovizna intermitente en horario vespertino no paralizó actividades.",
    supervisorName: "Ing. Carlos Mendoza",
  },
  {
    id: "LOG-003",
    date: new Date(Date.now() - 259200000).toISOString().slice(0, 10),
    workFrontId: 1,
    weather: "LLUVIA_INTENSA_PARALIZADA",
    temperatureC: 22,
    workStatus: "SUSPENDIDA",
    directLaborCount: 10,
    subcontractorLaborCount: 0,
    hoursWorked: 3.5,
    activitiesDescription:
      "Faena suspendida a las 10:30 hs por precipitaciones intensas (48 mm acumulados). Se resguardaron equipos y se protegió la subrasante con cunetas temporales.",
    incidentsOrDelays: "Paralización por lluvia. Reanudación sujeta a secado de terraplén.",
    supervisorName: "Ing. Carlos Mendoza",
  },
];

export const DailyLogTab: React.FC<DailyLogTabProps> = ({
  project,
  workFronts,
  showToast,
}) => {
  const [logs, setLogs] = useState<DailySiteLog[]>(INITIAL_LOGS);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    workFrontId: workFronts[0]?.id || 1,
    weather: "DESPEJADO" as const,
    temperatureC: 30,
    workStatus: "NORMAL" as const,
    directLaborCount: 22,
    subcontractorLaborCount: 15,
    hoursWorked: 9,
    activitiesDescription: "",
    incidentsOrDelays: "",
    supervisorName: "Ing. Residente de Obra",
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.activitiesDescription.trim()) {
      showToast("Ingresa la descripción de actividades ejecutadas", "error");
      return;
    }

    const newLog: DailySiteLog = {
      id: `LOG-${String(logs.length + 1).padStart(3, "0")}`,
      ...form,
    };

    setLogs([newLog, ...logs]);
    showToast("Parte diario de obra asentado exitosamente en bitácora");
    setShowModal(false);
  };

  const getWeatherIcon = (w: string) => {
    switch (w) {
      case "DESPEJADO":
        return <Sun className="w-4 h-4 text-amber-500" />;
      case "NUBLADO":
        return <CloudSun className="w-4 h-4 text-stone-500" />;
      case "LLUVIA_LEVE":
      case "LLUVIA_INTENSA_PARALIZADA":
        return <CloudRain className="w-4 h-4 text-blue-500" />;
      default:
        return <Sun className="w-4 h-4 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-600" />
            <h1 className="text-xl font-bold text-stone-900 font-display">
              Parte Diario de Obra & Bitácora de Faena
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Registro oficial de condiciones climáticas, dotación de personal en faena y avance de actividades por tramo.
          </p>
        </div>

        <button
          id="btn-open-new-daily-log"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 active:scale-95 text-white rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4 text-amber-400" />
          <span>Asentar Parte Diario</span>
        </button>
      </div>

      {/* Daily Logs Timeline Cards */}
      <div className="space-y-4">
        {logs.map((log) => {
          const wf = workFronts.find((w) => w.id === log.workFrontId);

          return (
            <div
              key={log.id}
              className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm space-y-3"
            >
              {/* Card Top Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-stone-100 text-stone-800">
                    {log.id}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-stone-900">
                    <Calendar className="w-3.5 h-3.5 text-stone-500" />
                    <span>{formatDate(log.date)}</span>
                  </div>
                  <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                    {wf?.name || `Frente #${log.workFrontId}`}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-stone-600">
                    {getWeatherIcon(log.weather)}
                    <span className="capitalize">{log.weather.replace(/_/g, " ").toLowerCase()}</span>
                  </span>
                  <span className="flex items-center gap-1 text-stone-600 font-mono">
                    <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                    {log.temperatureC}°C
                  </span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded-full text-[11px] ${
                      log.workStatus === "NORMAL"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-rose-50 text-rose-700 border border-rose-200"
                    }`}
                  >
                    {log.workStatus === "NORMAL" ? "Jornada Normal" : "Faena Suspendida"}
                  </span>
                </div>
              </div>

              {/* Card Activity Description */}
              <div className="text-xs text-stone-800 leading-relaxed font-normal">
                {log.activitiesDescription}
              </div>

              {/* Incidents or Delays if present */}
              {log.incidentsOrDelays && (
                <div className="text-xs p-2.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold">Observaciones / Demoras:</strong>{" "}
                    {log.incidentsOrDelays}
                  </div>
                </div>
              )}

              {/* Footer with Labor & Hours */}
              <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3 text-[11px] text-stone-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-stone-400" />
                    Personal Propio: <strong className="text-stone-800 font-mono">{log.directLaborCount}</strong>
                  </span>
                  <span>
                    Subcontratistas: <strong className="text-stone-800 font-mono">{log.subcontractorLaborCount}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    Horas Faena: <strong className="text-stone-800 font-mono">{log.hoursWorked} hrs</strong>
                  </span>
                </div>
                <div className="italic text-stone-600">
                  Firmado por: {log.supervisorName}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Log Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-stone-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-stone-900">
                  Asentar Parte Diario de Faena
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-stone-400 hover:text-stone-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha de Jornada
                  </label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Frente de Obra
                  </label>
                  <select
                    value={form.workFrontId}
                    onChange={(e) => setForm({ ...form, workFrontId: Number(e.target.value) })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-medium bg-white"
                  >
                    {workFronts.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.code} — {wf.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Clima</label>
                  <select
                    value={form.weather}
                    onChange={(e) => setForm({ ...form, weather: e.target.value as any })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-medium bg-white"
                  >
                    <option value="DESPEJADO">Despejado</option>
                    <option value="NUBLADO">Nublado</option>
                    <option value="LLUVIA_LEVE">Lluvia leve</option>
                    <option value="LLUVIA_INTENSA_PARALIZADA">Lluvia Intensa (Paralizada)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Temp (°C)</label>
                  <input
                    type="number"
                    value={form.temperatureC}
                    onChange={(e) => setForm({ ...form, temperatureC: parseInt(e.target.value) || 25 })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Estado Faena</label>
                  <select
                    value={form.workStatus}
                    onChange={(e) => setForm({ ...form, workStatus: e.target.value as any })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-medium bg-white"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="PARCIAL">Parcial</option>
                    <option value="SUSPENDIDA">Suspendida</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Personal Propio
                  </label>
                  <input
                    type="number"
                    value={form.directLaborCount}
                    onChange={(e) => setForm({ ...form, directLaborCount: parseInt(e.target.value) || 0 })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Subcontratistas
                  </label>
                  <input
                    type="number"
                    value={form.subcontractorLaborCount}
                    onChange={(e) =>
                      setForm({ ...form, subcontractorLaborCount: parseInt(e.target.value) || 0 })
                    }
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Horas Trabajadas
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.hoursWorked}
                    onChange={(e) => setForm({ ...form, hoursWorked: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-stone-300 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Descripción Detallada de Tareas Ejecutadas
                </label>
                <textarea
                  rows={3}
                  value={form.activitiesDescription}
                  onChange={(e) => setForm({ ...form, activitiesDescription: e.target.value })}
                  placeholder="Progresiva Km, capas colocadas, ensayos realizados..."
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Observaciones / Incidentes
                </label>
                <input
                  type="text"
                  value={form.incidentsOrDelays}
                  onChange={(e) => setForm({ ...form, incidentsOrDelays: e.target.value })}
                  placeholder="Detalles sobre demoras, fallas mecánicas o inspecciones..."
                  className="w-full border border-stone-300 rounded-lg p-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold hover:bg-stone-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold transition"
                >
                  Guardar en Bitácora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
