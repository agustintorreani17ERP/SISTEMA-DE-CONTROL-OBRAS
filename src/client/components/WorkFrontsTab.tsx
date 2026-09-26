import React, { useState } from "react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Personnel, Project, WorkFront } from "../types";
import { Button, Card, EmptyState, Field, inputClass, Modal } from "../ui";

interface WorkFrontsTabProps {
  project?: Project | null;
  workFronts: WorkFront[];
  personnel: Personnel[];
  onRefresh?: () => void;
  showToast?: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Frentes de obra (sectores): se usan para ubicar pedidos y partes diarios. */
export const WorkFrontsTab: React.FC<WorkFrontsTabProps> = ({ project, workFronts, personnel, onRefresh, showToast }) => {
  const [editing, setEditing] = useState<{ id?: number; name: string; chiefId: number | "" } | null>(null);
  const fronts = workFronts.filter((w) => !project || w.projectId === project.id);
  const toast = showToast ?? (() => undefined);

  const save = async () => {
    if (!project || !editing?.name.trim()) return;
    try {
      if (editing.id) await api.updateWorkFront(editing.id, { name: editing.name.trim(), chiefId: editing.chiefId || null });
      else await api.createWorkFront({ projectId: project.id, name: editing.name.trim(), chiefId: editing.chiefId || null });
      toast(editing.id ? "Frente actualizado" : "Frente creado");
      setEditing(null);
      onRefresh?.();
    } catch (err: any) {
      toast(err.message || "No se pudo guardar el frente", "error");
    }
  };

  const remove = async (front: WorkFront) => {
    if (!window.confirm(`¿Borrar el frente "${front.name}"?`)) return;
    try {
      await api.deleteWorkFront(front.id);
      toast("Frente borrado");
      onRefresh?.();
    } catch (err: any) {
      toast(err.message || "No se pudo borrar", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ name: "", chiefId: "" })}>
          Nuevo frente
        </Button>
      </div>

      {fronts.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          title="La obra todavía no tiene frentes"
          help="Un frente es un sector de la obra (Bloque A, planta baja, acceso…). Sirve para ubicar pedidos y partes diarios."
          action={
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ name: "", chiefId: "" })}>
              Nuevo frente
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {fronts.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3.5">
                <MapPin className="h-4 w-4 text-slate-400" />
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{f.name}</p>
                  <p className="text-xs text-slate-500">
                    Responsable: {f.chief?.fullName ?? personnel.find((p) => p.id === f.chiefId)?.fullName ?? "sin asignar"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing({ id: f.id, name: f.name, chiefId: f.chiefId ?? "" })}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(f)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Editar frente" : "Nuevo frente"}
          size="sm"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={!editing.name.trim()}>
                Guardar
              </Button>
            </>
          }
        >
          <Field label="Nombre">
            <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ej. Bloque A – planta baja" className={inputClass} />
          </Field>
          <Field label="Responsable (opcional)">
            <select value={editing.chiefId} onChange={(e) => setEditing({ ...editing, chiefId: e.target.value ? Number(e.target.value) : "" })} className={inputClass}>
              <option value="">Sin asignar</option>
              {personnel.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
};
