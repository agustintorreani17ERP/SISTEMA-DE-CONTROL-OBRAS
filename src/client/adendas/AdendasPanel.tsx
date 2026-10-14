import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, Snowflake, Trash2, XCircle } from "lucide-react";
import { api } from "../api";
import type { AdendaInput, AdendaLineaInput, AdendaRow, AdendasData, BudgetItem, Project } from "../types";
import { Button, Card, EmptyState, Field, inputClass, Modal, PageHeader, StatusPill } from "../ui";
import { formatGs, formatQty } from "../utils/numbers";
import { parseFlexibleNumber } from "../utils/format";
import { todayIso } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

interface LineaForm {
  key: number;
  tipo: "VARIACION" | "EXTRA";
  budgetItemId: string;
  delta: string;
  parentId: string;
  codigo: string;
  nombre: string;
  unidad: string;
  precio: string;
  nota: string;
}

const ESTADO: Record<AdendaRow["estado"], { label: string; tone: "good" | "warn" | "neutral" }> = {
  BORRADOR: { label: "Borrador", tone: "warn" },
  APROBADA: { label: "Aprobada", tone: "good" },
  ANULADA: { label: "Anulada", tone: "neutral" },
};

const nuevaLinea = (key: number): LineaForm => ({
  key,
  tipo: "VARIACION",
  budgetItemId: "",
  delta: "",
  parentId: "",
  codigo: "",
  nombre: "",
  unidad: "",
  precio: "",
  nota: "",
});

/**
 * Adendas del contrato. Cambian CANTIDADES de ítems del presupuesto original (los precios no cambian)
 * o suman ítems extra. La cantidad real de un ítem = contrato congelado ± adendas aprobadas.
 */
export function AdendasPanel({
  project,
  budgetItems,
  currency,
  onRefresh,
  showToast,
}: {
  project: Project;
  budgetItems: BudgetItem[];
  currency: "PYG" | "USD";
  onRefresh: () => void;
  showToast: Toast;
}) {
  const [data, setData] = useState<AdendasData | null>(null);
  const [editing, setEditing] = useState<AdendaRow | "nueva" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdendas(project.id));
    } catch (e: any) {
      showToast(e.message || "No se pudieron cargar las adendas", "error");
    }
  }, [project.id, showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => budgetItems.filter((b) => b.nodeKind === "ITEM" && !b.isSystem), [budgetItems]);
  const rubros = useMemo(() => budgetItems.filter((b) => b.nodeKind !== "ITEM" && !b.isSystem), [budgetItems]);
  const precioDe = useMemo(() => new Map(budgetItems.map((b) => [b.id, Number(b.unitPrice ?? 0)])), [budgetItems]);

  const congelar = async () => {
    if (!window.confirm("Congelar el presupuesto: el monto y la cantidad actuales pasan a ser el contrato original. Después solo cambian por adenda. ¿Continuar?")) return;
    setBusy(true);
    try {
      await api.congelarPresupuesto(project.id);
      showToast("Presupuesto congelado", "success");
      await load();
      onRefresh();
    } catch (e: any) {
      showToast(e.message || "No se pudo congelar el presupuesto", "error");
    } finally {
      setBusy(false);
    }
  };

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(ok, "success");
      await load();
      onRefresh();
    } catch (e: any) {
      showToast(e.message || "No se pudo completar la acción", "error");
    } finally {
      setBusy(false);
    }
  };

  const borrar = (a: AdendaRow) => {
    if (!window.confirm(`¿Borrar el borrador de la adenda N° ${a.numero}?`)) return;
    accion(() => api.deleteAdenda(a.id), "Borrador eliminado");
  };

  if (!data) return <p className="text-sm text-slate-600">Cargando adendas…</p>;

  return (
    <div className="space-y-4 text-slate-900">
      <PageHeader
        eyebrow={`${project.code}${project.clientName ? ` · ${project.clientName}` : ""}`}
        title="Adendas"
        help="Cambian cantidades del presupuesto original congelado. Los precios unitarios no cambian; los ítems extra se crean con su propio precio."
        actions={
          <div className="flex gap-2">
            {!data.congelado ? (
              <Button icon={<Snowflake className="h-4 w-4" />} onClick={congelar} disabled={busy}>
                Congelar presupuesto
              </Button>
            ) : (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("nueva")} disabled={busy}>
                Nueva adenda
              </Button>
            )}
          </div>
        }
      />

      {!data.congelado && (
        <p className="text-sm">
          El presupuesto todavía no está congelado. Revisá las partidas y congelalo: a partir de ese momento el contrato original queda fijo y las cantidades solo cambian por adenda.
        </p>
      )}

      {!data.adendas.length ? (
        <EmptyState title="Sin adendas" help={data.congelado ? "Cuando el comitente acuerde un cambio de cantidades, cargalo como adenda." : "Primero congelá el presupuesto."} />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-3 py-2 font-semibold">N°</th>
                  <th className="px-3 py-2 font-semibold">Título</th>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Líneas</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.adendas.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 tabular-nums">{a.numero}</td>
                    <td className="px-3 py-2">
                      <div>{a.titulo}</div>
                      {a.resolucion && <div className="text-xs text-slate-600">Resolución: {a.resolucion}</div>}
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                        {a.lineas.map((l) => (
                          <li key={l.id}>
                            {l.tipo === "EXTRA"
                              ? `Extra · ${l.codigo ?? ""} ${l.nombre ?? ""}: ${formatQty(l.deltaQuantity)} ${l.unidad ?? ""} a ${formatGs(l.precioUnitario)}`
                              : `${l.budgetItem?.code ?? ""} ${l.budgetItem?.name ?? ""}: ${l.deltaQuantity > 0 ? "+" : ""}${formatQty(l.deltaQuantity)} ${l.budgetItem?.unit ?? ""}`}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{a.fecha}</td>
                    <td className="px-3 py-2 tabular-nums">{a.lineas.length}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={ESTADO[a.estado].tone}>{ESTADO[a.estado].label}</StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {a.estado === "BORRADOR" && (
                          <>
                            <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(a)} disabled={busy}>
                              Editar
                            </Button>
                            <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => accion(() => api.aprobarAdenda(a.id), `Adenda N° ${a.numero} aprobada`)} disabled={busy}>
                              Aprobar
                            </Button>
                            <Button size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => borrar(a)} disabled={busy}>
                              Borrar
                            </Button>
                          </>
                        )}
                        {a.estado === "APROBADA" && (
                          <Button size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => accion(() => api.anularAdenda(a.id), `Adenda N° ${a.numero} anulada`)} disabled={busy}>
                            Anular
                          </Button>
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
        <AdendaModal
          adenda={editing === "nueva" ? null : editing}
          items={items}
          rubros={rubros}
          precioDe={precioDe}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            showToast(msg, "success");
            await load();
            onRefresh();
          }}
          showToast={showToast}
          projectId={project.id}
        />
      )}
    </div>
  );
}

function AdendaModal({
  adenda,
  items,
  rubros,
  precioDe,
  currency,
  onClose,
  onSaved,
  showToast,
  projectId,
}: {
  adenda: AdendaRow | null;
  items: BudgetItem[];
  rubros: BudgetItem[];
  precioDe: Map<number, number>;
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: (msg: string) => void;
  showToast: Toast;
  projectId: number;
}) {
  const [titulo, setTitulo] = useState(adenda?.titulo ?? "");
  const [fecha, setFecha] = useState(adenda?.fecha ?? todayIso());
  const [motivo, setMotivo] = useState(adenda?.motivo ?? "");
  const [resolucion, setResolucion] = useState(adenda?.resolucion ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(() =>
    adenda?.lineas.length
      ? adenda.lineas.map((l, i) => ({
          key: i + 1,
          tipo: l.tipo,
          budgetItemId: l.tipo === "VARIACION" ? String(l.budgetItemId ?? "") : "",
          delta: String(l.deltaQuantity),
          parentId: l.parentId ? String(l.parentId) : "",
          codigo: l.codigo ?? "",
          nombre: l.nombre ?? "",
          unidad: l.unidad ?? "",
          precio: l.precioUnitario !== null ? String(l.precioUnitario) : "",
          nota: l.nota ?? "",
        }))
      : [nuevaLinea(1)]
  );
  const [saving, setSaving] = useState(false);

  const setLinea = (key: number, patch: Partial<LineaForm>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const quitar = (key: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const agregar = () => setLineas((ls) => [...ls, nuevaLinea(Math.max(0, ...ls.map((l) => l.key)) + 1)]);

  const montoLinea = (l: LineaForm) => {
    if (l.tipo === "EXTRA") return parseFlexibleNumber(l.delta) * parseFlexibleNumber(l.precio);
    return parseFlexibleNumber(l.delta) * (precioDe.get(Number(l.budgetItemId)) ?? 0);
  };
  const totalDelta = lineas.reduce((acc, l) => acc + montoLinea(l), 0);

  const guardar = async () => {
    const payload: AdendaInput = {
      titulo: titulo.trim(),
      fecha,
      motivo: motivo.trim() || null,
      resolucion: resolucion.trim() || null,
      lineas: lineas.map((l): AdendaLineaInput => {
        const base = { deltaQuantity: parseFlexibleNumber(l.delta), nota: l.nota.trim() || null };
        if (l.tipo === "EXTRA") {
          return { tipo: "EXTRA", ...base, parentId: Number(l.parentId) || null, codigo: l.codigo.trim(), nombre: l.nombre.trim(), unidad: l.unidad.trim() || "un", precioUnitario: parseFlexibleNumber(l.precio) };
        }
        return { tipo: "VARIACION", ...base, budgetItemId: Number(l.budgetItemId) || null };
      }),
    };
    setSaving(true);
    try {
      if (adenda) await api.updateAdenda(adenda.id, payload);
      else await api.createAdenda(projectId, payload);
      onSaved(adenda ? `Adenda N° ${adenda.numero} guardada` : "Adenda creada como borrador");
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar la adenda", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={adenda ? `Adenda N° ${adenda.numero} (borrador)` : "Nueva adenda"}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm">Monto neto de las líneas: {formatGs(totalDelta)}</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={guardar} disabled={saving || !titulo.trim() || !lineas.length}>
              {saving ? "Guardando…" : "Guardar borrador"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Título">
            <input className={inputClass} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Ampliación de excavación por suelo rocoso" />
          </Field>
          <Field label="Fecha">
            <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Resolución (opcional)">
            <input className={inputClass} value={resolucion} onChange={(e) => setResolucion(e.target.value)} />
          </Field>
          <Field label="Motivo (opcional)">
            <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Líneas</div>
          {lineas.map((l) => (
            <div key={l.key} className="grid gap-2 border border-slate-200 p-3 md:grid-cols-12">
              <div className="md:col-span-2">
                <select className={inputClass} value={l.tipo} onChange={(e) => setLinea(l.key, { tipo: e.target.value as LineaForm["tipo"] })}>
                  <option value="VARIACION">Cambiar cantidad</option>
                  <option value="EXTRA">Ítem extra</option>
                </select>
              </div>
              {l.tipo === "VARIACION" ? (
                <div className="md:col-span-6">
                  <select className={inputClass} value={l.budgetItemId} onChange={(e) => setLinea(l.key, { budgetItemId: e.target.value })}>
                    <option value="">Elegí el ítem…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} · {it.name} ({it.unit ?? ""})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="md:col-span-3">
                    <select className={inputClass} value={l.parentId} onChange={(e) => setLinea(l.key, { parentId: e.target.value })}>
                      <option value="">Rubro…</option>
                      {rubros.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <input className={inputClass} value={l.codigo} onChange={(e) => setLinea(l.key, { codigo: e.target.value })} placeholder="Código" />
                  </div>
                  <div className="md:col-span-2">
                    <input className={inputClass} value={l.nombre} onChange={(e) => setLinea(l.key, { nombre: e.target.value })} placeholder="Descripción" />
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <input className={inputClass} inputMode="decimal" value={l.delta} onChange={(e) => setLinea(l.key, { delta: e.target.value })} placeholder={l.tipo === "EXTRA" ? "Cantidad" : "± cantidad"} />
              </div>
              {l.tipo === "EXTRA" && (
                <>
                  <div className="md:col-span-1">
                    <input className={inputClass} value={l.unidad} onChange={(e) => setLinea(l.key, { unidad: e.target.value })} placeholder="Un." />
                  </div>
                  <div className="md:col-span-2">
                    <input className={inputClass} inputMode="decimal" value={l.precio} onChange={(e) => setLinea(l.key, { precio: e.target.value })} placeholder={`P.U. ${currency}`} />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between md:col-span-12">
                <span className="text-xs text-slate-600">
                  {l.tipo === "VARIACION" && l.budgetItemId ? `Monto: ${formatGs(montoLinea(l))} (al P.U. del presupuesto)` : l.tipo === "EXTRA" && l.precio ? `Monto: ${formatGs(montoLinea(l))}` : ""}
                </span>
                <button className="text-xs text-slate-700 underline" onClick={() => quitar(l.key)} disabled={lineas.length === 1}>
                  Quitar línea
                </button>
              </div>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={agregar}>
            Agregar línea
          </Button>
        </div>
        <p className="text-xs text-slate-600">
          Una deducción es una cantidad negativa. Una adenda no puede dejar la cantidad real de un ítem por debajo de lo ya ejecutado. Al aprobarla, la cantidad real cambia; los precios no.
        </p>
      </div>
    </Modal>
  );
}
