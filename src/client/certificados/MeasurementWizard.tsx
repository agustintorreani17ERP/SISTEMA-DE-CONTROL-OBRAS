import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, HardHat, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { MeasurableItem, Partner, PlanillaSubData, Project, SubcontractorContract } from "../types";
import { Badge, Button, cx, Field, inputClass, Modal } from "../ui";
import { Stepper } from "../ui/actions";
import { formatMoney } from "../utils/format";

import { formatQty } from "../utils/numbers";
import { todayIso } from "../insumos/labels";
import { auxPayload, ComputoTable, newLine, PhotoStrip, qtyOfLines, type AuxRow, type Photo } from "./computo";
import { numerarFilas, PlanillaSub, subRowAmount, subRowQty, subRowsPayload, type SubRow } from "./PlanillaSub";

interface Row {
  item: MeasurableItem;
  unitPrice: number;
  lines: AuxRow[];
  photos: Photo[];
}

interface MeasurementWizardProps {
  project: Project;
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  currency: "PYG" | "USD";
  /** Destino ya elegido desde la tarjeta del contratista: id del subcontratista, null = cliente, undefined = elegir. */
  initialPartnerId?: number | null;
  onClose: () => void;
  onCreated: (certificationId: number, asCertificate: boolean) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/**
 * Nueva medición en 3 pasos:
 * 1. Destino (avance de obra o subcontratista) · 2. Planilla (rubros, cómputo y fotos) ·
 * 3. Revisión obligatoria → borrador de certificado.
 * Subcontratista: la planilla va por frente → rubro de la lista de MO (línea numerada) → rubro
 * presupuestario sugerido; varias líneas y frentes en el mismo certificado.
 */
export function MeasurementWizard({ project, partners, subcontracts, currency, initialPartnerId, onClose, onCreated, showToast }: MeasurementWizardProps) {
  const [step, setStep] = useState(0);
  const [destino, setDestino] = useState<"OBRA" | "SUB">(initialPartnerId ? "SUB" : "OBRA");
  const [subs, setSubs] = useState(partners.filter((p) => p.kind !== "SUPPLIER"));
  const [partnerId, setPartnerId] = useState<number | "">(initialPartnerId ?? "");
  const [contractId, setContractId] = useState<number | "">("");
  const [newSub, setNewSub] = useState<{ name: string; taxId: string } | null>(null);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState(todayIso());
  const [nextLabel, setNextLabel] = useState("");
  const [catalog, setCatalog] = useState<MeasurableItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [planilla, setPlanilla] = useState<PlanillaSubData | null>(null);
  const [subRows, setSubRows] = useState<SubRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const money = (v: number) => formatMoney(v, currency);
  const effectivePartner = destino === "SUB" && partnerId ? Number(partnerId) : null;
  const contracts = subcontracts.filter((c) => c.projectId === project.id && c.partnerId === effectivePartner);

  useEffect(() => {
    api
      .getNextCertificationNumber(project.id, effectivePartner)
      .then((r) => setNextLabel(r.displayLabel))
      .catch(() => setNextLabel(""));
  }, [project.id, effectivePartner]);

  const loadCatalog = async () => {
    try {
      if (effectivePartner) setPlanilla(await api.getPlanillaSub(project.id, effectivePartner));
      else setCatalog(await api.getMeasurableItems(project.id));
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar los rubros", "error");
    }
  };

  const createSub = async () => {
    if (!newSub?.name.trim() || !newSub.taxId.trim()) return showToast("Poné nombre y RUC", "error");
    try {
      const partner = await api.createPartner({ kind: "SUBCONTRACTOR", name: newSub.name.trim(), taxId: newSub.taxId.trim() });
      setSubs((prev) => [...prev, partner]);
      setPartnerId(partner.id);
      setNewSub(null);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear el subcontratista", "error");
    }
  };

  const goToSheet = async () => {
    if (destino === "SUB" && !partnerId) return showToast("Elegí el subcontratista", "error");
    await loadCatalog();
    setRows([]);
    setSubRows([]);
    setStep(1);
  };

  const qtyOf = (r: Row) => qtyOfLines(r.lines);
  const isSub = destino === "SUB";
  const numeros = useMemo(() => (planilla ? numerarFilas(subRows, planilla) : new Map()), [subRows, planilla]);
  const subTotals = useMemo(() => {
    const amount = subRows.reduce((a, r) => a + subRowAmount(r), 0);
    const alerts = subRows.flatMap((r) => {
      const n = numeros.get(r.key)?.numero ?? "";
      const lp = planilla?.listaMO.find((l) => l.id === r.laborPriceId);
      const list: string[] = [];
      if (r.budgetItemId === null) list.push(`${n}: sin rubro presupuestario (no se podrá aprobar)`);
      if (subRowQty(r) <= 0) list.push(`${n}: la cantidad medida es 0`);
      if (lp && Math.abs(Number(r.unitPrice.replace(",", ".")) - lp.unitPrice) > 0.5) list.push(`${n}: precio distinto de la lista de MO`);
      const review = r.lines.filter((l) => l.needsReview).length;
      if (review) list.push(`${n}: ${review} línea(s) marcadas [?] para revisar`);
      return list;
    });
    return { amount, alerts };
  }, [subRows, numeros, planilla]);
  const totals = useMemo(() => {
    const amount = rows.reduce((acc, r) => acc + Math.round(qtyOf(r) * r.unitPrice), 0);
    const alerts = rows.flatMap((r) => {
      const q = qtyOf(r);
      const list: string[] = [];
      if (r.item.totalContractQuantity > 0 && r.item.cantidadAnterior + q > r.item.totalContractQuantity + 1e-9)
        list.push(`${r.item.code}: el acumulado supera lo contratado (${((r.item.cantidadAnterior + q) / r.item.totalContractQuantity * 100).toFixed(0)}%)`);
      if (!r.unitPrice) list.push(`${r.item.code}: sin precio unitario`);
      if (q <= 0) list.push(`${r.item.code}: la cantidad medida es 0`);
      const review = r.lines.filter((l) => l.needsReview).length;
      if (review) list.push(`${r.item.code}: ${review} línea(s) marcadas [?] para revisar`);
      if (r.item.cantidadAnterior > 0 && q > r.item.cantidadAnterior * 1.5)
        list.push(`${r.item.code}: la cantidad del período es mucho mayor que lo certificado hasta ahora`);
      return list;
    });
    return { amount, alerts };
  }, [rows]);

  const updateRow = (id: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));

  const addPhotos = async (id: number, files: FileList | null) => {
    if (!files?.length) return;
    try {
      const uploaded = await Promise.all([...files].map((f) => api.uploadImage(f)));
      setRows((prev) => prev.map((r) => (r.item.id === id ? { ...r, photos: [...r.photos, ...uploaded] } : r)));
    } catch (err: any) {
      showToast(err.message || "No se pudo subir la foto", "error");
    }
  };

  const save = async (asCertificate: boolean) => {
    setSaving(true);
    try {
      const created = await api.createCertification({
        projectId: project.id,
        partnerId: effectivePartner,
        contractId: contractId || null,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        items: isSub
          ? subRowsPayload(subRows, numeros)
          : rows.map((r) => ({
              budgetItemId: r.item.id,
              precioUnitario: r.unitPrice,
              priceSource: r.item.priceSource,
              auxiliaryCalculations: auxPayload(r.lines),
              photos: r.photos.map((p) => ({ url: p.url, comentario: p.name })),
            })),
      });
      if (asCertificate) await api.closeCertificationMeasurement(created.id);
      showToast(asCertificate ? "Borrador de certificado creado" : "Medición guardada");
      onCreated(created.id, asCertificate);
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar la medición", "error");
    } finally {
      setSaving(false);
    }
  };

  const destinoLabel = destino === "OBRA" ? "Avance de obra (al comitente)" : subs.find((s) => s.id === partnerId)?.name ?? "Subcontratista";

  return (
    <Modal
      title={`Nueva medición${nextLabel ? ` · ${nextLabel.replace("Medición ", "")}` : ""}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Atrás</Button>}
          {step === 0 && (
            <Button variant="primary" onClick={goToSheet}>
              Siguiente: planilla
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" onClick={() => setStep(2)} disabled={isSub ? !subRows.length : !rows.length}>
              Siguiente: revisión
            </Button>
          )}
          {step === 2 && (
            <>
              <Button onClick={() => save(false)} disabled={saving}>
                Guardar medición
              </Button>
              <Button variant="primary" onClick={() => save(true)} disabled={saving || !reviewed}>
                Crear borrador de certificado
              </Button>
            </>
          )}
        </>
      }
    >
      <Stepper steps={["Destino", "Planilla", "Revisión"]} current={step} />

      {/* PASO 1 — DESTINO */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: "OBRA" as const, icon: Building2, title: "Avance de obra", help: "Certificado al comitente con el precio de venta del presupuesto." },
              { key: "SUB" as const, icon: HardHat, title: "Subcontratista", help: "Certificado de pago con la lista de precios de mano de obra." },
            ].map(({ key, icon: Icon, title, help }) => (
              <button
                key={key}
                onClick={() => setDestino(key)}
                className={cx("rounded-2xl border p-4 text-left transition", destino === key ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300")}
              >
                <Icon className={cx("mb-2 h-5 w-5", destino === key ? "text-brand-600" : "text-slate-400")} />
                <p className="font-medium text-slate-900">{title}</p>
                <p className="mt-1 text-xs text-slate-500">{help}</p>
              </button>
            ))}
          </div>

          {destino === "SUB" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Subcontratista">
                {newSub === null ? (
                  <div className="flex gap-2">
                    <select value={partnerId} onChange={(e) => { setPartnerId(e.target.value ? Number(e.target.value) : ""); setContractId(""); }} className={inputClass}>
                      <option value="">{subs.length ? "Elegí de la lista…" : "No hay subcontratistas: creá uno"}</option>
                      {subs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewSub({ name: "", taxId: "" })} title="Nuevo subcontratista" />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input autoFocus value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} placeholder="Razón social" className={inputClass} />
                    <input value={newSub.taxId} onChange={(e) => setNewSub({ ...newSub, taxId: e.target.value })} placeholder="RUC" className={`${inputClass} w-28`} />
                    <Button variant="primary" onClick={createSub}>
                      Crear
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="Contrato (opcional)" hint="Define el fondo de reparo por defecto">
                <select value={contractId} onChange={(e) => setContractId(e.target.value ? Number(e.target.value) : "")} className={inputClass} disabled={!contracts.length}>
                  <option value="">{contracts.length ? "Sin contrato" : "Sin contratos para este subcontratista"}</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number} · {c.description}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Período desde">
              <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Período hasta">
              <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>
      )}

      {/* PASO 2 — PLANILLA (subcontratista) */}
      {step === 1 && isSub && planilla && (
        <PlanillaSub projectId={project.id} data={planilla} setData={setPlanilla} rows={subRows} setRows={setSubRows} money={money} showToast={showToast} />
      )}

      {/* PASO 2 — PLANILLA */}
      {step === 1 && !isSub && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-600">
              {destinoLabel} · {rows.length} rubro(s)
            </span>
            <span className="font-semibold tabular-nums">{money(totals.amount)}</span>
          </div>

          {rows.map((r) => {
            const q = qtyOf(r);
            return (
              <div key={r.item.id} className="rounded-2xl border border-slate-200">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-900">
                      {r.item.code} · {r.item.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      Contratado {formatQty(r.item.totalContractQuantity)} {r.item.unit} · Anterior {formatQty(r.item.cantidadAnterior)} ·{" "}
                      {r.item.priceSource === "MANO_DE_OBRA" ? "Precio MO" : "Precio venta"} {money(r.unitPrice)}
                    </p>
                  </div>
                  <button onClick={() => setRows((prev) => prev.filter((x) => x.item.id !== r.item.id))} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar rubro">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="overflow-x-auto px-4 py-3">
                  <ComputoTable lines={r.lines} onChange={(lines) => updateRow(r.item.id, { lines })} />
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <p className="text-sm">
                      Cantidad del período:{" "}
                      <strong className="tabular-nums">
                        {formatQty(q)} {r.item.unit}
                      </strong>{" "}
                      · <span className="tabular-nums">{money(Math.round(q * r.unitPrice))}</span>
                    </p>
                  </div>
                </div>

                <PhotoStrip photos={r.photos} onAdd={(files) => addPhotos(r.item.id, files)} onRemove={(url) => updateRow(r.item.id, { photos: r.photos.filter((p) => p.url !== url) })} />
              </div>
            );
          })}

          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} className="w-full justify-center border-dashed">
            Agregar rubro
          </Button>
        </div>
      )}

      {/* PASO 3 — REVISIÓN (subcontratista) */}
      {step === 2 && isSub && planilla && (
        <div className="space-y-4 text-black">
          <p className="text-sm">Revisá la planilla antes de crear el certificado. Las líneas sin rubro presupuestario se pueden guardar, pero no aprobar.</p>
          <div className="overflow-x-auto border border-slate-300">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs">
                <tr className="border-b border-slate-300">
                  <th className="px-3 py-2">N°</th>
                  <th className="px-3 py-2">Rubro MO</th>
                  <th className="px-3 py-2">Rubro presupuestario</th>
                  <th className="px-3 py-2 text-right">Anterior</th>
                  <th className="px-3 py-2 text-right">Período</th>
                  <th className="px-3 py-2 text-right">Acumulado</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {subRows.map((r) => {
                  const nro = numeros.get(r.key);
                  const lp = planilla.listaMO.find((l) => l.id === r.laborPriceId);
                  const it = planilla.items.find((i) => i.id === r.budgetItemId) ?? (r.budgetItemId === planilla.gastosGenerales?.id ? planilla.gastosGenerales : null);
                  const q = subRowQty(r);
                  return (
                    <tr key={r.key} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-medium">{nro?.numero}</td>
                      <td className="px-3 py-2">{lp?.description}</td>
                      <td className={cx("px-3 py-2", !it && "text-red-600")}>
                        {it ? `${it.code} · ${it.name}` : "Sin asignar"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty(nro?.anterior ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatQty(q)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty((nro?.anterior ?? 0) + q)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(subRowAmount(r))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300">
                  <td colSpan={6} className="px-3 py-2 text-right font-medium">
                    Total del período
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(subTotals.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {subTotals.alerts.length > 0 ? (
            <div className="space-y-1 text-sm text-red-600">
              {subTotals.alerts.map((a) => (
                <p key={a} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm">Sin observaciones</p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            Revisé el cómputo y las cantidades
          </label>
        </div>
      )}

      {/* PASO 3 — REVISIÓN */}
      {step === 2 && !isSub && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Revisá el cómputo antes de crear el certificado. Una vez aprobado, no se puede modificar.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Rubro</th>
                  <th className="px-3 py-2 text-right">Contratado</th>
                  <th className="px-3 py-2 text-right">Anterior</th>
                  <th className="px-3 py-2 text-right">Período</th>
                  <th className="px-3 py-2 text-right">Acumulado</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = qtyOf(r);
                  const acc = r.item.cantidadAnterior + q;
                  const over = r.item.totalContractQuantity > 0 && acc > r.item.totalContractQuantity + 1e-9;
                  const f = (v: number) => formatQty(v);
                  return (
                    <tr key={r.item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {r.item.code} · {r.item.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{f(r.item.totalContractQuantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f(r.item.cantidadAnterior)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{f(q)}</td>
                      <td className={cx("px-3 py-2 text-right tabular-nums", over && "font-semibold text-rose-600")}>
                        {f(acc)}
                        {r.item.totalContractQuantity > 0 && <span className="ml-1 text-xs">({((acc / r.item.totalContractQuantity) * 100).toFixed(0)}%)</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(Math.round(q * r.unitPrice))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={5} className="px-3 py-2 text-right font-medium">
                    Total del período
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(totals.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {totals.alerts.length > 0 ? (
            <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {totals.alerts.map((a) => (
                <p key={a} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}
                </p>
              ))}
            </div>
          ) : (
            <Badge tone="good">Sin observaciones</Badge>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            Revisé el cómputo y las cantidades
          </label>
        </div>
      )}

      {adding && (
        <AddRubroModal
          project={project}
          catalog={catalog.filter((c) => !rows.some((r) => r.item.id === c.id))}
          currency={currency}
          onClose={() => setAdding(false)}
          onAdd={(item, unitPrice) => {
            setRows((prev) => [...prev, { item, unitPrice, lines: [newLine()], photos: [] }]);
            setAdding(false);
          }}
          showToast={showToast}
        />
      )}
    </Modal>
  );
}

function AddRubroModal({
  project,
  catalog,
  currency,
  onClose,
  onAdd,
  showToast,
}: {
  project: Project;
  catalog: MeasurableItem[];
  currency: "PYG" | "USD";
  onClose: () => void;
  onAdd: (item: MeasurableItem, unitPrice: number) => void;
  showToast: MeasurementWizardProps["showToast"];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MeasurableItem | null>(null);
  const [price, setPrice] = useState("");
  const list = catalog.filter((c) => `${c.code} ${c.name} ${c.category}`.toLowerCase().includes(search.toLowerCase())).slice(0, 60);

  const confirm = async () => {
    if (!selected) return;
    let unitPrice = selected.unitPrice;
    if (selected.missingPrice) {
      unitPrice = Number(price);
      if (!unitPrice) return showToast("Cargá el precio de mano de obra de este rubro", "error");
    }
    onAdd(selected, unitPrice);
  };

  return (
    <Modal
      title="Agregar rubro a la medición"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={confirm} disabled={!selected}>
            Agregar
          </Button>
        </>
      }
    >
      <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar rubro por código o nombre…" className={inputClass} />
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
        {list.map((c) => (
          <button key={c.id} onClick={() => setSelected(c)} className={cx("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm", selected?.id === c.id ? "bg-brand-50" : "hover:bg-slate-50")}>
            <span className="min-w-0">
              <span className="block truncate text-slate-800">
                {c.code} · {c.name}
              </span>
              <span className="text-xs text-slate-400">{c.category}</span>
            </span>
            <span className="shrink-0 text-xs text-slate-500">{c.missingPrice ? <Badge tone="warn">sin precio MO</Badge> : formatMoney(c.unitPrice, currency)}</span>
          </button>
        ))}
        {list.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No hay rubros que coincidan.</p>}
      </div>
      {selected && (
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <div>
            <p className="text-xs text-slate-500">Contratado</p>
            <p className="font-medium">
              {formatQty(selected.totalContractQuantity)} {selected.unit}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Acumulado anterior</p>
            <p className="font-medium">{formatQty(selected.cantidadAnterior)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{selected.priceSource === "MANO_DE_OBRA" ? "Precio MO sugerido" : "Precio venta"}</p>
            {selected.missingPrice ? (
              <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Cargar precio" className={inputClass} />
            ) : (
              <>
                <p className="font-medium">{formatMoney(selected.unitPrice, currency)}</p>
                {selected.laborPriceSource && (
                  <p className="text-xs text-slate-500">{selected.laborPriceSource === "LISTA_OBRA" ? "Lista de MO de la obra" : "MO del ACU (lista de MO)"}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
