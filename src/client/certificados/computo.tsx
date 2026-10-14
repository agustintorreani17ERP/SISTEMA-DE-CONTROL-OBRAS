import React, { useRef } from "react";
import { Camera, ImagePlus, Plus, X } from "lucide-react";
import { Button, cx, inputClass } from "../ui";
import { auxFormula, auxSubtotal, measuredQuantity } from "../../ecms/modules/certifications/certMath";
import { formatQty } from "../utils/numbers";

/** Línea del cómputo auxiliar de una medición (piezas × largo × ancho × alto). */
export interface AuxRow {
  key: number;
  location: string;
  factor_repeticion: string;
  largo: string;
  ancho: string;
  alto: string;
  isDeduction: boolean;
  needsReview: boolean;
}

export interface Photo {
  url: string;
  name: string;
}

let seq = 1;
export const nextKey = () => seq++;
export const newLine = (): AuxRow => ({ key: seq++, location: "", factor_repeticion: "1", largo: "", ancho: "", alto: "", isDeduction: false, needsReview: false });
export const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
export const toAux = (l: AuxRow) => ({
  largo: num(l.largo),
  ancho: num(l.ancho),
  alto: num(l.alto),
  factor_repeticion: l.factor_repeticion.trim() === "" ? 1 : num(l.factor_repeticion),
  isDeduction: l.isDeduction,
});
export const qtyOfLines = (lines: AuxRow[]) => measuredQuantity(lines.map(toAux));

/** Payload del cómputo para la API. */
export const auxPayload = (lines: AuxRow[]) =>
  lines.map((l) => ({ descripcion: l.location || "Medición", location: l.location || null, ...toAux(l), needsReview: l.needsReview }));

/** Tabla editable del cómputo auxiliar. */
export function ComputoTable({ lines, onChange }: { lines: AuxRow[]; onChange: (lines: AuxRow[]) => void }) {
  const update = (key: number, patch: Partial<AuxRow>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="pb-2">Sector / ubicación</th>
            <th className="w-16 pb-2">Piezas</th>
            <th className="w-20 pb-2">Largo</th>
            <th className="w-20 pb-2">Ancho</th>
            <th className="w-20 pb-2">Alto</th>
            <th className="w-16 pb-2 text-center" title="Descuento (vanos, aberturas)">
              Desc.
            </th>
            <th className="w-12 pb-2 text-center" title="Marcar para revisar">
              [?]
            </th>
            <th className="pb-2 text-right">Resultado</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const sub = auxSubtotal(toAux(l));
            return (
              <tr key={l.key} className={cx(l.needsReview && "bg-amber-50")}>
                <td className="py-1 pr-2">
                  <input value={l.location} onChange={(e) => update(l.key, { location: e.target.value })} placeholder="Ej. Muro eje A" className={inputClass} />
                </td>
                {(["factor_repeticion", "largo", "ancho", "alto"] as const).map((k) => (
                  <td key={k} className="py-1 pr-2">
                    <input inputMode="decimal" value={l[k]} onChange={(e) => update(l.key, { [k]: e.target.value })} className={`${inputClass} px-2`} />
                  </td>
                ))}
                <td className="text-center">
                  <input type="checkbox" checked={l.isDeduction} onChange={(e) => update(l.key, { isDeduction: e.target.checked })} />
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={l.needsReview} onChange={(e) => update(l.key, { needsReview: e.target.checked })} />
                </td>
                <td className="py-1 text-right">
                  <p className={cx("font-medium tabular-nums", sub < 0 ? "text-rose-600" : "text-slate-900")}>{formatQty(sub)}</p>
                  <p className="text-[11px] text-slate-400">{auxFormula(toAux(l))}</p>
                </td>
                <td>
                  <button
                    onClick={() => onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : lines)}
                    className="p-1 text-slate-300 hover:text-rose-600"
                    aria-label="Quitar línea"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...lines, newLine()])} className="mt-2">
        Línea de cómputo
      </Button>
    </>
  );
}

export function PhotoStrip({ photos, onAdd, onRemove }: { photos: Photo[]; onAdd: (files: FileList | null) => void; onRemove: (url: string) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onAdd(e.target.files)} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onAdd(e.target.files)} />
      <Button size="sm" icon={<Camera className="h-4 w-4" />} onClick={() => camera.current?.click()}>
        Sacar foto
      </Button>
      <Button size="sm" icon={<ImagePlus className="h-4 w-4" />} onClick={() => gallery.current?.click()}>
        Subir imagen
      </Button>
      {photos.map((p) => (
        <div key={p.url} className="group relative">
          <img src={p.url} alt={p.name} className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
          <button onClick={() => onRemove(p.url)} className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-white p-0.5 text-rose-600 shadow group-hover:block" aria-label="Quitar foto">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
