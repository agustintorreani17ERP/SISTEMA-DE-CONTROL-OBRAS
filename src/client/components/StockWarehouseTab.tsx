import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowUpRight, ClipboardCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { ConteoInventario, Material, Project, StockMovement, StockMovementKind, WarehouseStock, WorkFront } from "../types";
import { api } from "../api";
import { Button, Field, Modal, cx, inputClass } from "../ui";
import { formatQty } from "../utils/numbers";
import { BudgetItemSelect, useImputableItems } from "./BudgetItemSelect";
import { ImputacionCell, itemRequired, TIPO_HELP } from "../compras/ImputacionCell";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";
import { ConteoInventarioForm } from "../stock/ConteoInventarioForm";

interface StockWarehouseTabProps {
  project?: Project | null;
  stock: WarehouseStock[];
  movements: StockMovement[];
  materials: Material[];
  workFronts: WorkFront[];
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  /** Abre "Salida" o "Ajuste" desde el botón global Crear. */
  intent?: { action: "out" | "adjust"; nonce: number } | null;
}

export const KIND_LABEL: Record<StockMovementKind, string> = {
  RECEIPT: "Compra",
  CONSUMPTION: "Salida a obra",
  DIRECT_ISSUE: "Salida directa a ítem",
  TRANSFER_OUT: "Transferencia enviada",
  TRANSFER_IN: "Transferencia recibida",
  ADJUSTMENT: "Ajuste manual",
  INVENTORY_ADJUSTMENT: "Ajuste por conteo",
  REVERSAL: "Reversión",
};

type Dialog = "out" | "adjust" | "transfer" | "count" | null;
type View = "stock" | "movimientos" | "conteos";

export const StockWarehouseTab: React.FC<StockWarehouseTabProps> = ({ project, stock, movements, materials, workFronts, onRefresh, showToast, intent }) => {
  const [view, setView] = useState<View>("stock");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<StockMovementKind | "ALL">("ALL");
  const [fechaSaldo, setFechaSaldo] = useState("");
  const [stockAtDate, setStockAtDate] = useState<WarehouseStock[] | null>(null);
  const [conteos, setConteos] = useState<ConteoInventario[]>([]);

  useEffect(() => {
    if (intent) setDialog(intent.action === "out" ? "out" : "adjust");
  }, [intent?.nonce]);

  useEffect(() => {
    if (!project?.id || !fechaSaldo) return setStockAtDate(null);
    api.getStock(project.id, fechaSaldo).then(setStockAtDate).catch((e) => showToast(e.message, "error"));
  }, [project?.id, fechaSaldo, stock, showToast]);

  const loadConteos = () => project?.id && api.getConteos(project.id).then(setConteos).catch((e) => showToast(e.message, "error"));
  useEffect(() => {
    loadConteos();
  }, [project?.id, movements]);

  const q = search.trim().toLowerCase();
  const matches = (m?: { code?: string; description?: string } | null) => !q || `${m?.code ?? ""} ${m?.description ?? ""}`.toLowerCase().includes(q);
  const rows = (stockAtDate ?? stock).filter((s) => matches(s.material));
  const movs = movements.filter((m) => (kind === "ALL" || m.kind === kind) && (matches(m.material) || (m.note ?? "").toLowerCase().includes(q)));
  const done = () => {
    setDialog(null);
    onRefresh();
  };

  if (!project) return null;

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex border-b border-slate-300">
          {(
            [
              ["stock", "Existencias"],
              ["movimientos", "Movimientos"],
              ["conteos", "Conteos de inventario"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", view === v ? "border-slate-900 font-semibold" : "border-transparent text-slate-500")}>
              {l}
            </button>
          ))}
        </div>
        <Field label="Buscar" className="w-56">
          <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código o descripción" />
        </Field>
        {view === "stock" && (
          <Field label="Saldo al (vacío = hoy)" className="w-44">
            <input type="date" className={inputClass} value={fechaSaldo} max={todayIso()} onChange={(e) => setFechaSaldo(e.target.value)} />
          </Field>
        )}
        {view === "movimientos" && (
          <Field label="Tipo" className="w-52">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as StockMovementKind | "ALL")}>
              <option value="ALL">Todos</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setDialog("count")}>
            Conteo
          </Button>
          <Button icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setDialog("transfer")}>
            Transferir
          </Button>
          <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setDialog("adjust")}>
            Ajuste
          </Button>
          <Button variant="primary" icon={<ArrowUpRight className="h-4 w-4" />} onClick={() => setDialog("out")}>
            Salida
          </Button>
        </div>
      </div>

      {view === "stock" && (
        <div className="overflow-x-auto border border-slate-300">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">{fechaSaldo ? `Saldo al ${fmtDate(fechaSaldo)}` : "Saldo actual"}</th>
                <th className="px-3 py-2">Un.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const qty = Number(s.currentStock || 0);
                return (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-xs">{s.material?.code}</td>
                    <td className="px-3 py-1.5">{s.material?.description}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{s.material?.tipo ? TIPO_HELP[s.material.tipo].split(":")[0] : ""}</td>
                    <td className={cx("px-3 py-1.5 text-right tabular-nums", qty < 0 && "font-semibold text-red-600")}>{formatQty(qty)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{s.material?.unit}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    Sin existencias registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "movimientos" && (
        <div className="overflow-x-auto border border-slate-300">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Movimiento</th>
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Ítem / obra / detalle</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => {
                const qty = Number(m.quantity);
                return (
                  <tr key={m.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{fmtDate(m.fecha)}</td>
                    <td className="px-3 py-1.5">{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs">{m.material?.code}</span> {m.material?.description}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {qty > 0 ? "+" : ""}
                      {formatQty(qty)} {m.material?.unit}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">
                      {m.budgetItem && (
                        <span className="text-slate-900">
                          {m.budgetItem.code} {m.budgetItem.name}
                          {m.note ? " · " : ""}
                        </span>
                      )}
                      {m.counterpartProject && (
                        <span className="text-slate-900">
                          {m.kind === "TRANSFER_OUT" ? "a " : "desde "}
                          {m.counterpartProject.code} {m.counterpartProject.name}
                          {m.note ? " · " : ""}
                        </span>
                      )}
                      {m.note}
                    </td>
                  </tr>
                );
              })}
              {movs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    Sin movimientos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "conteos" && (
        <div className="overflow-x-auto border border-slate-300">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2 text-right">Teórico</th>
                <th className="px-3 py-2 text-right">Contado</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2">Foto / nota</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {conteos
                .filter((c) => matches(c.material))
                .map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 tabular-nums">{fmtDate(c.fecha)}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs">{c.material?.code}</span> {c.material?.description}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(c.stockTeorico)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(c.cantidadContada)}</td>
                    <td className={cx("px-3 py-1.5 text-right tabular-nums", c.diferencia < 0 && "font-semibold text-red-600")}>
                      {c.diferencia > 0 ? "+" : ""}
                      {formatQty(c.diferencia)}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {c.fotoUrl && (
                        <a href={c.fotoUrl} target="_blank" rel="noreferrer" className="underline">
                          foto
                        </a>
                      )}
                      {c.fotoUrl && c.nota ? " · " : ""}
                      {c.nota}
                    </td>
                    <td className="px-1 text-center">
                      <button
                        className="p-1 text-slate-400 hover:text-slate-900"
                        title="Borrar conteo (se recalculan los ajustes)"
                        onClick={async () => {
                          if (!window.confirm("¿Borrar este conteo? Se recalculan los ajustes de stock.")) return;
                          try {
                            await api.deleteConteo(c.id);
                            showToast("Conteo borrado");
                            onRefresh();
                          } catch (e: any) {
                            showToast(e.message, "error");
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              {conteos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Sin conteos. Un conteo fija el saldo a su fecha; la diferencia con el teórico queda como ajuste.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog === "out" && <SalidaDialog project={project} materials={materials} onClose={() => setDialog(null)} onDone={done} showToast={showToast} />}
      {dialog === "adjust" && <AjusteDialog project={project} materials={materials} onClose={() => setDialog(null)} onDone={done} showToast={showToast} />}
      {dialog === "transfer" && <TransferDialog project={project} materials={materials} onClose={() => setDialog(null)} onDone={done} showToast={showToast} />}
      {dialog === "count" && (
        <ConteoInventarioForm
          project={project}
          materials={materials}
          onClose={() => setDialog(null)}
          onSaved={() => {
            onRefresh();
            loadConteos();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

type DialogProps = {
  project: Project;
  materials: Material[];
  onClose: () => void;
  onDone: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
};

function MaterialSelect({ materials, value, onChange }: { materials: Material[]; value: number | ""; onChange: (id: number | "") => void }) {
  const sorted = useMemo(() => [...materials].filter((m) => m.tipo !== "TIEMPO").sort((a, b) => a.description.localeCompare(b.description)), [materials]);
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}>
      <option value="">Elegí el insumo…</option>
      {sorted.map((m) => (
        <option key={m.id} value={m.id}>
          {m.code} — {m.description} ({m.unit})
        </option>
      ))}
    </select>
  );
}

function useSubmit(fn: () => Promise<unknown>, msg: string, onDone: () => void, showToast: DialogProps["showToast"]) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r: any = await fn();
      showToast(msg, "success");
      r?.warnings?.forEach((w: string) => showToast(w, "info"));
      onDone();
    } catch (e: any) {
      showToast(e.message || "No se pudo registrar", "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, submit };
}

function SalidaDialog({ project, materials, onClose, onDone, showToast }: DialogProps) {
  const [f, setF] = useState({ fecha: todayIso(), materialId: "" as number | "", quantity: "", budgetItemId: "" as number | "", note: "" });
  const { items } = useImputableItems(project.id);
  const tipo = materials.find((m) => m.id === f.materialId)?.tipo;
  const ok = f.fecha && f.materialId && Number(f.quantity) > 0 && (!itemRequired(tipo) || f.budgetItemId);
  const { busy, submit } = useSubmit(
    () =>
      api.registerStockIssue(project.id, {
        fecha: f.fecha,
        materialId: Number(f.materialId),
        quantity: Number(f.quantity),
        budgetItemId: f.budgetItemId || null,
        note: f.note || undefined,
      }),
    f.budgetItemId ? "Salida directa a ítem registrada" : "Salida a obra registrada",
    onDone,
    showToast
  );
  return (
    <Modal
      title="Salida de stock"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ok || busy} onClick={submit}>
            Registrar salida
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={f.fecha} max={todayIso()} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Field>
        <Field label="Cantidad">
          <input type="number" min={0} step="any" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="Insumo" className="col-span-2">
          <MaterialSelect materials={materials} value={f.materialId} onChange={(id) => setF({ ...f, materialId: id, budgetItemId: "" })} />
        </Field>
        <Field label={tipo === "COMUN" ? "Ítem (opcional: dato de control, el costo sale del ACU)" : "Ítem"} className="col-span-2">
          {tipo === "COMUN" ? (
            <BudgetItemSelect projectId={project.id} items={items} value={f.budgetItemId} onChange={(v) => setF({ ...f, budgetItemId: v })} placeholder="Sin ítem" />
          ) : (
            <ImputacionCell tipo={tipo} projectId={project.id} items={items} value={f.budgetItemId} onChange={(v) => setF({ ...f, budgetItemId: v })} currency="PYG" showError />
          )}
        </Field>
        <Field label="Nota" className="col-span-2">
          <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Frente, destino…" />
        </Field>
      </div>
    </Modal>
  );
}

function AjusteDialog({ project, materials, onClose, onDone, showToast }: DialogProps) {
  const [f, setF] = useState({ fecha: todayIso(), materialId: "" as number | "", quantity: "", note: "" });
  const ok = f.fecha && f.materialId && Number(f.quantity) !== 0 && f.note.trim().length >= 3;
  const { busy, submit } = useSubmit(
    () => api.registerAdjustment({ projectId: project.id, materialId: Number(f.materialId), fecha: f.fecha, quantity: Number(f.quantity), note: f.note.trim() }),
    "Ajuste registrado",
    onDone,
    showToast
  );
  return (
    <Modal
      title="Ajuste manual de stock"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ok || busy} onClick={submit}>
            Registrar ajuste
          </Button>
        </>
      }
    >
      <p className="text-xs text-slate-500">Para correcciones puntuales (carga errónea, rotura). Si contaste el depósito, usá Conteo: fija el saldo y calcula la diferencia solo.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={f.fecha} max={todayIso()} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Field>
        <Field label="Cantidad (+ suma, − resta)">
          <input type="number" step="any" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="Insumo" className="col-span-2">
          <MaterialSelect materials={materials} value={f.materialId} onChange={(id) => setF({ ...f, materialId: id })} />
        </Field>
        <Field label="Motivo" className="col-span-2">
          <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function TransferDialog({ project, materials, onClose, onDone, showToast }: DialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [f, setF] = useState({ fecha: todayIso(), materialId: "" as number | "", quantity: "", toProjectId: "" as number | "", note: "" });
  useEffect(() => {
    api.getProjects().then((ps) => setProjects(ps.filter((p) => p.id !== project.id)));
  }, [project.id]);
  const ok = f.fecha && f.materialId && f.toProjectId && Number(f.quantity) > 0;
  const { busy, submit } = useSubmit(
    () =>
      api.transferStock({
        fromProjectId: project.id,
        toProjectId: Number(f.toProjectId),
        materialId: Number(f.materialId),
        fecha: f.fecha,
        quantity: Number(f.quantity),
        note: f.note || undefined,
      }),
    "Transferencia registrada",
    onDone,
    showToast
  );
  return (
    <Modal
      title={`Transferir desde ${project.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ok || busy} onClick={submit}>
            Transferir
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={f.fecha} max={todayIso()} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Field>
        <Field label="Cantidad">
          <input type="number" min={0} step="any" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="Insumo" className="col-span-2">
          <MaterialSelect materials={materials} value={f.materialId} onChange={(id) => setF({ ...f, materialId: id })} />
        </Field>
        <Field label="Obra de destino" className="col-span-2">
          <select className={inputClass} value={f.toProjectId} onChange={(e) => setF({ ...f, toProjectId: e.target.value ? Number(e.target.value) : "" })}>
            <option value="">Elegí la obra…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nota" className="col-span-2">
          <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        El valor del material (precio vigente a la fecha) pasa del stock de esta obra al de la de destino en "Costos a distribuir".
      </p>
    </Modal>
  );
}
