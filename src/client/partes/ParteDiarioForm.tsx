import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { ParteCatalogo, ParteDiarioInput, Project } from "../types";
import { cx } from "../ui";
import { formatGs, formatQty } from "../utils/numbers";
import { todayIso } from "../insumos/labels";
import { cacheGetJson, cacheRemove, cacheSetJson, enqueueParte, flushOutbox, newUuid, type OutboxItem } from "../offline/outbox";
import { SearchPick, type PickOption } from "./SearchPick";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const big = "w-full border border-slate-400 bg-white px-3 py-2.5 text-base";
const numCls = cx(big, "text-right tabular-nums");
const toNum = (s: string) => {
  const t = s.trim().replace(",", ".");
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const fromNum = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

let seq = 1;
const k = () => seq++;

interface RowPersonal { key: number; empleadoId: number | null; budgetItemId: number | null; horas: string }
interface RowEquipo { key: number; insumoId: number | null; budgetItemId: number | null; horas: string }
interface RowAvance { key: number; budgetItemId: number | null; cantidad: string }
interface RowCombustible { key: number; equipoId: number | null; litros: string; horometro: string; foto: Blob | null; fotoUrl: string | null }
interface RowViaje {
  key: number;
  equipoId: number | null;
  origen: string;
  destino: string;
  materialId: number | null;
  materialTexto: string;
  cantidad: string;
  unidad: "M3" | "T";
  km: string;
  budgetItemId: number | null;
}

interface FormState {
  clientUuid: string;
  fecha: string;
  workFrontId: number | null;
  clima: string;
  estadoFaena: "NORMAL" | "PARCIAL" | "SUSPENDIDA";
  actividades: string;
  observaciones: string;
  supervisor: string;
  personal: RowPersonal[];
  equipos: RowEquipo[];
  avance: RowAvance[];
  combustible: RowCombustible[];
  viajes: RowViaje[];
}

const vacio = (): FormState => ({
  clientUuid: newUuid(),
  fecha: todayIso(),
  workFrontId: null,
  clima: "DESPEJADO",
  estadoFaena: "NORMAL",
  actividades: "",
  observaciones: "",
  supervisor: cacheGetJson<string>("parte-supervisor") ?? "",
  personal: [],
  equipos: [],
  avance: [],
  combustible: [],
  viajes: [],
});

/** Vuelve a armar el formulario desde un parte de la cola (p. ej. uno rechazado por el servidor). */
function desdeOutbox(item: OutboxItem): FormState {
  const p = item.payload;
  return {
    clientUuid: p.clientUuid,
    fecha: p.fecha,
    workFrontId: p.workFrontId ?? null,
    clima: p.clima ?? "",
    estadoFaena: p.estadoFaena,
    actividades: p.actividades ?? "",
    observaciones: p.observaciones ?? "",
    supervisor: p.supervisor ?? "",
    personal: p.personal.map((r) => ({ key: k(), empleadoId: r.empleadoId, budgetItemId: r.budgetItemId, horas: fromNum(r.horas) })),
    equipos: p.equipos.map((r) => ({ key: k(), insumoId: r.insumoId, budgetItemId: r.budgetItemId, horas: fromNum(r.horas) })),
    avance: p.avance.map((r) => ({ key: k(), budgetItemId: r.budgetItemId, cantidad: fromNum(r.cantidad) })),
    combustible: p.combustible.map((r, i) => ({ key: k(), equipoId: r.equipoId, litros: fromNum(r.litros), horometro: fromNum(r.horometro), foto: item.fotos[i] ?? null, fotoUrl: r.fotoUrl ?? null })),
    viajes: p.viajes.map((r) => ({
      key: k(),
      equipoId: r.equipoId,
      origen: r.origen,
      destino: r.destino,
      materialId: r.materialId,
      materialTexto: r.materialTexto ?? "",
      cantidad: fromNum(r.cantidad),
      unidad: r.unidad,
      km: fromNum(r.km),
      budgetItemId: r.budgetItemId,
    })),
  };
}

/** Achica la foto del ticket (lado mayor 1600 px) para que la cola y la subida sean livianas. */
async function comprimir(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function Section({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-300">
      <button type="button" className="flex w-full items-center gap-2 py-3 text-left text-base font-semibold" onClick={onToggle}>
        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        <span className="flex-1">{title}</span>
        {count > 0 && <span className="text-sm font-normal tabular-nums">{count}</span>}
      </button>
      {open && <div className="space-y-3 pb-4">{children}</div>}
    </section>
  );
}

function RowBox({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="relative space-y-2 border border-slate-300 p-3 pr-10">
      {children}
      <button type="button" className="absolute right-1 top-1 p-2 text-slate-500" onClick={onRemove} aria-label="Quitar">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

const AddBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className="flex w-full items-center justify-center gap-2 border border-dashed border-slate-400 py-3 text-base" onClick={onClick}>
    <Plus className="h-4 w-4" />
    {children}
  </button>
);

const Lbl = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-sm font-medium">{children}</span>;

/**
 * Parte diario para el celular. Guarda un borrador local mientras se completa; al guardar pasa a
 * la cola sin conexión y se intenta enviar enseguida.
 */
export function ParteDiarioForm({
  project,
  catalogo,
  editar,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  catalogo: ParteCatalogo;
  editar?: OutboxItem | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: Toast;
}) {
  const draftKey = `parte-borrador:${project.id}`;
  const [f, setF] = useState<FormState>(() => {
    if (editar) return desdeOutbox(editar);
    const d = cacheGetJson<FormState>(draftKey);
    return d ? { ...d, combustible: d.combustible.map((c) => ({ ...c, foto: null })) } : vacio();
  });
  const [open, setOpen] = useState<Record<string, boolean>>({ datos: true, personal: true, equipos: false, avance: true, combustible: false, viajes: false });
  const [saving, setSaving] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const previews = useRef(new Map<Blob, string>());

  // Borrador local (sin fotos) para no perder lo cargado si se cierra o se corta la batería
  useEffect(() => {
    if (editar) return;
    const t = setTimeout(() => cacheSetJson(draftKey, { ...f, combustible: f.combustible.map((c) => ({ ...c, foto: null })) }), 400);
    return () => clearTimeout(t);
  }, [f, draftKey, editar]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const preview = (b: Blob) => {
    if (!previews.current.has(b)) previews.current.set(b, URL.createObjectURL(b));
    return previews.current.get(b)!;
  };

  const opts = useMemo(() => {
    const items: PickOption[] = catalogo.items.map((i) => ({ id: i.id, code: i.code, label: i.name, sub: i.unit }));
    const empleados: PickOption[] = catalogo.empleados.map((e) => ({ id: e.id, label: e.fullName, sub: e.oficio }));
    const equipos: PickOption[] = catalogo.equipos.map((e) => ({ id: e.id, code: e.code, label: e.description, sub: e.unit }));
    const materiales: PickOption[] = catalogo.materiales.map((m) => ({ id: m.id, code: m.code, label: m.description, sub: m.unit }));
    return { items, empleados, equipos, materiales };
  }, [catalogo]);
  const itemById = useMemo(() => new Map(catalogo.items.map((i) => [i.id, i])), [catalogo]);
  const equipoById = useMemo(() => new Map(catalogo.equipos.map((e) => [e.id, e])), [catalogo]);
  const empById = useMemo(() => new Map(catalogo.empleados.map((e) => [e.id, e])), [catalogo]);

  type ListKey = "personal" | "equipos" | "avance" | "combustible" | "viajes";
  const upd = <L extends ListKey>(list: L, key: number, patch: Partial<FormState[L][number]>) =>
    setF((s) => ({ ...s, [list]: (s[list] as { key: number }[]).map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const del = (list: ListKey, key: number) => setF((s) => ({ ...s, [list]: (s[list] as { key: number }[]).filter((r) => r.key !== key) }));
  const lastItem = (rows: { budgetItemId: number | null }[]) => rows[rows.length - 1]?.budgetItemId ?? null;

  const horasPersonal = f.personal.reduce((s, r) => s + (toNum(r.horas) || 0), 0);
  const costoPersonal = f.personal.reduce((s, r) => s + (toNum(r.horas) || 0) * (r.empleadoId ? empById.get(r.empleadoId)?.costoHora ?? 0 : 0), 0);
  const horasEquipo = f.equipos.reduce((s, r) => s + (toNum(r.horas) || 0), 0);

  const armar = (): { payload: ParteDiarioInput; fotos: Record<number, Blob> } | null => {
    const errs: string[] = [];
    const personal = f.personal.flatMap((r, i) => {
      const h = toNum(r.horas);
      if (!r.empleadoId && !r.horas) return [];
      if (!r.empleadoId || !(h > 0) || h > 24) {
        errs.push(`Personal fila ${i + 1}: elegí la persona y horas entre 0 y 24`);
        return [];
      }
      return [{ empleadoId: r.empleadoId, budgetItemId: r.budgetItemId, horas: h }];
    });
    const equipos = f.equipos.flatMap((r, i) => {
      const h = toNum(r.horas);
      if (!r.insumoId && !r.horas) return [];
      if (!r.insumoId || !(h > 0) || h > 24) {
        errs.push(`Equipos fila ${i + 1}: elegí el equipo y horas entre 0 y 24`);
        return [];
      }
      return [{ insumoId: r.insumoId, budgetItemId: r.budgetItemId, horas: h }];
    });
    const avance = f.avance.flatMap((r, i) => {
      const c = toNum(r.cantidad);
      if (!r.budgetItemId && !r.cantidad) return [];
      if (!r.budgetItemId || !Number.isFinite(c) || c === 0) {
        errs.push(`Avance fila ${i + 1}: elegí el ítem y una cantidad distinta de 0`);
        return [];
      }
      return [{ budgetItemId: r.budgetItemId, cantidad: c }];
    });
    const fotos: Record<number, Blob> = {};
    const combustible = f.combustible.flatMap((r, i) => {
      const l = toNum(r.litros);
      const h = r.horometro.trim() ? toNum(r.horometro) : null;
      if (!r.equipoId && !r.litros) return [];
      if (!r.equipoId || !(l > 0) || (h !== null && !(h >= 0))) {
        errs.push(`Combustible fila ${i + 1}: elegí el equipo, litros y un horómetro válido`);
        return [];
      }
      return [{ equipoId: r.equipoId, litros: l, horometro: h, fotoUrl: r.fotoUrl, _foto: r.foto }];
    });
    const combustibleOut = combustible.map(({ _foto, ...c }, i) => {
      if (_foto) fotos[i] = _foto;
      return c;
    });
    const viajes = f.viajes.flatMap((r, i) => {
      const c = toNum(r.cantidad);
      const km = r.km.trim() ? toNum(r.km) : null;
      if (!r.origen && !r.destino && !r.cantidad) return [];
      if (!r.origen.trim() || !r.destino.trim() || !(c > 0) || (km !== null && !(km >= 0))) {
        errs.push(`Viajes fila ${i + 1}: completá origen, destino y cantidad`);
        return [];
      }
      return [
        {
          equipoId: r.equipoId,
          origen: r.origen.trim(),
          destino: r.destino.trim(),
          materialId: r.materialId,
          materialTexto: r.materialId ? null : r.materialTexto.trim() || null,
          cantidad: c,
          unidad: r.unidad,
          km,
          budgetItemId: r.budgetItemId,
        },
      ];
    });
    if (!f.fecha || f.fecha > todayIso()) errs.push("La fecha no puede ser futura");
    const porEmp = new Map<number, number>();
    for (const p of personal) porEmp.set(p.empleadoId, (porEmp.get(p.empleadoId) ?? 0) + p.horas);
    for (const [id, h] of porEmp) if (h > 24) errs.push(`${empById.get(id)?.fullName}: más de 24 horas en el día`);
    if (!personal.length && !equipos.length && !avance.length && !combustibleOut.length && !viajes.length && !f.actividades.trim()) {
      errs.push("El parte está vacío: cargá horas, avance, combustible, viajes o actividades");
    }
    setErrores(errs);
    if (errs.length) return null;
    return {
      payload: {
        clientUuid: f.clientUuid,
        fecha: f.fecha,
        workFrontId: f.workFrontId,
        clima: f.clima || null,
        estadoFaena: f.estadoFaena,
        actividades: f.actividades.trim() || null,
        observaciones: f.observaciones.trim() || null,
        supervisor: f.supervisor.trim() || null,
        personal,
        equipos,
        avance,
        combustible: combustibleOut,
        viajes,
      },
      fotos,
    };
  };

  const guardar = async () => {
    const r = armar();
    if (!r) return;
    setSaving(true);
    try {
      await enqueueParte(project.id, r.payload, r.fotos);
      cacheRemove(draftKey);
      cacheSetJson("parte-supervisor", f.supervisor);
      const res = await flushOutbox();
      const mio = res.enviados.find((e) => e.item.clientUuid === r.payload.clientUuid);
      const rechazo = res.rechazados.find((e) => e.clientUuid === r.payload.clientUuid);
      if (mio) {
        showToast("Parte enviado", "success");
        for (const a of mio.avisos) showToast(a, "error");
      } else if (rechazo) {
        showToast(`El servidor rechazó el parte: ${rechazo.error}. Quedó en la lista para corregirlo.`, "error");
      } else {
        showToast("Sin conexión: el parte quedó guardado en el celular y se envía al volver la señal", "info");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar el parte", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (s: string) => setOpen((o) => ({ ...o, [s]: !o[s] }));

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white text-slate-900 sm:max-h-[94vh] sm:max-w-xl sm:border sm:border-slate-300">
        <header className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">{editar ? "Corregir parte diario" : "Parte diario"}</h2>
            <p className="text-xs text-slate-600">
              {project.code} · {project.name}
            </p>
          </div>
          <button onClick={onClose} className="p-2" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4">
          <Section title="Datos del día" count={0} open={open.datos} onToggle={() => toggle("datos")}>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Lbl>Fecha</Lbl>
                <input type="date" className={big} value={f.fecha} max={todayIso()} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
              </label>
              <label className="block">
                <Lbl>Frente</Lbl>
                <select className={big} value={f.workFrontId ?? ""} onChange={(e) => setF({ ...f, workFrontId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Toda la obra</option>
                  {catalogo.frentes.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Lbl>Clima</Lbl>
                <select className={big} value={f.clima} onChange={(e) => setF({ ...f, clima: e.target.value })}>
                  <option value="DESPEJADO">Despejado</option>
                  <option value="NUBLADO">Nublado</option>
                  <option value="LLUVIA_LEVE">Lluvia leve</option>
                  <option value="LLUVIA_INTENSA">Lluvia intensa</option>
                </select>
              </label>
              <label className="block">
                <Lbl>Jornada</Lbl>
                <select className={big} value={f.estadoFaena} onChange={(e) => setF({ ...f, estadoFaena: e.target.value as FormState["estadoFaena"] })}>
                  <option value="NORMAL">Normal</option>
                  <option value="PARCIAL">Parcial</option>
                  <option value="SUSPENDIDA">Suspendida</option>
                </select>
              </label>
            </div>
            <label className="block">
              <Lbl>Tareas del día</Lbl>
              <textarea rows={3} className={big} value={f.actividades} onChange={(e) => setF({ ...f, actividades: e.target.value })} />
            </label>
            <label className="block">
              <Lbl>Observaciones / demoras</Lbl>
              <input className={big} value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} />
            </label>
            <label className="block">
              <Lbl>Responsable</Lbl>
              <input className={big} value={f.supervisor} onChange={(e) => setF({ ...f, supervisor: e.target.value })} />
            </label>
          </Section>

          <Section title="Personal" count={f.personal.length} open={open.personal} onToggle={() => toggle("personal")}>
            {f.personal.map((r) => (
              <RowBox key={r.key} onRemove={() => del("personal", r.key)}>
                <SearchPick options={opts.empleados} value={r.empleadoId} onChange={(v) => upd("personal", r.key, { empleadoId: v })} placeholder="Persona…" />
                <SearchPick options={opts.items} value={r.budgetItemId} onChange={(v) => upd("personal", r.key, { budgetItemId: v })} placeholder="Ítem trabajado…" allowNone noneLabel="Sin ítem (se prorratea)" />
                <div className="flex items-center gap-2">
                  <input className={cx(numCls, "w-28")} inputMode="decimal" placeholder="Horas" value={r.horas} onChange={(e) => upd("personal", r.key, { horas: e.target.value })} />
                  <span className="text-sm">h</span>
                  {r.empleadoId && toNum(r.horas) > 0 && (
                    <span className="ml-auto text-sm tabular-nums text-slate-600">{formatGs(toNum(r.horas) * (empById.get(r.empleadoId)?.costoHora ?? 0))}</span>
                  )}
                </div>
              </RowBox>
            ))}
            <AddBtn onClick={() => setF((s) => ({ ...s, personal: [...s.personal, { key: k(), empleadoId: null, budgetItemId: lastItem(s.personal), horas: "8" }] }))}>Agregar persona</AddBtn>
            {f.personal.length > 0 && (
              <p className="text-sm tabular-nums">
                {formatQty(horasPersonal, 1)} h · costo con cargas {formatGs(costoPersonal)}
              </p>
            )}
          </Section>

          <Section title="Equipos" count={f.equipos.length} open={open.equipos} onToggle={() => toggle("equipos")}>
            {f.equipos.map((r) => (
              <RowBox key={r.key} onRemove={() => del("equipos", r.key)}>
                <SearchPick options={opts.equipos} value={r.insumoId} onChange={(v) => upd("equipos", r.key, { insumoId: v })} placeholder="Equipo…" />
                <SearchPick options={opts.items} value={r.budgetItemId} onChange={(v) => upd("equipos", r.key, { budgetItemId: v })} placeholder="Ítem trabajado…" allowNone noneLabel="Sin ítem (se prorratea)" />
                <div className="flex items-center gap-2">
                  <input className={cx(numCls, "w-28")} inputMode="decimal" placeholder="Horas" value={r.horas} onChange={(e) => upd("equipos", r.key, { horas: e.target.value })} />
                  <span className="text-sm">h</span>
                  {r.insumoId && (
                    <span className="ml-auto text-sm tabular-nums text-slate-600">{formatGs(equipoById.get(r.insumoId)?.costoHora ?? 0)} / h</span>
                  )}
                </div>
              </RowBox>
            ))}
            <AddBtn onClick={() => setF((s) => ({ ...s, equipos: [...s.equipos, { key: k(), insumoId: null, budgetItemId: lastItem(s.equipos), horas: "" }] }))}>Agregar equipo</AddBtn>
            {f.equipos.length > 0 && <p className="text-sm tabular-nums">{formatQty(horasEquipo, 1)} h de equipo</p>}
          </Section>

          <Section title="Avance del día" count={f.avance.length} open={open.avance} onToggle={() => toggle("avance")}>
            {f.avance.map((r) => {
              const it = r.budgetItemId ? itemById.get(r.budgetItemId) : null;
              return (
                <RowBox key={r.key} onRemove={() => del("avance", r.key)}>
                  <SearchPick options={opts.items} value={r.budgetItemId} onChange={(v) => upd("avance", r.key, { budgetItemId: v })} placeholder="Ítem…" />
                  <div className="flex items-center gap-2">
                    <input className={cx(numCls, "w-36")} inputMode="decimal" placeholder="Cantidad" value={r.cantidad} onChange={(e) => upd("avance", r.key, { cantidad: e.target.value })} />
                    <span className="text-sm">{it?.unit}</span>
                  </div>
                </RowBox>
              );
            })}
            <AddBtn onClick={() => setF((s) => ({ ...s, avance: [...s.avance, { key: k(), budgetItemId: null, cantidad: "" }] }))}>Agregar avance</AddBtn>
            <p className="text-xs text-slate-600">Avance provisorio: la medición oficial lo reemplaza al cerrar el período.</p>
          </Section>

          <Section title="Combustible" count={f.combustible.length} open={open.combustible} onToggle={() => toggle("combustible")}>
            {f.combustible.map((r) => {
              const eq = r.equipoId ? equipoById.get(r.equipoId) : null;
              return (
                <RowBox key={r.key} onRemove={() => del("combustible", r.key)}>
                  <SearchPick options={opts.equipos} value={r.equipoId} onChange={(v) => upd("combustible", r.key, { equipoId: v })} placeholder="Equipo…" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <Lbl>Litros</Lbl>
                      <input className={numCls} inputMode="decimal" value={r.litros} onChange={(e) => upd("combustible", r.key, { litros: e.target.value })} />
                    </label>
                    <label className="block">
                      <Lbl>Horómetro</Lbl>
                      <input className={numCls} inputMode="decimal" value={r.horometro} onChange={(e) => upd("combustible", r.key, { horometro: e.target.value })} />
                    </label>
                  </div>
                  {eq && <p className="text-xs text-slate-600">Consumo teórico: {eq.consumoLh ? `${formatQty(eq.consumoLh, 1)} L/h` : "sin cargar (no se controla el desvío)"}</p>}
                  <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-slate-400 py-3 text-base">
                    <Camera className="h-5 w-5" />
                    {r.foto || r.fotoUrl ? "Cambiar foto del ticket" : "Foto del ticket"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) upd("combustible", r.key, { foto: await comprimir(file), fotoUrl: null });
                      }}
                    />
                  </label>
                  {r.foto && <img src={preview(r.foto)} alt="Ticket" className="max-h-32 border border-slate-300" />}
                  {!r.foto && r.fotoUrl && <img src={r.fotoUrl} alt="Ticket" className="max-h-32 border border-slate-300" />}
                </RowBox>
              );
            })}
            <AddBtn onClick={() => setF((s) => ({ ...s, combustible: [...s.combustible, { key: k(), equipoId: null, litros: "", horometro: "", foto: null, fotoUrl: null }] }))}>
              Agregar carga
            </AddBtn>
            {f.combustible.some((c) => c.foto) && !editar && <p className="text-xs text-slate-600">La foto se guarda al enviar el parte (no en el borrador).</p>}
          </Section>

          <Section title="Viajes de camión" count={f.viajes.length} open={open.viajes} onToggle={() => toggle("viajes")}>
            {f.viajes.map((r) => (
              <RowBox key={r.key} onRemove={() => del("viajes", r.key)}>
                <SearchPick options={opts.equipos} value={r.equipoId} onChange={(v) => upd("viajes", r.key, { equipoId: v })} placeholder="Camión (opcional)…" allowNone noneLabel="Sin camión propio" />
                <div className="grid grid-cols-2 gap-2">
                  <input className={big} placeholder="Origen" value={r.origen} onChange={(e) => upd("viajes", r.key, { origen: e.target.value })} />
                  <input className={big} placeholder="Destino" value={r.destino} onChange={(e) => upd("viajes", r.key, { destino: e.target.value })} />
                </div>
                <SearchPick
                  options={opts.materiales}
                  value={r.materialId}
                  onChange={(v) => upd("viajes", r.key, { materialId: v })}
                  placeholder="Material…"
                  allowNone
                  noneLabel="Otro material (escribirlo)"
                />
                {!r.materialId && <input className={big} placeholder="Material (texto)" value={r.materialTexto} onChange={(e) => upd("viajes", r.key, { materialTexto: e.target.value })} />}
                <div className="grid grid-cols-3 gap-2">
                  <input className={numCls} inputMode="decimal" placeholder="Cantidad" value={r.cantidad} onChange={(e) => upd("viajes", r.key, { cantidad: e.target.value })} />
                  <select className={big} value={r.unidad} onChange={(e) => upd("viajes", r.key, { unidad: e.target.value as "M3" | "T" })}>
                    <option value="M3">m³</option>
                    <option value="T">t</option>
                  </select>
                  <input className={numCls} inputMode="decimal" placeholder="Km" value={r.km} onChange={(e) => upd("viajes", r.key, { km: e.target.value })} />
                </div>
                <SearchPick options={opts.items} value={r.budgetItemId} onChange={(v) => upd("viajes", r.key, { budgetItemId: v })} placeholder="Ítem…" allowNone />
              </RowBox>
            ))}
            <AddBtn
              onClick={() =>
                setF((s) => {
                  const prev = s.viajes[s.viajes.length - 1];
                  // Repetir el viaje anterior: lo habitual es varios viajes iguales en el día
                  const base = prev ? { ...prev, key: k() } : { key: k(), equipoId: null, origen: "", destino: "", materialId: null, materialTexto: "", cantidad: "", unidad: "M3" as const, km: "", budgetItemId: null };
                  return { ...s, viajes: [...s.viajes, base] };
                })
              }
            >
              {f.viajes.length ? "Repetir viaje" : "Agregar viaje"}
            </AddBtn>
          </Section>

          {errores.length > 0 && (
            <ul className="mb-4 space-y-1 border border-red-600 p-3 text-sm text-red-600">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex gap-2 border-t border-slate-300 p-3">
          {!editar && (
            <button
              type="button"
              className="border border-slate-400 px-4 py-3 text-base"
              onClick={() => {
                if (confirm("¿Descartar el borrador?")) {
                  cacheRemove(draftKey);
                  setF(vacio());
                  setErrores([]);
                }
              }}
            >
              Limpiar
            </button>
          )}
          <button type="button" className="flex-1 bg-slate-900 py-3 text-base font-semibold text-white disabled:opacity-40" disabled={saving} onClick={guardar}>
            {saving ? "Guardando…" : "Guardar parte"}
          </button>
        </footer>
      </div>
    </div>
  );
}
