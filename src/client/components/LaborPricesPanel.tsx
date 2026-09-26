import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, HardHat, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { LaborPrice, LaborPreviewRow, Project } from "../types";
import { Badge, Button, Card, EmptyState, Field, inputClass, Modal, pct } from "../ui";
import { ActionBar } from "../ui/actions";
import { BudgetItemSelect, useImputableItems } from "./BudgetItemSelect";
import { formatMoney } from "../utils/format";

interface LaborPricesPanelProps {
  project: Project;
  currency: "PYG" | "USD";
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  openImport?: number;
}

/**
 * Lista de precios de mano de obra: lo que la empresa paga al subcontratista por unidad.
 * Las mediciones de subcontratistas toman el precio de acá.
 */
export function LaborPricesPanel({ project, currency, showToast, openImport }: LaborPricesPanelProps) {
  const [prices, setPrices] = useState<LaborPrice[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { items: imputable } = useImputableItems(project.id);
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v, currency));

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
    return prices.filter((p) => !q || `${p.code} ${p.description}`.toLowerCase().includes(q));
  }, [prices, search]);

  const updatePrice = async (p: LaborPrice, patch: { unitPrice?: number; budgetItemId?: number | null }) => {
    try {
      await api.updateLaborPrice(p.id, patch);
      load();
    } catch (err: any) {
      showToast(err.message || "No se pudo actualizar", "error");
    }
  };

  const unlinked = prices.filter((p) => !p.budgetItemId).length;

  return (
    <div className="space-y-4">
      <ActionBar
        search={search}
        onSearch={setSearch}
        chips={[
          { value: "all", label: "Precios cargados", count: prices.length },
          ...(unlinked ? [{ value: "unlinked", label: "Sin rubro asociado", count: unlinked }] : []),
        ]}
        chip="all"
        secondary={[{ label: "Agregar un precio", icon: <Plus className="h-4 w-4" />, onClick: () => setAdding(true) }]}
        primary={
          <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImporting(true)}>
            Importar planilla
          </Button>
        }
      />

      {prices.length === 0 ? (
        <EmptyState
          icon={<HardHat className="h-10 w-10" />}
          title="Todavía no hay precios de mano de obra"
          help="Cargá la planilla con lo que pagás a los subcontratistas por cada rubro (código, descripción, unidad y precio). Las mediciones de subcontratistas toman el precio de acá."
          action={
            <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImporting(true)}>
              Importar planilla
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">Mano de obra</th>
                  <th className="w-72 px-3 py-3">Rubro del presupuesto</th>
                  <th className="w-36 px-3 py-3 text-right">Precio MO</th>
                  <th className="px-3 py-3 text-right">Precio venta</th>
                  <th className="px-3 py-3 text-right">Margen</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2.5">
                      <p className="text-slate-800">{p.description}</p>
                      <p className="text-xs text-slate-400">
                        {p.code} · {p.unit || "un"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <BudgetItemSelect
                        projectId={project.id}
                        items={imputable.filter((i) => !i.isSystem)}
                        value={p.budgetItemId ?? ""}
                        onChange={(v) => updatePrice(p, { budgetItemId: v || null })}
                        currency={currency}
                        placeholder="Sin asociar"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min={0}
                        defaultValue={p.unitPrice}
                        key={`${p.id}-${p.unitPrice}`}
                        onBlur={(e) => Number(e.target.value) !== p.unitPrice && updatePrice(p, { unitPrice: Number(e.target.value) })}
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{money(p.salePrice)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {p.margin === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <Badge tone={p.margin < 0 ? "bad" : p.margin < 0.15 ? "warn" : "good"}>{pct(p.margin)}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={async () => {
                          if (!window.confirm(`¿Borrar "${p.description}"?`)) return;
                          await api.deleteLaborPrice(p.id);
                          load();
                        }}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
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
          currency={currency}
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
  const { items: imputable } = useImputableItems(project.id);

  const preview = async () => {
    setLoading(true);
    try {
      const data = await api.previewLaborPrices(project.id, { file, pastedText: pasted || undefined });
      setRows(data.rows);
      showToast(`${data.summary.total} precios leídos, ${data.summary.matched} asociados a un rubro`);
    } catch (err: any) {
      showToast(err.message || "No se pudo leer la planilla", "error");
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!rows) return;
    setLoading(true);
    try {
      const res = await api.commitLaborPrices(project.id, rows);
      showToast(`${res.saved} precios de mano de obra guardados`);
      onSaved();
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar", "error");
    } finally {
      setLoading(false);
    }
  };

  const MATCH: Record<string, string> = { code: "por código", description: "por descripción", similar: "parecido" };

  return (
    <Modal
      title="Importar precios de mano de obra"
      size="lg"
      onClose={onClose}
      footer={
        rows ? (
          <>
            <Button onClick={() => setRows(null)}>Atrás</Button>
            <Button variant="primary" onClick={commit} disabled={loading || !rows.length}>
              Guardar {rows.length} precios
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
          <p className="text-sm text-slate-600">La planilla necesita: descripción y precio. Si tiene código y unidad, mejor (se asocian solos al rubro).</p>
          <Field label="Archivo Excel o CSV">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputClass} />
          </Field>
          <Field label="…o pegá las celdas copiadas de Excel">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} className={`${inputClass} font-mono text-xs`} placeholder={"Código\tDescripción\tUnidad\tPrecio"} />
          </Field>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Mano de obra</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="w-72 px-3 py-2">Rubro asociado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="text-slate-800">{r.description}</p>
                    <p className="text-xs text-slate-400">
                      {r.code || "sin código"} · {r.unit || "un"}
                      {r.matchedBy && ` · asociado ${MATCH[r.matchedBy]}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.unitPrice, currency)}</td>
                  <td className="px-3 py-2">
                    <BudgetItemSelect
                      projectId={project.id}
                      items={imputable.filter((it) => !it.isSystem)}
                      value={r.budgetItemId ?? ""}
                      onChange={(v) => setRows((prev) => prev!.map((x, j) => (j === i ? { ...x, budgetItemId: v || null } : x)))}
                      currency={currency}
                      placeholder="Sin asociar"
                    />
                  </td>
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
  const [budgetItemId, setBudgetItemId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const { items } = useImputableItems(project.id);
  const selected = items.find((i) => i.id === budgetItemId);

  const save = async () => {
    try {
      await api.saveLaborPrice(project.id, {
        code: selected?.code,
        description: description || selected?.name || "",
        unit: selected?.unit ?? "",
        unitPrice: Number(unitPrice),
        budgetItemId: budgetItemId || null,
      });
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
          <Button variant="primary" onClick={save} disabled={!Number(unitPrice) || (!budgetItemId && !description.trim())}>
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Rubro del presupuesto">
        <BudgetItemSelect projectId={project.id} items={items.filter((i) => !i.isSystem)} value={budgetItemId} onChange={setBudgetItemId} currency={currency} />
      </Field>
      <Field label="Descripción (opcional)" hint="Si la dejás vacía se usa la del rubro">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      <Field label={`Precio por ${selected?.unit ?? "unidad"}`}>
        <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputClass} />
      </Field>
    </Modal>
  );
}
