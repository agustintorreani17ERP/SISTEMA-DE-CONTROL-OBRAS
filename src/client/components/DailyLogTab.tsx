import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../api";
import type { ParteCatalogo, ParteDiarioRow, Project } from "../types";
import { Button, EmptyState, cx, inputClass } from "../ui";
import { formatQty } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";
import { cacheGetJson, cacheSetJson, flushOutbox, listOutbox, onOutboxChange, removeOutbox, type OutboxItem } from "../offline/outbox";
import { ParteDiarioForm } from "../partes/ParteDiarioForm";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const hace = (dias: number) => {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};
const ESTADO: Record<string, string> = { NORMAL: "Jornada normal", PARCIAL: "Jornada parcial", SUSPENDIDA: "Suspendida" };
const CLIMA: Record<string, string> = { DESPEJADO: "Despejado", NUBLADO: "Nublado", LLUVIA_LEVE: "Lluvia leve", LLUVIA_INTENSA: "Lluvia intensa" };

/** Catálogo del parte: del servidor si hay red; si no, el último guardado en el celular. */
function useParteCatalogo(projectId: number) {
  const key = `parte-catalogo:${projectId}`;
  const [catalogo, setCatalogo] = useState<ParteCatalogo | null>(() => cacheGetJson<ParteCatalogo>(key));
  const [offline, setOffline] = useState(false);
  const reload = useCallback(async () => {
    try {
      const c = await api.getParteCatalogo(projectId);
      cacheSetJson(key, c);
      setCatalogo(c);
      setOffline(false);
    } catch {
      setCatalogo(cacheGetJson<ParteCatalogo>(key));
      setOffline(true);
    }
  }, [projectId, key]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { catalogo, offline, reload };
}

function useOutbox(projectId: number) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const load = useCallback(() => {
    listOutbox(projectId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [projectId]);
  useEffect(() => {
    load();
    return onOutboxChange(load);
  }, [load]);
  return items;
}

const Linea = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="py-2">
    <p className="mb-1 text-xs font-semibold">{label}</p>
    {children}
  </div>
);

function ParteDetalle({ p }: { p: ParteDiarioRow }) {
  const item = (i: { code: string; name: string } | null) => (i ? `${i.code} ${i.name}` : "Sin ítem (prorrateo)");
  return (
    <div className="divide-y divide-slate-100 border-t border-slate-200 px-3 pb-2 text-sm">
      {(p.actividades || p.observaciones) && (
        <Linea label="Tareas">
          {p.actividades && <p className="whitespace-pre-line">{p.actividades}</p>}
          {p.observaciones && <p className="mt-1 text-slate-600">Obs.: {p.observaciones}</p>}
        </Linea>
      )}
      {p.personal.length > 0 && (
        <Linea label="Personal">
          <table className="w-full">
            <tbody>
              {p.personal.map((h) => (
                <tr key={h.id}>
                  <td className="py-0.5 pr-2">{h.empleado}</td>
                  <td className="py-0.5 pr-2 text-xs">{item(h.item)}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatQty(h.horas, 1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Linea>
      )}
      {p.equipos.length > 0 && (
        <Linea label="Equipos">
          <table className="w-full">
            <tbody>
              {p.equipos.map((h) => (
                <tr key={h.id}>
                  <td className="py-0.5 pr-2">
                    <span className="font-mono text-xs">{h.equipo.code}</span> {h.equipo.description}
                  </td>
                  <td className="py-0.5 pr-2 text-xs">{item(h.item)}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatQty(h.horas, 1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Linea>
      )}
      {p.avance.length > 0 && (
        <Linea label="Avance">
          <table className="w-full">
            <tbody>
              {p.avance.map((a) => (
                <tr key={a.id}>
                  <td className="py-0.5 pr-2">
                    {a.item.code} {a.item.name}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {formatQty(a.cantidad)} {a.item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Linea>
      )}
      {p.combustible.length > 0 && (
        <Linea label="Combustible">
          {p.combustible.map((c) => (
            <p key={c.id} className="tabular-nums">
              <span className="font-mono text-xs">{c.equipo.code}</span> {formatQty(c.litros, 1)} L{c.horometro !== null && ` · horómetro ${formatQty(c.horometro, 1)}`}
              {c.fotoUrl && (
                <a className="ml-2 underline" href={c.fotoUrl} target="_blank" rel="noreferrer">
                  ticket
                </a>
              )}
            </p>
          ))}
        </Linea>
      )}
      {p.viajes.length > 0 && (
        <Linea label="Viajes">
          {p.viajes.map((v) => (
            <p key={v.id}>
              {v.origen} → {v.destino}: {formatQty(v.cantidad, 1)} {v.unidad === "M3" ? "m³" : "t"} {v.material ?? ""}
              {v.km !== null && ` · ${formatQty(v.km, 1)} km`} · {item(v.item)}
            </p>
          ))}
        </Linea>
      )}
    </div>
  );
}

/**
 * Parte diario de obra: horas de personal y equipos por ítem, avance del día, combustible y
 * viajes. Se carga desde el celular aunque no haya señal (cola local) y se envía después.
 */
export const DailyLogTab: React.FC<{ project?: Project | null; showToast: Toast }> = ({ project, showToast }) => {
  if (!project) return <EmptyState title="Elegí una obra" help="El parte diario se carga por obra." />;
  return <DailyLog project={project} showToast={showToast} />;
};

function DailyLog({ project, showToast }: { project: Project; showToast: Toast }) {
  const [desde, setDesde] = useState(hace(14));
  const [hasta, setHasta] = useState(todayIso());
  const [partes, setPartes] = useState<ParteDiarioRow[] | null>(null);
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ editar: OutboxItem | null } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { catalogo, offline, reload: reloadCatalogo } = useParteCatalogo(project.id);
  const cola = useOutbox(project.id);

  const load = useCallback(async () => {
    try {
      setPartes(await api.getPartesDiarios(project.id, desde, hasta));
    } catch (e: any) {
      if (partes === null) setPartes([]);
      if ((e as { status?: number }).status) showToast(e.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, desde, hasta, showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await flushOutbox();
      if (r.enviados.length) showToast(`${r.enviados.length} parte(s) enviados`, "success");
      for (const e of r.enviados) for (const a of e.avisos) showToast(a, "error");
      if (r.rechazados.length) showToast(`${r.rechazados.length} parte(s) rechazados: corregilos`, "error");
      if (r.sinRed) showToast("Sin conexión: se reintenta al volver la señal", "info");
      if (r.enviados.length) {
        load();
        reloadCatalogo();
      }
    } finally {
      setEnviando(false);
    }
  };

  const borrar = async (p: ParteDiarioRow) => {
    if (!confirm(`¿Borrar el parte del ${fmtDate(p.fecha)}? Se borran sus horas, avance, combustible y viajes.`)) return;
    try {
      await api.deleteParteDiario(p.id);
      showToast("Parte borrado", "success");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const pendientes = cola.filter((i) => i.estado === "PENDIENTE");
  const rechazados = cola.filter((i) => i.estado === "RECHAZADO");

  return (
    <div className="space-y-4 pb-12 text-slate-900">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Desde</span>
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Hasta</span>
          <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={load}>
            Actualizar
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!catalogo} onClick={() => setForm({ editar: null })}>
            Nuevo parte
          </Button>
        </div>
      </div>

      {offline && (
        <p className="text-sm">
          Sin conexión.{" "}
          {catalogo ? `Se usan los datos guardados el ${new Date(catalogo.generadoEl).toLocaleString("es-PY")}.` : <span className="text-red-600">No hay datos guardados de esta obra: abrí el parte una vez con señal.</span>}
        </p>
      )}

      {cola.length > 0 && (
        <div className="border border-slate-300">
          <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2">
            <p className="text-sm font-semibold">
              En el celular sin enviar: {pendientes.length}
              {rechazados.length > 0 && <span className="text-red-600"> · rechazados: {rechazados.length}</span>}
            </p>
            {pendientes.length > 0 && (
              <Button size="sm" onClick={enviar} disabled={enviando}>
                {enviando ? "Enviando…" : "Enviar ahora"}
              </Button>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {cola.map((i) => (
              <li key={i.clientUuid} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="tabular-nums">{fmtDate(i.payload.fecha)}</span>
                <span className="text-slate-600">
                  {i.payload.personal.length} pers. · {i.payload.equipos.length} eq. · {i.payload.avance.length} avance · {i.payload.combustible.length} comb. · {i.payload.viajes.length} viajes
                </span>
                {i.estado === "RECHAZADO" ? <span className="w-full text-red-600">{i.error}</span> : <span className="text-slate-600">pendiente</span>}
                {i.estado === "RECHAZADO" && catalogo && (
                  <span className="ml-auto flex gap-3">
                    <button className="underline" onClick={() => setForm({ editar: i })}>
                      Corregir
                    </button>
                    <button
                      className="underline"
                      onClick={() => {
                        if (confirm("¿Descartar este parte? Se pierde lo cargado.")) removeOutbox(i.clientUuid);
                      }}
                    >
                      Descartar
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {partes === null ? (
        <p className="text-sm text-slate-600">Cargando…</p>
      ) : partes.length === 0 ? (
        <EmptyState title="Sin partes en el rango" help="Cargá el parte del día desde el celular: horas por ítem, avance, combustible y viajes." />
      ) : (
        <div className="border border-slate-300">
          {partes.map((p) => {
            const open = abiertos.has(p.id);
            const hp = p.personal.reduce((s, h) => s + h.horas, 0);
            const he = p.equipos.reduce((s, h) => s + h.horas, 0);
            const lt = p.combustible.reduce((s, c) => s + c.litros, 0);
            return (
              <div key={p.id} className="border-b border-slate-200 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <button
                    className="flex items-center gap-1 font-semibold tabular-nums"
                    onClick={() =>
                      setAbiertos((s) => {
                        const n = new Set(s);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {fmtDate(p.fecha)}
                  </button>
                  <span>{p.frente ?? "Toda la obra"}</span>
                  <span className={cx(p.estadoFaena === "SUSPENDIDA" && "text-red-600")}>{ESTADO[p.estadoFaena] ?? p.estadoFaena}</span>
                  {p.clima && <span className="text-slate-600">{CLIMA[p.clima] ?? p.clima}</span>}
                  <span className="tabular-nums">{formatQty(hp, 1)} h personal</span>
                  <span className="tabular-nums">{formatQty(he, 1)} h equipo</span>
                  {p.avance.length > 0 && <span>{p.avance.length} ítem(s) con avance</span>}
                  {lt > 0 && <span className="tabular-nums">{formatQty(lt, 1)} L</span>}
                  {p.viajes.length > 0 && <span>{p.viajes.length} viaje(s)</span>}
                  <span className="ml-auto text-xs text-slate-600">{p.supervisor}</span>
                  <button className="p-1 text-slate-500 hover:text-slate-900" onClick={() => borrar(p)} aria-label="Borrar parte">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {open && <ParteDetalle p={p} />}
              </div>
            );
          })}
        </div>
      )}

      {form && catalogo && (
        <ParteDiarioForm
          project={project}
          catalogo={catalogo}
          editar={form.editar}
          onClose={() => setForm(null)}
          onSaved={() => {
            load();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
