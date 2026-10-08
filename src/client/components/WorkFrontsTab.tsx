import React, { useState } from "react";
import { MapPin, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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

const isArea = (f: WorkFront) => (f.tipo ? f.tipo === "AREA" : f.budgetItemId != null);

/** Áreas primero (en el orden del presupuesto), después los auxiliares por código. */
function sortFronts(a: WorkFront, b: WorkFront) {
  if (isArea(a) !== isArea(b)) return isArea(a) ? -1 : 1;
  return (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id;
}

/**
 * Frentes de obra: uno por cada Área del presupuesto (se sincronizan solos al importar) y los
 * auxiliares que se cargan a mano (obrador, depósito…). Se usan para ubicar pedidos y partes diarios.
 */
export const WorkFrontsTab: React.FC<WorkFrontsTabProps> = ({ project, workFronts, personnel, onRefresh, showToast }) => {
  const [editing, setEditing] = useState<{ id?: number; area?: boolean; name: string; chiefId: number | "" } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const fronts = workFronts.filter((w) => !project || w.projectId === project.id).sort(sortFronts);
  const toast = showToast ?? (() => undefined);

  const sync = async () => {
    if (!project) return;
    setSyncing(true);
    try {
      const r = await api.syncWorkFronts(project.id);
      const cambios = r.creados + r.actualizados + r.desvinculados + r.borrados;
      toast(
        cambios
          ? `Frentes sincronizados: ${r.creados} nuevos, ${r.actualizados} actualizados${r.borrados + r.desvinculados ? `, ${r.borrados + r.desvinculados} de áreas eliminadas` : ""}`
          : "Los frentes ya estaban al día con el presupuesto"
      );
      onRefresh?.();
    } catch (err: any) {
      toast(err.message || "No se pudo sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    if (!project || !editing?.name.trim()) return;
    try {
      if (editing.id) {
        const body = editing.area
          ? { chiefId: editing.chiefId || null }
          : { name: editing.name.trim(), chiefId: editing.chiefId || null };
        await api.updateWorkFront(editing.id, body);
      } else {
        await api.createWorkFront({ projectId: project.id, name: editing.name.trim(), chiefId: editing.chiefId || null });
      }
      toast(editing.id ? "Frente actualizado" : "Frente auxiliar creado");
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

  const chiefName = (f: WorkFront) =>
    f.chief?.fullName ?? personnel.find((p) => p.id === f.chiefId)?.fullName ?? "Sin asignar";

  const newButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ name: "", chiefId: "" })}>
      Nuevo frente
    </Button>
  );
  const syncButton = (
    <Button variant="primary" icon={<RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />} onClick={sync} disabled={syncing || !project}>
      Sincronizar con el presupuesto
    </Button>
  );

  return (
    <div className="space-y-4">
      {fronts.length > 0 && (
        <div className="flex justify-end gap-2">
          {newButton}
          {syncButton}
        </div>
      )}

      {fronts.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          title="La obra todavía no tiene frentes"
          help="Cada Área del presupuesto es un frente (código 1, 2, 3…). Sincronizá para crearlos; los frentes auxiliares (obrador, depósito…) se agregan a mano."
          action={
            <div className="flex justify-center gap-2">
              {syncButton}
              {newButton}
            </div>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-black">
              <thead className="border-b border-slate-200 text-xs font-semibold">
                <tr>
                  <th className="w-20 px-4 py-3">Código</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Jefe</th>
                  <th className="w-32 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fronts.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2.5 tabular-nums">{f.codigo ?? "—"}</td>
                    <td className="px-4 py-2.5 font-medium">{f.name}</td>
                    <td className="px-4 py-2.5">{isArea(f) ? "Área del presupuesto" : "Auxiliar"}</td>
                    <td className="px-4 py-2.5">{chiefName(f)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => setEditing({ id: f.id, area: isArea(f), name: f.name, chiefId: f.chiefId ?? "" })}
                        >
                          Editar
                        </Button>
                        {!isArea(f) && (
                          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(f)} title="Borrar frente" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Editar frente" : "Nuevo frente auxiliar"}
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
          <Field
            label="Nombre"
            hint={editing.area ? "Viene del Área del presupuesto: para cambiarlo, renombrá el Área en el Centro de Costos." : undefined}
          >
            <input
              autoFocus={!editing.area}
              disabled={editing.area}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Ej. Obrador, depósito, acceso norte"
              className={inputClass}
            />
          </Field>
          {!editing.id && <p className="text-xs text-slate-600">El código se asigna solo: el siguiente número después del último frente.</p>}
          <Field label="Jefe de frente (opcional)">
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
