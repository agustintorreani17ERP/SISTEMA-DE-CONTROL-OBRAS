import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, HardHat, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { LaborPrice, LaborPreviewRow, Project } from "../types";
import { Button, Card, EmptyState, Field, inputClass, Modal } from "../ui";
import { ActionBar } from "../ui/actions";
import { formatMoney } from "../utils/format";
import { SECTOR_LABEL } from "../insumos/labels";

interface LaborPricesPanelProps {
  project: Project;
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  openImport?: number;
}

const AYUDA = "La lista es por obra. El rubro del presupuesto se asigna en cada medición de subcontratista, según el frente.";
const sectorLabel = (s: string | null) => (s ? SECTOR_LABEL[s] ?? s : "—");

/**
 * Lista de precios de mano de obra de la obra: catálogo de lo que la empresa paga al subcontratista
 * por unidad (código, descripción, unidad, precio y sector).
 */
export function LaborPricesPanel({ project, currency, showToast, openImport }: LaborPricesPanelProps) {
  const [prices, setPrices] = useState<LaborPrice[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrices(await api.getLaborPrices(project.id));
    } catch (err: any) {
      showToast(err.message || "No se pudo cargar la lista de precios", "error");
    }
  }, [project.id, showToast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (openImport) setImporting(true);
  }, [openImport]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prices.filter((p) => !q || `${p.code} ${p.description} ${sectorLabel(p.sector)}`.toLowerCase().includes(q));
  }, [prices, search]);

  const updatePrice = async (p: LaborPrice, patch: { unitPrice: number }) => {
    try {
      await api.updateLaborPrice(p.id, patch);
      load();
    } catch (err: any) {
      showToast(err.message || "No se pudo actualizar", "error");
    }
  };

  return (
    <div className="space-y-4">
      <ActionBar
        search={search}
        onSearch={setSearch}
        chips={[{ value: "all", label: "Precios cargados", count: prices.length }]}
        chip="all"
        secondary={[{ label: "Agregar un precio", icon: <Plus className="h-4 w-4" />, onClick: () => setAdding(true) }]}
        primary={
          <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImporting(true)}>
            Importar planilla
          </Button>
        }
      />
      <p className="text-sm text-black">{AYUDA}</p>

      {prices.length === 0 ? (
        <EmptyState
          icon={<HardHat className="h-10 w-10" />}
          title="Todavía no hay precios de mano de obra"
          help="Cargá la planilla con lo que pagás a los subcontratistas: código, descripción, unidad, precio y sector (planta baja / alta)."
          action={
            <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImporting(true)}>
              Importar planilla
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm text-black">
              <thead className="text-left text-xs">
                <tr className="border-b border-slate-200">
                  <th className="w-24 px-5 py-3">Código</th>
                  <th className="px-3 py-3">Descripción</th>
                  <th className="w-20 px-3 py-3">Unidad</th>
                  <th className="w-36 px-3 py-3 text-right">Precio</th>
                  <th className="w-32 px-3 py-3">Sector</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2.5 tabular-nums">{p.code}</td>
                    <td className="px-3 py-2.5">{p.description}</td>
                    <td className="px-3 py-2.5">{p.unit || "un"}</td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min={0}
                        defaultValue={p.unitPrice}
                        key={`${p.id}-${p.unitPrice}`}
                        onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== p.unitPrice && updatePrice(p, { unitPrice: Number(e.target.value) })}
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="px-3 py-2.5">{sectorLabel(p.sector)}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={async () => {
                          if (!window.confirm(`¿Borrar "${p.description}"?`)) return;
                          await api.deleteLaborPrice(p.id);
                          load();
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600"
                        aria-label="Borrar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {importing && (
        <LaborImportModal
          project={project}
          currency={currency}
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            load();
          }}
          showToast={showToast}
        />
      )}
      {adding && (
        <AddPriceModal
          project={project}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function LaborImportModal({
  project,
  currency,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: () => void;
  showToast: LaborPricesPanelProps["showToast"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<LaborPreviewRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = (rows ?? []).filter((r) => !r.errors.length && r.unitPrice);

  const preview = async () => {
    setLoading(true);
    try {
      const data = await api.previewLaborPrices(project.id, { file, pastedText: pasted || undefined });
      setRows(data.rows);
      showToast(`${data.summary.total} precios leídos${data.summary.errores ? `, ${data.summary.errores} con errores` : ""}`);
    } catch (err: any) {
      showToast(err.message || "No se pudo leer la planilla", "error");
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    setLoading(true);
    try {
      const res = await api.commitLaborPrices(
        project.id,
        valid.map((r) => ({ code: r.code, description: r.description, unit: r.unit, unitPrice: r.unitPrice!, sector: r.sector })),
        file?.name
      );
      showToast(`${res.saved} precios de mano de obra guardados, ${res.preciosInsumo} precios de insumo MO cargados`);
      if (res.conflictos.length) {
        showToast(`Sin cambiar el precio de ${res.conflictos.join(", ")}: ya tenían otro precio con fecha de hoy`, "info");
      }
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Importar precios de mano de obra"
      size="lg"
      onClose={onClose}
      footer={
        rows ? (
          <>
            <Button onClick={() => setRows(null)}>Atrás</Button>
            <Button variant="primary" onClick={commit} disabled={loading || !valid.length}>
              Guardar {valid.length} precios
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={preview} disabled={loading || (!file && !pasted.trim())}>
              Leer planilla
            </Button>
          </>
        )
      }
    >
      {!rows ? (
        <>
          <p className="text-sm text-black">
            Columnas: <b>ITEM</b>, <b>DESCRIPCIÓN</b>, <b>UNIDAD</b>, <b>PRECIO</b> y opcionalmente <b>SECTOR</b>. Las filas "Planta baja" / "Planta
            alta" fijan el sector de las filas siguientes. Cada precio actualiza el insumo <span className="font-mono">MO-&lt;código&gt;</span> con
            vigencia desde hoy.
          </p>
          <p className="text-sm text-black">{AYUDA}</p>
          <Field label="Archivo Excel o CSV">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputClass} />
          </Field>
          <Field label="…o pegá las celdas copiadas de Excel">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} className={`${inputClass} font-mono text-xs`} placeholder={"Item\tDescripción\tUnidad\tPrecio\tSector"} />
          </Field>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-sm text-black">
            <thead className="text-left text-xs">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2">Sector</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNumber} className="border-t border-slate-100">
                  <td className="px-3 py-2 tabular-nums">{r.code || "—"}</td>
                  <td className="px-3 py-2">
                    {r.description}
                    {r.errors.length > 0 && <p className="text-xs text-rose-600">{r.errors.join(" · ")} (no se importa)</p>}
                  </td>
                  <td className="px-3 py-2">{r.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.unitPrice === null ? "—" : formatMoney(r.unitPrice, currency)}</td>
                  <td className="px-3 py-2">{sectorLabel(r.sector)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function AddPriceModal({
  project,
  onClose,
  onSaved,
  showToast,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
  showToast: LaborPricesPanelProps["showToast"];
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [sector, setSector] = useState("");

  const save = async () => {
    try {
      await api.saveLaborPrice(project.id, { code: code.trim(), description: description.trim(), unit: unit.trim(), unitPrice: Number(unitPrice), sector: sector || null });
      showToast("Precio guardado");
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar", "error");
    }
  };

  return (
    <Modal
      title="Agregar precio de mano de obra"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!Number(unitPrice) || !code.trim() || !description.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Código">
        <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Descripción">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Unidad">
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Precio por unidad">
        <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Sector">
        <select value={sector} onChange={(e) => setSector(e.target.value)} className={inputClass}>
          <option value="">—</option>
          {Object.entries(SECTOR_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
