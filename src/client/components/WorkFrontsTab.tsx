import React, { useState } from "react";
import {
  Truck,
  HardHat,
  MapPin,
  Fuel,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Wrench,
  Search,
  Plus,
} from "lucide-react";
import { WorkFront, Personnel, MachineryEquipment, Project } from "../types";

interface WorkFrontsTabProps {
  project?: Project | null;
  workFronts: WorkFront[];
  personnel: Personnel[];
}

// Initial realistic civil machinery for road projects
const INITIAL_MACHINERY: MachineryEquipment[] = [
  {
    id: "EQ-001",
    code: "MOTO-01",
    name: "Motoniveladora CAT 140M",
    type: "PESADA",
    brandModel: "Caterpillar 140M AWD",
    plateOrSeries: "CAT-140M-84920",
    workFrontId: 1,
    operatorName: "Marcos Centurión",
    status: "OPERATIVO",
    fuelConsumptionPerHour: 22,
    hourMeter: 4820,
  },
  {
    id: "EQ-002",
    code: "TERM-01",
    name: "Pavimentadora de Asfalto",
    type: "ASFALTO",
    brandModel: "Vögele Super 1800-3i",
    plateOrSeries: "VOG-1800-1102",
    workFrontId: 1,
    operatorName: "Rubén Giménez",
    status: "OPERATIVO",
    fuelConsumptionPerHour: 18,
    hourMeter: 2150,
  },
  {
    id: "EQ-003",
    code: "ROD-01",
    name: "Rodillo Compactador Tándem",
    type: "COMPACTACION",
    brandModel: "Hamm HD+ 90i VV",
    plateOrSeries: "HAMM-HD90-302",
    workFrontId: 1,
    operatorName: "Esteban Duarte",
    status: "OPERATIVO",
    fuelConsumptionPerHour: 14,
    hourMeter: 3410,
  },
  {
    id: "EQ-004",
    code: "VOLQ-04",
    name: "Camión Volquete 20m³",
    type: "TRANSPORTE",
    brandModel: "Scania G440 8x4",
    plateOrSeries: "HBF-492",
    workFrontId: 2,
    operatorName: "Carlos Almirón",
    status: "OPERATIVO",
    fuelConsumptionPerHour: 28,
    hourMeter: 6920,
  },
  {
    id: "EQ-005",
    code: "EXC-02",
    name: "Excavadora Oruga Hidráulica",
    type: "PESADA",
    brandModel: "Komatsu PC200-8",
    plateOrSeries: "KOM-PC200-994",
    workFrontId: 2,
    operatorName: "Arnaldo Benítez",
    status: "MANTENIMIENTO",
    fuelConsumptionPerHour: 20,
    hourMeter: 8100,
  },
  {
    id: "EQ-006",
    code: "DIST-01",
    name: "Camión Regador de Asfalto",
    type: "ASFALTO",
    brandModel: "Mercedes Benz Atego 1726",
    plateOrSeries: "WXY-115",
    workFrontId: 1,
    operatorName: "Héctor Romero",
    status: "OPERATIVO",
    fuelConsumptionPerHour: 16,
    hourMeter: 1980,
  },
];

export const WorkFrontsTab: React.FC<WorkFrontsTabProps> = ({
  project,
  workFronts,
  personnel,
}) => {
  const [machinery, setMachinery] = useState<MachineryEquipment[]>(INITIAL_MACHINERY);
  const [selectedFrontId, setSelectedFrontId] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMachinery = machinery.filter((m) => {
    const matchesFront = selectedFrontId === "ALL" || String(m.workFrontId) === selectedFrontId;
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.operatorName.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFront && matchesSearch;
  });

  const totalOperative = machinery.filter((m) => m.status === "OPERATIVO").length;
  const totalMaintenance = machinery.filter((m) => m.status === "MANTENIMIENTO").length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-600" />
            <h1 className="text-xl font-bold text-stone-900 font-display">
              Frentes de Obra & Parque de Maquinaria
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Asignación de equipos viales pesados por tramo kilométrico, horómetros y control de consumo.
          </p>
        </div>
      </div>

      {/* Work Fronts Geographic Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workFronts.map((wf) => {
          const chief = personnel.find((p) => p.id === wf.chiefId) || wf.chief;
          const assignedEquip = machinery.filter((m) => m.workFrontId === wf.id);

          return (
            <div
              key={wf.id}
              className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                    {wf.code}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Activo en Faena
                  </span>
                </div>

                <h3 className="text-base font-bold text-stone-900 mt-2">{wf.name}</h3>
                <div className="flex items-center gap-1.5 text-xs text-stone-500 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>
                    Obra: {project?.name} ({project?.roadSection || "Tramo Caaguazú"})
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-400">
                    Jefe de Frente a Cargo
                  </span>
                  <div className="font-semibold text-stone-800">
                    {chief?.fullName || "Ing. Residente"}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-stone-400">
                    Equipos Asignados
                  </span>
                  <div className="font-mono font-bold text-stone-900">
                    {assignedEquip.length} unidades
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Machinery Fleet Filter Bar */}
      <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por equipo, código (MOTO-01) u operador..."
            className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-xs outline-none focus:border-amber-500 transition"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedFrontId}
            onChange={(e) => setSelectedFrontId(e.target.value)}
            className="border border-stone-200 rounded-lg px-3 py-2 text-xs font-medium text-stone-700 bg-white"
          >
            <option value="ALL">Todos los Frentes</option>
            {workFronts.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded">
              {totalOperative} Operativos
            </span>
            {totalMaintenance > 0 && (
              <span className="px-2 py-1 bg-rose-100 text-rose-800 rounded">
                {totalMaintenance} Taller
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Machinery Fleet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMachinery.map((eq) => {
          const wf = workFronts.find((w) => w.id === eq.workFrontId);

          return (
            <div
              key={eq.id}
              className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm flex flex-col justify-between hover:border-amber-400 transition"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-extrabold text-stone-800 px-2 py-0.5 rounded bg-stone-100">
                    {eq.code}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      eq.status === "OPERATIVO"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-rose-50 text-rose-700 border border-rose-200"
                    }`}
                  >
                    {eq.status === "OPERATIVO" ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <Wrench className="w-3 h-3" />
                    )}
                    {eq.status}
                  </span>
                </div>

                <h3 className="font-bold text-stone-900 text-sm mt-2">{eq.name}</h3>
                <div className="text-xs text-stone-500">{eq.brandModel}</div>
                <div className="text-[11px] text-stone-400 font-mono mt-0.5">
                  Serie/Chapa: {eq.plateOrSeries}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 space-y-1 text-xs">
                <div className="flex items-center justify-between text-stone-600">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-stone-400" /> Frente:
                  </span>
                  <span className="font-semibold text-stone-800">{wf?.name || "Sin asignar"}</span>
                </div>
                <div className="flex items-center justify-between text-stone-600">
                  <span className="flex items-center gap-1">
                    <HardHat className="w-3 h-3 text-stone-400" /> Operador:
                  </span>
                  <span className="font-medium text-stone-800">{eq.operatorName}</span>
                </div>
                <div className="flex items-center justify-between text-stone-600">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-stone-400" /> Horómetro:
                  </span>
                  <span className="font-mono font-bold text-stone-900">{eq.hourMeter} hrs</span>
                </div>
                <div className="flex items-center justify-between text-stone-600">
                  <span className="flex items-center gap-1">
                    <Fuel className="w-3 h-3 text-stone-400" /> Consumo Promedio:
                  </span>
                  <span className="font-mono font-bold text-amber-700">
                    {eq.fuelConsumptionPerHour} L/hr
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
