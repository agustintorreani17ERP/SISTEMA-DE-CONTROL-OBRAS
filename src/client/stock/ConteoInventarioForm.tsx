import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { api } from "../api";
import type { Material, Project } from "../types";
import { cx } from "../ui";
import { formatQty } from "../utils/numbers";
import { todayIso } from "../insumos/labels";
import { fmtDate } from "../compras/status";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

interface Resultado {
  insumo: string;
  unidad: string;
  fecha: string;
  contada: number;
  teorico: number;
  diferencia: number;
}

const big = "w-full border border-slate-400 bg-white px-3 py-3 text-base text-slate-900 focus:outline-2 focus:outline-slate-900";

/**
 * Conteo de inventario pensado para el celular: obra, fecha (cualquier día hasta hoy), insumo,
 * cantidad contada y foto opcional. Conteo "a ciegas": el teórico se muestra después de guardar.
 */
export function ConteoInventarioForm({
  project,
  materials,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  materials: Material[];
  onClose: () => void;
  onSaved: () => void;
  showToast: Toast;
}) {
  const [projects, setProjects] = useState<Project[]>([project]);
  const [projectId, setProjectId] = useState(project.id);
  const [fecha, setFecha] = useState(todayIso());
  const [q, setQ] = useState("");
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getProjects()
      .then((ps) => ps.length && setProjects(ps))
      .catch(() => undefined);
  }, []);

  const countable = useMemo(() => materials.filter((m) => m.tipo !== "TIEMPO"), [materials]);
  const material = countable.find((m) => m.id === materialId) ?? null;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return countable.filter((m) => `${m.code} ${m.description}`.toLowerCase().includes(t)).slice(0, 12);
  }, [countable, q]);

  const cantidadNum = Number(cantidad.replace(",", "."));
  const ok = projectId && fecha && fecha <= todayIso() && material && cantidad.trim() !== "" && Number.isFinite(cantidadNum) && cantidadNum >= 0;

  const pickFoto = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      setFoto(await api.uploadImage(file));
    } catch (e: any) {
      showToast(e.message || "No se pudo subir la foto", "error");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!ok || !material) return;
    setSaving(true);
    try {
      const r = await api.createConteo({
        projectId,
        materialId: material.id,
        fecha,
        cantidadContada: cantidadNum,
        fotoUrl: foto?.url ?? null,
        nota: nota.trim() || null,
      });
      setResultado({
        insumo: `${material.code} ${material.description}`,
        unidad: material.unit,
        fecha,
        contada: r.cantidadContada,
        teorico: r.stockTeorico,
        diferencia: r.diferencia,
      });
      onSaved();
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar el conteo", "error");
    } finally {
      setSaving(false);
    }
  };

  const otro = () => {
    setResultado(null);
    setMaterialId(null);
    setQ("");
    setCantidad("");
    setNota("");
    setFoto(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white text-slate-900 sm:max-h-[92vh] sm:max-w-md sm:border sm:border-slate-300">
        <header className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
          <h2 className="text-lg font-semibold">Conteo de inventario</h2>
          <button onClick={onClose} className="p-2" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </header>

        {resultado ? (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <p className="text-sm text-slate-600">Conteo guardado</p>
            <p className="text-base font-semibold">{resultado.insumo}</p>
            <table className="w-full text-base">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2">Fecha</td>
                  <td className="py-2 text-right">{fmtDate(resultado.fecha)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2">Stock teórico</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatQty(resultado.teorico)} {resultado.unidad}
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2">Contado</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatQty(resultado.contada)} {resultado.unidad}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold">Diferencia</td>
                  <td className={cx("py-2 text-right font-semibold tabular-nums", resultado.diferencia < 0 && "text-red-600")}>
                    {resultado.diferencia > 0 ? "+" : ""}
                    {formatQty(resultado.diferencia)} {resultado.unidad}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-500">La diferencia queda como ajuste por conteo con esta fecha. No se carga a ningún ítem: es pérdida (o sobrante) de material.</p>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Obra</span>
              <select className={big} value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Fecha del conteo</span>
              <input type="date" className={big} value={fecha} max={todayIso()} onChange={(e) => setFecha(e.target.value)} />
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium">Insumo</span>
              {material ? (
                <div className="flex items-center justify-between gap-2 border border-slate-400 px-3 py-3">
                  <span className="text-base">
                    <span className="font-mono text-sm">{material.code}</span> {material.description}
                  </span>
                  <button className="shrink-0 px-2 text-sm underline" onClick={() => setMaterialId(null)}>
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <input className={big} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscá por código o nombre" autoFocus />
                  {matches.length > 0 && (
                    <ul className="mt-1 border border-slate-300">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button
                            className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-3 text-left text-base"
                            onClick={() => {
                              setMaterialId(m.id);
                              setTimeout(() => qtyRef.current?.focus(), 50);
                            }}
                          >
                            <span className="w-20 shrink-0 font-mono text-sm">{m.code}</span>
                            <span className="flex-1">{m.description}</span>
                            <span className="text-sm text-slate-500">{m.unit}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Cantidad contada {material ? `(${material.unit})` : ""}</span>
              <input
                ref={qtyRef}
                className={cx(big, "text-right text-xl tabular-nums")}
                inputMode="decimal"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="0"
              />
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium">Foto (opcional)</span>
              <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-slate-400 px-3 py-4 text-base">
                <Camera className="h-5 w-5" />
                {uploading ? "Subiendo…" : foto ? "Cambiar foto" : "Sacar o elegir foto"}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickFoto(e.target.files?.[0])} />
              </label>
              {foto && <img src={foto.url} alt="Foto del conteo" className="mt-2 max-h-40 border border-slate-300" />}
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Nota (opcional)</span>
              <input className={big} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ubicación, estado…" />
            </label>
          </div>
        )}

        <footer className="flex gap-2 border-t border-slate-300 p-3">
          {resultado ? (
            <>
              <button className="flex-1 border border-slate-400 py-3 text-base" onClick={onClose}>
                Terminar
              </button>
              <button className="flex-1 bg-slate-900 py-3 text-base font-semibold text-white" onClick={otro}>
                Contar otro
              </button>
            </>
          ) : (
            <button className="w-full bg-slate-900 py-3 text-base font-semibold text-white disabled:opacity-40" disabled={!ok || saving || uploading} onClick={save}>
              {saving ? "Guardando…" : "Guardar conteo"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
