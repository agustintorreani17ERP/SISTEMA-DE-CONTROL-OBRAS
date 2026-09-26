import React, { useState, useEffect } from "react";
import {
  UserPlus, Pencil, Search, Upload, Trash2, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { api } from "../../api";
import { Project, Empleado, EmpleadoTipo, ImputableItem } from "../../types";
import {
  Page, PageHeader, Card, Button, Field, inputClass, Modal, EmptyState, Badge,
} from "../../ui";
import { formatGs } from "../../utils/numbers";

const TIPO_LABEL: Record<EmpleadoTipo, string> = {
  MENSUALERO: "Mensualero",
  JORNALERO: "Jornalero",
  DESTAJISTA: "Destajista",
};
const TIPO_TONE: Record<EmpleadoTipo, string> = {
  MENSUALERO: "bg-blue-50 text-blue-700",
  JORNALERO: "bg-amber-50 text-amber-800",
  DESTAJISTA: "bg-violet-50 text-violet-700",
};

interface Props {
  project: Project;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const LegajoTab: React.FC<Props> = ({ project, showToast }) => {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Empleado> | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.getEmpleados(project.id)
      .then(setEmpleados)
      .catch(() => showToast("Error al cargar empleados", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [project.id]);

  const filtered = empleados.filter(
    (e) =>
      e.fullName.toLowerCase().includes(search.toLowerCase()) ||
      e.ci.includes(search) ||
      e.oficio.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.fullName?.trim() || !editing.ci?.trim() || !editing.oficio?.trim() || !editing.tipo || !editing.fechaIngreso || !editing.salarioBase) {
      showToast("Completá todos los campos obligatorios", "error");
      return;
    }
    setSaving(true);
    try {
      if (editing.id) {
        await api.updateEmpleado(editing.id, { ...editing, projectId: project.id });
        showToast("Empleado actualizado");
      } else {
        await api.createEmpleado({ ...editing, projectId: project.id });
        showToast("Empleado creado", "success");
      }
      setEditing(null);
      load();
    } catch (e: any) {
      showToast(e.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddDoc = async (empleadoId: number, file: File) => {
    // En producción esto iría al endpoint de uploads; aquí usamos un URL ficticio
    const fakeUrl = `https://uploads.example.com/${Date.now()}_${file.name}`;
    try {
      await api.addEmpleadoDoc(empleadoId, {
        tipo: file.type.includes("image") ? "Foto" : "Documento",
        url: fakeUrl,
        nombre: file.name,
      });
      showToast("Documento adjuntado");
      load();
    } catch {
      showToast("Error al adjuntar", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className={inputClass + " pl-9"}
            placeholder="Buscar nombre, CI, oficio…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          icon={<UserPlus className="w-4 h-4" />}
          onClick={() => setEditing({ tipo: "MENSUALERO", activo: true, projectId: project.id })}
        >
          Nuevo empleado
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Sin personal"
          help="Agregá el primer empleado con el botón de arriba."
          action={
            <Button variant="primary" icon={<UserPlus className="w-4 h-4" />} onClick={() => setEditing({ tipo: "MENSUALERO", activo: true })}>
              Nuevo empleado
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-3 py-3 text-left">CI</th>
                <th className="px-3 py-3 text-left">Oficio</th>
                <th className="px-3 py-3 text-left">Tipo</th>
                <th className="px-3 py-3 text-right">Salario/Jornal</th>
                <th className="px-3 py-3 text-left">IPS</th>
                <th className="px-3 py-3 text-left">Banco</th>
                <th className="px-3 py-3 text-center">Estado</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((emp) => (
                <React.Fragment key={emp.id}>
                  <tr
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === emp.id ? null : emp.id)}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-800">{emp.fullName}</td>
                    <td className="px-3 py-3 font-mono text-slate-600">{emp.ci}</td>
                    <td className="px-3 py-3 text-slate-600">{emp.oficio}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_TONE[emp.tipo]}`}>
                        {TIPO_LABEL[emp.tipo]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">
                      {formatGs(Number(emp.salarioBase))} Gs.
                    </td>
                    <td className="px-3 py-3 text-slate-500">{emp.nroIPS || "—"}</td>
                    <td className="px-3 py-3 text-slate-500">{emp.banco || "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${emp.activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {emp.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1 text-slate-400 hover:text-blue-600 rounded"
                          onClick={(e) => { e.stopPropagation(); setEditing(emp); }}
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {expanded === emp.id
                          ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                          : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </td>
                  </tr>

                  {/* Fila expandida: documentos */}
                  {expanded === emp.id && (
                    <tr>
                      <td colSpan={9} className="px-6 py-3 bg-slate-50 border-b border-slate-100">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Documentos adjuntos</span>
                            <label className="cursor-pointer flex items-center gap-1 text-xs text-blue-700 hover:underline">
                              <Upload className="w-3.5 h-3.5" />
                              Adjuntar
                              <input
                                type="file"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleAddDoc(emp.id, e.target.files[0])}
                              />
                            </label>
                          </div>
                          {(!emp.documentos || emp.documentos.length === 0) ? (
                            <p className="text-xs text-slate-400">Sin documentos adjuntos.</p>
                          ) : (
                            <ul className="flex flex-wrap gap-2">
                              {emp.documentos?.map((doc) => (
                                <li key={doc.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
                                  <a href={doc.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline font-medium">
                                    {doc.nombre}
                                  </a>
                                  <span className="text-slate-400">({doc.tipo})</span>
                                  <button
                                    onClick={async () => {
                                      await api.deleteEmpleadoDoc(doc.id);
                                      load();
                                    }}
                                    className="text-slate-400 hover:text-red-500"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {emp.notas && (
                            <p className="text-xs text-slate-500 italic">Notas: {emp.notas}</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal de edición */}
      {editing && (
        <Modal
          title={editing.id ? "Editar empleado" : "Nuevo empleado"}
          onClose={() => setEditing(null)}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre completo *">
              <input className={inputClass} value={editing.fullName || ""} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
            </Field>
            <Field label="CI (cédula) *">
              <input className={inputClass} value={editing.ci || ""} onChange={(e) => setEditing({ ...editing, ci: e.target.value })} />
            </Field>
            <Field label="Oficio / Cargo *">
              <input className={inputClass} value={editing.oficio || ""} onChange={(e) => setEditing({ ...editing, oficio: e.target.value })} />
            </Field>
            <Field label="Tipo *">
              <select className={inputClass} value={editing.tipo || "MENSUALERO"} onChange={(e) => setEditing({ ...editing, tipo: e.target.value as EmpleadoTipo })}>
                <option value="MENSUALERO">Mensualero</option>
                <option value="JORNALERO">Jornalero</option>
                <option value="DESTAJISTA">Destajista</option>
              </select>
            </Field>
            <Field label="Fecha de ingreso *">
              <input type="date" className={inputClass} value={editing.fechaIngreso ? String(editing.fechaIngreso).substring(0, 10) : ""} onChange={(e) => setEditing({ ...editing, fechaIngreso: e.target.value })} />
            </Field>
            <Field label="Salario / Jornal base (Gs.) *">
              <input type="number" className={inputClass} value={editing.salarioBase as number || ""} onChange={(e) => setEditing({ ...editing, salarioBase: Number(e.target.value) })} />
            </Field>
            <Field label="Nro. IPS">
              <input className={inputClass} value={editing.nroIPS || ""} onChange={(e) => setEditing({ ...editing, nroIPS: e.target.value })} />
            </Field>
            <Field label="Banco">
              <input className={inputClass} value={editing.banco || ""} onChange={(e) => setEditing({ ...editing, banco: e.target.value })} />
            </Field>
            <Field label="Cuenta bancaria">
              <input className={inputClass} value={editing.cuentaBanco || ""} onChange={(e) => setEditing({ ...editing, cuentaBanco: e.target.value })} />
            </Field>
            <Field label="Estado">
              <select className={inputClass} value={editing.activo ? "1" : "0"} onChange={(e) => setEditing({ ...editing, activo: e.target.value === "1" })}>
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </Field>
            <Field label="Notas" className="sm:col-span-2">
              <textarea className={inputClass} rows={2} value={editing.notas || ""} onChange={(e) => setEditing({ ...editing, notas: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
};
