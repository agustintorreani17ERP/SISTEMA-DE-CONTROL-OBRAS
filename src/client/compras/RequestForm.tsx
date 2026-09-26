import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Material, Personnel, Project, User, WorkFront } from "../types";
import { Button, Field, inputClass, Modal } from "../ui";
import { BudgetItemSelect, useImputableItems } from "../components/BudgetItemSelect";

interface Line {
  key: number;
  materialId: number | "";
  quantity: string;
  budgetItemId: number | "";
}

interface RequestFormProps {
  project: Project;
  workFronts: WorkFront[];
  personnel: Personnel[];
  materials: Material[];
  currentUser?: User | null;
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

let keySeq = 1;
const newLine = (): Line => ({ key: keySeq++, materialId: "", quantity: "", budgetItemId: "" });

/** Pedido de materiales de obra: varias líneas; frente y solicitante opcionales. */
export function RequestForm({
  project,
  workFronts,
  personnel,
  materials,
  currentUser,
  currency,
  onClose,
  onSaved,
  showToast,
}: RequestFormProps) {
  const [fronts, setFronts] = useState(workFronts.filter((w) => w.projectId === project.id));
  const [catalog, setCatalog] = useState(materials);
  const [workFrontId, setWorkFrontId] = useState<number | "">("");
  const [requestedById, setRequestedById] = useState<number | "">(
    personnel.find((p) => p.fullName === currentUser?.fullName)?.id ?? ""
  );
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [newFront, setNewFront] = useState<string | null>(null);
  const [newMaterial, setNewMaterial] = useState<{ lineKey: number; description: string; unit: string } | null>(null);
  const { items: imputable } = useImputableItems(project.id);

  const valid = lines.filter((l) => l.materialId && Number(l.quantity) > 0);
  const materialsSorted = useMemo(() => [...catalog].sort((a, b) => a.description.localeCompare(b.description)), [catalog]);
  const update = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const createFront = async () => {
    if (!newFront?.trim()) return;
    try {
      const front = await api.createWorkFront({ projectId: project.id, name: newFront.trim() });
      setFronts((prev) => [...prev, front]);
      setWorkFrontId(front.id);
      setNewFront(null);
      showToast(`Frente "${front.name}" creado`);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el frente", "error");
    }
  };

  const createMaterial = async () => {
    if (!newMaterial?.description.trim()) return;
    try {
      const material = await api.createMaterial({
        code: `MAT-${Date.now().toString().slice(-6)}`,
        description: newMaterial.description.trim(),
        unit: newMaterial.unit.trim() || "un",
        category: "GENERAL",
      });
      setCatalog((prev) => [...prev, material]);
      update(newMaterial.lineKey, { materialId: material.id });
      setNewMaterial(null);
      showToast(`Material "${material.description}" agregado al catálogo`);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el material", "error");
    }
  };

  const save = async (approve: boolean) => {
    if (!valid.length) return showToast("Agregá al menos un material con cantidad", "error");
    setSaving(true);
    try {
      const created = await api.createMaterialRequest({
        projectId: project.id,
        workFrontId: workFrontId || null,
        requestedById: requestedById || null,
        notes: notes || undefined,
        details: valid.map((l) => ({
          materialId: Number(l.materialId),
          quantity: Number(l.quantity),
          budgetItemId: l.budgetItemId ? Number(l.budgetItemId) : undefined,
        })),
      });
      if (approve) await api.approveMaterialRequest(created.id);
      showToast(`Pedido ${created.number} ${approve ? "creado y aprobado" : "guardado como borrador"}`);
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar el pedido", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nuevo pedido de materiales"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save(false)} disabled={saving || !valid.length}>
            Guardar borrador
          </Button>
          <Button variant="primary" onClick={() => save(true)} disabled={saving || !valid.length}>
            Guardar y aprobar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Frente de obra (opcional)">
          {newFront === null ? (
            <div className="flex gap-2">
              <select value={workFrontId} onChange={(e) => setWorkFrontId(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
                <option value="">{fronts.length ? "Sin frente" : "La obra no tiene frentes"}</option>
                {fronts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <Button type="button" icon={<Plus className="h-4 w-4" />} onClick={() => setNewFront("")} title="Nuevo frente" />
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newFront}
                onChange={(e) => setNewFront(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createFront()}
                placeholder="Ej. Bloque A – planta baja"
                className={inputClass}
              />
              <Button variant="primary" onClick={createFront}>
                Crear
              </Button>
              <Button variant="ghost" onClick={() => setNewFront(null)}>
                ✕
              </Button>
            </div>
          )}
        </Field>
        <Field label="Solicitado por">
          <select value={requestedById} onChange={(e) => setRequestedById(e.target.value ? Number(e.target.value) : "")} className={inputClass}>
            <option value="">{currentUser?.fullName ?? "Sin indicar"}</option>
            {personnel.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-800">Materiales</p>
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((prev) => [...prev, newLine()])}>
            Agregar línea
          </Button>
        </div>
        <div className="space-y-2">
          {lines.map((line, idx) => (
            <div key={line.key} className="grid grid-cols-12 items-start gap-2 rounded-xl border border-slate-200 p-2.5">
              <span className="col-span-12 text-xs font-medium text-slate-400 sm:col-span-1 sm:pt-2.5">#{idx + 1}</span>
              <div className="col-span-12 sm:col-span-5">
                {newMaterial?.lineKey === line.key ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={newMaterial.description}
                      onChange={(e) => setNewMaterial({ ...newMaterial, description: e.target.value })}
                      placeholder="Descripción del material"
                      className={inputClass}
                    />
                    <input
                      value={newMaterial.unit}
                      onChange={(e) => setNewMaterial({ ...newMaterial, unit: e.target.value })}
                      placeholder="Un."
                      className={`${inputClass} w-20`}
                    />
                    <Button variant="primary" onClick={createMaterial}>
                      OK
                    </Button>
                  </div>
                ) : (
                  <select
                    value={line.materialId}
                    onChange={(e) =>
                      e.target.value === "__new"
                        ? setNewMaterial({ lineKey: line.key, description: "", unit: "un" })
                        : update(line.key, { materialId: e.target.value ? Number(e.target.value) : "" })
                    }
                    className={inputClass}
                  >
                    <option value="">Elegí un material…</option>
                    <option value="__new">+ Nuevo material</option>
                    {materialsSorted.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.description} ({m.unit})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <input
                type="number"
                min={0}
                step="any"
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
                placeholder="Cant."
                className={`${inputClass} col-span-4 sm:col-span-2`}
              />
              <div className="col-span-7 sm:col-span-3">
                <BudgetItemSelect
                  projectId={project.id}
                  items={imputable}
                  value={line.budgetItemId}
                  onChange={(v) => update(line.key, { budgetItemId: v })}
                  currency={currency}
                  placeholder="Rubro (opcional)"
                />
              </div>
              <button
                onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== line.key) : prev))}
                className="col-span-1 rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Quitar línea"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">El rubro se puede dejar vacío: se elige al armar la orden de compra.</p>
      </div>

      <Field label="Nota (opcional)">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Para qué se necesita, urgencia…" className={inputClass} />
      </Field>
    </Modal>
  );
}
