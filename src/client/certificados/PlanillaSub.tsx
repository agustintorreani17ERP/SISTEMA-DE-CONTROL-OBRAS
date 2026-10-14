import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { MeasurableItem, PlanillaSubData } from "../types";
import { Button, cx, Field, inputClass, Modal } from "../ui";
import { numeroLinea, siguienteCorrelativo, sugerirRubro, type MotivoSugerencia } from "../../ecms/domain/asignacionMO";
import { formatQty } from "../utils/numbers";
import { auxPayload, ComputoTable, newLine, nextKey, num, PhotoStrip, qtyOfLines, type AuxRow, type Photo } from "./computo";

/** Renglón de la planilla del subcontratista: frente + rubro MO → línea numerada → rubro presupuestario. */
export interface SubRow {
  key: number;
  workFrontId: number;
  laborPriceId: number;
  budgetItemId: number | null;
  motivo: MotivoSugerencia | null;
  unitPrice: string;
  lines: AuxRow[];
  photos: Photo[];
}

const MOTIVO: Record<MotivoSugerencia, string> = {
  MEMORIA: "usado antes en este frente",
  SIMILAR: "parecido, misma unidad",
  AREA: "del área",
  GASTOS_GENERALES: "frente auxiliar",
};

export const subRowQty = (r: SubRow) => qtyOfLines(r.lines);
export const subRowAmount = (r: SubRow) => Math.round(subRowQty(r) * num(r.unitPrice));

/**
 * Línea existente del contratista para la combinación, o número provisorio (siguiente correlativo
 * del frente). El servidor asigna lo mismo al guardar.
 */
export function numerarFilas(rows: SubRow[], data: PlanillaSubData) {
  const out = new Map<number, { numero: string; lineaId: number | null; anterior: number }>();
  const usados = new Map<number, number[]>();
  for (const l of data.lineas) usados.set(l.workFrontId, [...(usados.get(l.workFrontId) ?? []), l.correlativo]);
  const nuevas = new Map<string, string>();
  for (const r of rows) {
    const linea = data.lineas.find((l) => l.workFrontId === r.workFrontId && l.laborPriceId === r.laborPriceId && l.budgetItemId === r.budgetItemId);
    if (linea) {
      out.set(r.key, { numero: linea.numero, lineaId: linea.id, anterior: linea.cantidadAnterior ?? 0 });
      continue;
    }
    const combo = `${r.workFrontId}|${r.laborPriceId}|${r.budgetItemId}`;
    let numero = nuevas.get(combo);
    if (!numero) {
      const corr = siguienteCorrelativo(usados.get(r.workFrontId) ?? []);
      usados.set(r.workFrontId, [...(usados.get(r.workFrontId) ?? []), corr]);
      numero = numeroLinea(data.frentes.find((f) => f.id === r.workFrontId)?.codigo ?? String(r.workFrontId), corr);
      nuevas.set(combo, numero);
    }
    out.set(r.key, { numero, lineaId: null, anterior: 0 });
  }
  return out;
}

/** Payload de los renglones para createCertification. */
export const subRowsPayload = (rows: SubRow[], numeros: ReturnType<typeof numerarFilas>) =>
  rows.map((r) => ({
    planillaLineaId: numeros.get(r.key)?.lineaId ?? null,
    workFrontId: r.workFrontId,
    laborPriceId: r.laborPriceId,
    budgetItemId: r.budgetItemId,
    precioUnitario: num(r.unitPrice),
    priceSource: "MANO_DE_OBRA" as const,
    auxiliaryCalculations: auxPayload(r.lines),
    photos: r.photos.map((p) => ({ url: p.url, comentario: p.name })),
  }));

const itemLabel = (i: MeasurableItem) => `${i.code} · ${i.name}${i.capitulo ? ` — ${i.capitulo}` : ""}`;

export function PlanillaSub({
  projectId,
  data,
  setData,
  rows,
  setRows,
  money,
  showToast,
}: {
  projectId: number;
  data: PlanillaSubData;
  setData: (d: PlanillaSubData) => void;
  rows: SubRow[];
  setRows: React.Dispatch<React.SetStateAction<SubRow[]>>;
  money: (v: number) => string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [frenteId, setFrenteId] = useState<number | "">(rows[rows.length - 1]?.workFrontId ?? "");
  const [nuevoFrente, setNuevoFrente] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const numeros = useMemo(() => numerarFilas(rows, data), [rows, data]);
  const itemsById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const ggId = data.gastosGenerales?.id ?? null;

  const update = (key: number, patch: Partial<SubRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const crearFrente = async () => {
    if (!nuevoFrente?.trim()) return showToast("Poné el nombre del frente auxiliar", "error");
    try {
      const f = await api.createWorkFront({ projectId, name: nuevoFrente.trim() });
      setData({ ...data, frentes: [...data.frentes, { id: f.id, name: f.name, codigo: f.codigo ?? null, tipo: "AUXILIAR", budgetItemId: null }] });
      setFrenteId(f.id);
      setNuevoFrente(null);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el frente", "error");
    }
  };

  const agregar = (laborPriceId: number) => {
    const frente = data.frentes.find((f) => f.id === frenteId);
    const lp = data.listaMO.find((l) => l.id === laborPriceId);
    if (!frente || !lp) return;
    const items = data.items.map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, areaId: i.areaId ?? null }));
    const { sugerido } = sugerirRubro(frente, lp, items, data.historial, { gastosGeneralesId: ggId });
    setRows((prev) => [
      ...prev,
      {
        key: nextKey(),
        workFrontId: frente.id,
        laborPriceId: lp.id,
        budgetItemId: sugerido?.budgetItemId ?? null,
        motivo: sugerido?.motivo ?? null,
        unitPrice: String(lp.unitPrice),
        lines: [newLine()],
        photos: [],
      },
    ]);
    setAdding(false);
  };

  const addPhotos = async (key: number, files: FileList | null) => {
    if (!files?.length) return;
    try {
      const uploaded = await Promise.all([...files].map((f) => api.uploadImage(f)));
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, photos: [...r.photos, ...uploaded] } : r)));
    } catch (err: any) {
      showToast(err.message || "No se pudo subir la foto", "error");
    }
  };

  const total = rows.reduce((a, r) => a + subRowAmount(r), 0);

  return (
    <div className="space-y-4 text-black">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3">
        <Field label="Frente">
          {nuevoFrente === null ? (
            <div className="flex gap-2">
              <select value={frenteId} onChange={(e) => setFrenteId(e.target.value ? Number(e.target.value) : "")} className={`${inputClass} min-w-[260px]`}>
                <option value="">Elegí el frente…</option>
                {data.frentes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.codigo ?? "—"} · {f.name}
                    {f.tipo === "AUXILIAR" ? " (auxiliar)" : ""}
                  </option>
                ))}
              </select>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNuevoFrente("")}>
                Nuevo frente auxiliar
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input autoFocus value={nuevoFrente} onChange={(e) => setNuevoFrente(e.target.value)} placeholder="Nombre del frente auxiliar" className={inputClass} />
              <Button variant="primary" onClick={crearFrente}>
                Crear
              </Button>
              <Button onClick={() => setNuevoFrente(null)}>Cancelar</Button>
            </div>
          )}
        </Field>
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={!frenteId} onClick={() => setAdding(true)}>
          Agregar rubro
        </Button>
        <p className="ml-auto text-sm">
          {rows.length} línea(s) · <strong className="tabular-nums">{money(total)}</strong>
        </p>
      </div>

      {!data.listaMO.length && <p className="text-sm text-red-600">La obra no tiene lista de precios de MO: cargala en Configuración antes de medir subcontratistas.</p>}

      {rows.map((r) => {
        const frente = data.frentes.find((f) => f.id === r.workFrontId);
        const lp = data.listaMO.find((l) => l.id === r.laborPriceId);
        const nro = numeros.get(r.key);
        const item = r.budgetItemId !== null ? itemsById.get(r.budgetItemId) : undefined;
        const q = subRowQty(r);
        const precio = num(r.unitPrice);
        const distinto = lp && Math.abs(precio - lp.unitPrice) > 0.5;
        const sug = lp && frente ? sugerirRubro(frente, lp, data.items.map((i) => ({ ...i, areaId: i.areaId ?? null })), data.historial, { gastosGeneralesId: ggId }) : null;
        const candidatos = new Set(sug?.candidatos.map((c) => c.budgetItemId) ?? []);
        const unidad = item?.unit ?? (r.budgetItemId === ggId ? data.gastosGenerales?.unit : null) ?? lp?.unit ?? "";
        return (
          <div key={r.key} className="border border-slate-300">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="font-semibold">
                  N° {nro?.numero} · {lp?.code} {lp?.description}
                </p>
                <p className="text-xs">
                  Frente {frente?.codigo ?? "—"} · {frente?.name} · Lista {money(lp?.unitPrice ?? 0)} / {lp?.unit ?? "—"}
                  {nro?.lineaId ? ` · Anterior ${formatQty(nro.anterior)}` : " · Línea nueva"}
                </p>
              </div>
              <button onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} className="p-1.5 hover:text-red-600" aria-label="Quitar línea">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]">
              <Field label="Rubro presupuestario" hint={r.motivo && r.budgetItemId !== null ? `Sugerido: ${MOTIVO[r.motivo]}` : "Sin asignar: se puede guardar como borrador, no aprobar"}>
                <select
                  value={r.budgetItemId ?? ""}
                  onChange={(e) => update(r.key, { budgetItemId: e.target.value ? Number(e.target.value) : null, motivo: null })}
                  className={cx(inputClass, r.budgetItemId === null && "border-red-600")}
                >
                  <option value="">Sin asignar</option>
                  {sug && sug.candidatos.length > 0 && (
                    <optgroup label="Sugeridos para este frente">
                      {sug.candidatos.map((c) => {
                        const it = itemsById.get(c.budgetItemId);
                        const label = it ? itemLabel(it) : c.budgetItemId === ggId ? `${data.gastosGenerales?.code} · ${data.gastosGenerales?.name}` : String(c.budgetItemId);
                        return (
                          <option key={c.budgetItemId} value={c.budgetItemId}>
                            {label} ({MOTIVO[c.motivo]})
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  <optgroup label="Otros ítems de la obra">
                    {data.items
                      .filter((i) => !candidatos.has(i.id))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {itemLabel(i)}
                        </option>
                      ))}
                    {data.gastosGenerales && !candidatos.has(data.gastosGenerales.id) && (
                      <option value={data.gastosGenerales.id}>
                        {data.gastosGenerales.code} · {data.gastosGenerales.name}
                      </option>
                    )}
                  </optgroup>
                </select>
              </Field>
            </div>

            <div className="overflow-x-auto px-4 pb-3">
              <ComputoTable lines={r.lines} onChange={(lines) => update(r.key, { lines })} />
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
              <Field label={`Precio unitario (${lp?.unit ?? "—"})`} hint={distinto ? undefined : "De la lista de MO de la obra"}>
                <input inputMode="decimal" value={r.unitPrice} onChange={(e) => update(r.key, { unitPrice: e.target.value })} className={`${inputClass} w-36`} />
              </Field>
              {distinto && <p className="text-red-600">Precio distinto de la lista ({money(lp?.unitPrice ?? 0)}): se avisará al aprobar.</p>}
              <p>
                Cantidad: <strong className="tabular-nums">{formatQty(q)} {unidad}</strong>
                · <span className="tabular-nums">{money(subRowAmount(r))}</span>
              </p>
            </div>

            <PhotoStrip photos={r.photos} onAdd={(files) => addPhotos(r.key, files)} onRemove={(url) => update(r.key, { photos: r.photos.filter((p) => p.url !== url) })} />
          </div>
        );
      })}

      {adding && <ListaMOModal lista={data.listaMO} money={money} onClose={() => setAdding(false)} onPick={agregar} />}
    </div>
  );
}

function ListaMOModal({
  lista,
  money,
  onClose,
  onPick,
}: {
  lista: PlanillaSubData["listaMO"];
  money: (v: number) => string;
  onClose: () => void;
  onPick: (laborPriceId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const list = lista.filter((l) => !q || `${l.code} ${l.description} ${l.sector ?? ""}`.toLowerCase().includes(q)).slice(0, 80);
  return (
    <Modal title="Agregar rubro de la lista de MO" onClose={onClose} footer={<Button onClick={onClose}>Cancelar</Button>}>
      <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, descripción o sector…" className={inputClass} />
      <div className="max-h-80 divide-y divide-slate-200 overflow-y-auto border border-slate-200">
        {list.map((l) => (
          <button key={l.id} onClick={() => onPick(l.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-black hover:underline">
            <span className="min-w-0">
              <span className="block truncate">
                {l.code} · {l.description}
              </span>
              {l.sector && <span className="text-xs">{l.sector}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums">
              {money(l.unitPrice)} / {l.unit ?? "—"}
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="px-3 py-6 text-center text-sm">No hay rubros que coincidan.</p>}
      </div>
    </Modal>
  );
}
