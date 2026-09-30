import React, { useState } from "react";
import { api } from "../api";
import { MoImportPreview, MoImportStatus } from "../types";
import { Button, Field, Modal, cx, inputClass } from "../ui";
import { formatGs } from "../utils/numbers";
import { SECTOR_LABEL, todayIso } from "./labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const STATUS_LABEL: Record<MoImportStatus, string> = {
  NUEVO: "Nuevo",
  CAMBIA_PRECIO: "Cambia precio",
  ACTUALIZA_DATOS: "Actualiza datos",
  SIN_CAMBIOS: "Sin cambios",
  ERROR: "Error",
};
const IMPORTABLE: MoImportStatus[] = ["NUEVO", "CAMBIA_PRECIO", "ACTUALIZA_DATOS"];

export const ImportMOModal: React.FC<{ onClose: () => void; onImported: () => void; showToast: Toast }> = ({
  onClose,
  onImported,
  showToast,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [desde, setDesde] = useState(todayIso());
  const [preview, setPreview] = useState<MoImportPreview | null>(null);
  const [soloCambios, setSoloCambios] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = async () => {
    setBusy(true);
    try {
      setPreview(await api.previewImportMO({ file: file ?? undefined, pastedText: file ? undefined : pasted, vigenteDesde: desde }));
    } catch (e: any) {
      showToast(e.message || "No se pudo leer la planilla", "error");
    } finally {
      setBusy(false);
    }
  };

  const toImport = preview?.rows.filter((r) => IMPORTABLE.includes(r.status)) ?? [];

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await api.commitImportMO({
        vigenteDesde: preview.vigenteDesde,
        fileName: file?.name,
        rows: toImport.map((r) => ({ code: r.code, description: r.description, unit: r.unit, price: r.price ?? 0, sector: r.sector })),
      });
      showToast(`${res.creados} insumos nuevos, ${res.actualizados} actualizados, ${res.preciosNuevos} precios cargados`, "success");
      onImported();
    } catch (e: any) {
      showToast(e.message || "No se pudo importar", "error");
    } finally {
      setBusy(false);
    }
  };

  const rows = preview ? (soloCambios ? preview.rows.filter((r) => r.status !== "SIN_CAMBIOS") : preview.rows) : [];

  return (
    <Modal
      size="lg"
      title="Importar lista de mano de obra de contratistas"
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button onClick={() => setPreview(null)}>Volver</Button>
            <Button variant="primary" onClick={commit} disabled={busy || toImport.length === 0}>
              {busy ? "Importando…" : `Importar ${toImport.length} filas`}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={read} disabled={busy || (!file && !pasted.trim())}>
              {busy ? "Leyendo…" : "Leer planilla"}
            </Button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="space-y-4 text-slate-900">
          <p className="text-sm text-slate-600">
            Columnas esperadas: <b>ITEM</b>, <b>DESCRIPCIÓN</b>, <b>UNIDAD</b>, <b>PRECIO</b> y opcionalmente <b>SECTOR</b>. Las filas
            "Planta baja" / "Planta alta" fijan el sector de las filas siguientes. Se crean como insumos <b>Directo · Mano de obra</b>{" "}
            con código <span className="font-mono">MO-&lt;ítem&gt;</span>.
          </p>
          <Field label="Archivo Excel o CSV">
            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          {!file && (
            <Field label="…o pegá las celdas copiadas de Excel">
              <textarea className={cx(inputClass, "h-32 font-mono text-xs")} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </Field>
          )}
          <Field label="Precios vigentes desde" className="w-48">
            <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3 text-slate-900">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              Hoja <b>{preview.sheetName}</b> · vigencia {preview.vigenteDesde.split("-").reverse().join("/")}
            </span>
            <span>{preview.summary.nuevos} nuevos</span>
            <span>{preview.summary.cambiaPrecio} cambian precio</span>
            <span>{preview.summary.actualizaDatos} actualizan datos</span>
            <span>{preview.summary.sinCambios} sin cambios</span>
            {preview.summary.errores > 0 && <span className="font-semibold text-red-600">{preview.summary.errores} con error (no se importan)</span>}
            <label className="ml-auto flex items-center gap-2">
              <input type="checkbox" checked={soloCambios} onChange={(e) => setSoloCambios(e.target.checked)} />
              Ocultar sin cambios
            </label>
          </div>
          <div className="max-h-[55vh] overflow-auto border border-slate-300">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-300 text-left font-semibold">
                  <th className="px-2 py-1.5">Fila</th>
                  <th className="px-2 py-1.5">Código</th>
                  <th className="px-2 py-1.5">Descripción</th>
                  <th className="px-2 py-1.5">Un.</th>
                  <th className="px-2 py-1.5">Sector</th>
                  <th className="px-2 py-1.5 text-right">Actual</th>
                  <th className="px-2 py-1.5 text-right">Nuevo</th>
                  <th className="px-2 py-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-1 text-slate-500">{r.rowNumber}</td>
                    <td className="px-2 py-1 font-mono">{r.code || "—"}</td>
                    <td className="px-2 py-1">{r.description}</td>
                    <td className="px-2 py-1">{r.unit}</td>
                    <td className="px-2 py-1">{r.sector ? SECTOR_LABEL[r.sector] ?? r.sector : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatGs(r.precioActual)}</td>
                    <td className={cx("px-2 py-1 text-right tabular-nums", r.status === "CAMBIA_PRECIO" && "font-semibold")}>
                      {formatGs(r.price)}
                    </td>
                    <td className="px-2 py-1">
                      <span className={cx(r.status === "ERROR" && "font-semibold text-red-600")}>{STATUS_LABEL[r.status]}</span>
                      {r.errors.map((e) => (
                        <div key={e} className="text-red-600">
                          {e}
                        </div>
                      ))}
                      {r.warnings.map((w) => (
                        <div key={w} className="text-slate-500">
                          {w}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
};
