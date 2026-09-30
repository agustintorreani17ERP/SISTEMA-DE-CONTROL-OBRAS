import React, { useCallback, useEffect, useState } from "react";
import { History, Plus, Upload } from "lucide-react";
import { api } from "../api";
import { Insumo, InsumoCategoria, InsumoPrecio, InsumoTipo } from "../types";
import { Button, Drawer, Field, Modal, cx, inputClass } from "../ui";
import { formatGs } from "../utils/numbers";
import { NumCell, cellInputCls, gridKeyDown } from "../components/certifications/sheetGrid";
import { ImportMOModal } from "./ImportMOModal";
import { CATEGORIA_LABEL, SECTOR_LABEL, TIPO_LABEL, fmtDate, todayIso } from "./labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const GRID = "insumos";
const selectCls = cx(cellInputCls, "appearance-none cursor-pointer");

export const InsumosPage: React.FC<{ showToast: Toast }> = ({ showToast }) => {
  const [items, setItems] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<InsumoTipo | "">("");
  const [categoria, setCategoria] = useState<InsumoCategoria | "">("");
  const [q, setQ] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [inactivos, setInactivos] = useState(false);
  const [pendingPrice, setPendingPrice] = useState<{ insumo: Insumo; precio: number } | null>(null);
  const [historyOf, setHistoryOf] = useState<Insumo | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(
        await api.getInsumos({ tipo: tipo || undefined, categoria: categoria || undefined, q: q || undefined, fecha, inactivos })
      );
    } catch (e: any) {
      showToast(e.message || "No se pudo cargar el catálogo", "error");
    } finally {
      setLoading(false);
    }
  }, [tipo, categoria, q, fecha, inactivos, showToast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const patch = async (insumo: Insumo, body: Parameters<typeof api.updateInsumo>[1]) => {
    try {
      const updated = await api.updateInsumo(insumo.id, body);
      setItems((prev) => prev.map((i) => (i.id === insumo.id ? { ...i, ...updated, precio: i.precio, vigenteDesde: i.vigenteDesde, proximoPrecio: i.proximoPrecio } : i)));
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar", "error");
      load();
    }
  };

  const tipoFilters: { value: InsumoTipo | ""; label: string }[] = [
    { value: "", label: "Todos" },
    { value: "DIRECTO", label: "Directo" },
    { value: "COMUN", label: "Común" },
    { value: "TIEMPO", label: "Tiempo" },
  ];

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex border-b border-slate-200">
          {tipoFilters.map((f) => (
            <button
              key={f.value || "all"}
              onClick={() => setTipo(f.value)}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                tipo === f.value ? "border-slate-900 font-semibold" : "border-transparent text-slate-500 hover:text-slate-900"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Field label="Categoría" className="w-40">
          <select className={inputClass} value={categoria} onChange={(e) => setCategoria(e.target.value as InsumoCategoria | "")}>
            <option value="">Todas</option>
            {Object.entries(CATEGORIA_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Buscar" className="w-64">
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o descripción" />
        </Field>
        <Field label="Precios al" className="w-40">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value || todayIso())} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />
          Ver inactivos
        </label>
        <div className="ml-auto flex gap-2 pb-0.5">
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
            Importar lista MO
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nuevo insumo
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-300">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs font-semibold">
              <th className="w-28 border-r border-slate-200 px-2 py-2">Código</th>
              <th className="min-w-[280px] border-r border-slate-200 px-2 py-2">Descripción</th>
              <th className="w-16 border-r border-slate-200 px-2 py-2">Un.</th>
              <th className="w-24 border-r border-slate-200 px-2 py-2">Tipo</th>
              <th className="w-32 border-r border-slate-200 px-2 py-2">Categoría</th>
              <th className="w-32 border-r border-slate-200 px-2 py-2">Sector</th>
              <th className="w-32 border-r border-slate-200 px-2 py-2 text-right">Precio s/IVA</th>
              <th className="w-24 border-r border-slate-200 px-2 py-2 text-right">Tol. %</th>
              <th className="w-20 border-r border-slate-200 px-2 py-2 text-right" title="Equipos: consumo teórico de combustible en litros por hora">
                L/h
              </th>
              <th className="w-28 border-r border-slate-200 px-2 py-2">Vigente desde</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((insumo, r) => (
              <InsumoRow
                key={insumo.id}
                insumo={insumo}
                r={r}
                rows={items.length}
                onPatch={(body) => patch(insumo, body)}
                onPrice={(precio) => setPendingPrice({ insumo, precio })}
                onHistory={() => setHistoryOf(insumo)}
              />
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                  No hay insumos con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {loading ? "Cargando…" : `${items.length} insumos`} · Cambiar el precio no pisa el anterior: se carga una nueva vigencia.
      </p>

      {pendingPrice && (
        <NewPriceModal
          insumo={pendingPrice.insumo}
          initialPrice={pendingPrice.precio}
          onClose={() => {
            setPendingPrice(null);
            load();
          }}
          onSaved={() => {
            showToast("Precio cargado", "success");
            setPendingPrice(null);
            load();
          }}
          showToast={showToast}
        />
      )}
      {historyOf && <HistoryDrawer insumo={historyOf} onClose={() => setHistoryOf(null)} onChanged={load} showToast={showToast} />}
      {creating && (
        <CreateInsumoModal
          defaultTipo={tipo || "COMUN"}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            showToast("Insumo creado", "success");
            load();
          }}
          showToast={showToast}
        />
      )}
      {importing && (
        <ImportMOModal
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            load();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// ─── Fila editable ────────────────────────────────────────────────────────

const TextCell: React.FC<{ value: string; c: number; r: number; rows: number; onCommit: (v: string) => void; className?: string }> = ({
  value,
  c,
  r,
  rows,
  onCommit,
  className,
}) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      data-grid={GRID}
      data-r={r}
      data-c={c}
      className={cx(cellInputCls, className)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setText(value);
        gridKeyDown(e, rows);
      }}
      onBlur={() => {
        const v = text.trim();
        if (v !== value) onCommit(v);
      }}
    />
  );
};

const InsumoRow: React.FC<{
  insumo: Insumo;
  r: number;
  rows: number;
  onPatch: (body: Parameters<typeof api.updateInsumo>[1]) => void;
  onPrice: (precio: number) => void;
  onHistory: () => void;
}> = ({ insumo, r, rows, onPatch, onPrice, onHistory }) => {
  const [precio, setPrecio] = useState(insumo.precio ?? 0);
  const [tol, setTol] = useState(insumo.toleranciaPct);
  useEffect(() => setPrecio(insumo.precio ?? 0), [insumo.precio]);
  useEffect(() => setTol(insumo.toleranciaPct), [insumo.toleranciaPct]);
  const [lh, setLh] = useState(insumo.consumoLh ?? 0);
  useEffect(() => setLh(insumo.consumoLh ?? 0), [insumo.consumoLh]);

  const td = "border-r border-slate-200 p-0";
  const cell = { r, rows };
  return (
    <tr className={cx("border-b border-slate-200", !insumo.active && "text-slate-400")}>
      <td className={td}>
        <TextCell {...cell} c={0} value={insumo.code} onCommit={(v) => v && onPatch({ code: v })} className="font-mono text-xs" />
      </td>
      <td className={td}>
        <TextCell {...cell} c={1} value={insumo.description} onCommit={(v) => v && onPatch({ description: v })} />
      </td>
      <td className={td}>
        <TextCell {...cell} c={2} value={insumo.unit} onCommit={(v) => v && onPatch({ unit: v })} />
      </td>
      <td className={td}>
        <select
          data-grid={GRID}
          data-r={r}
          data-c={3}
          className={selectCls}
          value={insumo.tipo}
          onChange={(e) => onPatch({ tipo: e.target.value as InsumoTipo })}
          onKeyDown={(e) => (e.key === "Tab" || e.key === "Enter") && gridKeyDown(e, rows)}
        >
          {Object.entries(TIPO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <select
          data-grid={GRID}
          data-r={r}
          data-c={4}
          className={selectCls}
          value={insumo.categoria}
          onChange={(e) => onPatch({ categoria: e.target.value as InsumoCategoria })}
          onKeyDown={(e) => (e.key === "Tab" || e.key === "Enter") && gridKeyDown(e, rows)}
        >
          {Object.entries(CATEGORIA_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <TextCell
          {...cell}
          c={5}
          value={insumo.sector ? SECTOR_LABEL[insumo.sector] ?? insumo.sector : ""}
          onCommit={(v) => onPatch({ sector: sectorFromLabel(v) })}
        />
      </td>
      <td className={td}>
        <NumCell
          data-grid={GRID}
          data-r={r}
          data-c={6}
          className={cx(cellInputCls, "text-right tabular-nums")}
          value={precio}
          onValue={setPrecio}
          onKeyDown={(e) => gridKeyDown(e, rows)}
          onBlur={() => {
            if (precio !== (insumo.precio ?? 0)) onPrice(Math.round(precio));
          }}
          placeholder={insumo.precio === null ? "sin precio" : undefined}
          title={formatGs(insumo.precio)}
        />
      </td>
      <td className={td}>
        <NumCell
          data-grid={GRID}
          data-r={r}
          data-c={7}
          className={cx(cellInputCls, "text-right tabular-nums")}
          value={tol}
          onValue={setTol}
          onKeyDown={(e) => gridKeyDown(e, rows)}
          onBlur={() => {
            if (tol !== insumo.toleranciaPct) onPatch({ toleranciaPct: tol });
          }}
        />
      </td>
      <td className={td}>
        {insumo.tipo === "TIEMPO" ? (
          <NumCell
            data-grid={GRID}
            data-r={r}
            data-c={8}
            className={cx(cellInputCls, "text-right tabular-nums")}
            value={lh}
            onValue={setLh}
            onKeyDown={(e) => gridKeyDown(e, rows)}
            onBlur={() => {
              if (lh !== (insumo.consumoLh ?? 0)) onPatch({ consumoLh: lh > 0 ? lh : null });
            }}
          />
        ) : (
          <span className="block px-2 text-right text-slate-400">—</span>
        )}
      </td>
      <td className="border-r border-slate-200 px-2 py-1.5 text-xs">
        {insumo.precio === null ? <span className="text-red-600">Sin precio a la fecha</span> : fmtDate(insumo.vigenteDesde)}
        {insumo.proximoPrecio && (
          <div className="text-slate-500">
            {formatGs(insumo.proximoPrecio.precio)} desde {fmtDate(insumo.proximoPrecio.desde)}
          </div>
        )}
      </td>
      <td className="px-1 text-center">
        <button onClick={onHistory} className="rounded p-1 text-slate-500 hover:text-slate-900" title="Historial de precios">
          <History className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
};

const sectorFromLabel = (label: string): string | null => {
  if (!label) return null;
  const hit = Object.entries(SECTOR_LABEL).find(([, l]) => l.toLowerCase() === label.toLowerCase());
  return hit ? hit[0] : label.toUpperCase().replace(/\s+/g, "_");
};

// ─── Nuevo precio / historial / alta ──────────────────────────────────────

const NewPriceModal: React.FC<{
  insumo: Insumo;
  initialPrice: number;
  onClose: () => void;
  onSaved: () => void;
  showToast: Toast;
}> = ({ insumo, initialPrice, onClose, onSaved, showToast }) => {
  const [precio, setPrecio] = useState(initialPrice);
  const [desde, setDesde] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.addInsumoPrecio(insumo.id, { precio, vigenteDesde: desde });
      onSaved();
    } catch (e: any) {
      showToast(e.message || "No se pudo cargar el precio", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={`Nuevo precio · ${insumo.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || !desde}>
            {saving ? "Guardando…" : "Guardar vigencia"}
          </Button>
        </>
      }
    >
      <p className="text-sm">{insumo.description}</p>
      <p className="text-xs text-slate-500">
        Precio actual: {formatGs(insumo.precio)} {insumo.vigenteDesde && `(desde ${fmtDate(insumo.vigenteDesde)})`}. El precio anterior se
        conserva para los hechos con fecha previa.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Precio sin IVA (Gs)">
          <NumCell className={cx(inputClass, "text-right")} value={precio} onValue={(n) => setPrecio(Math.round(n))} autoFocus />
        </Field>
        <Field label="Vigente desde">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
};

const HistoryDrawer: React.FC<{ insumo: Insumo; onClose: () => void; onChanged: () => void; showToast: Toast }> = ({
  insumo,
  onClose,
  onChanged,
  showToast,
}) => {
  const [prices, setPrices] = useState<InsumoPrecio[] | null>(null);
  const [precio, setPrecio] = useState(insumo.precio ?? 0);
  const [desde, setDesde] = useState(todayIso());

  const load = useCallback(() => {
    api.getInsumoPrecios(insumo.id).then(setPrices).catch((e) => showToast(e.message, "error"));
  }, [insumo.id, showToast]);
  useEffect(load, [load]);

  const add = async () => {
    try {
      await api.addInsumoPrecio(insumo.id, { precio, vigenteDesde: desde });
      showToast("Precio cargado", "success");
      load();
      onChanged();
    } catch (e: any) {
      showToast(e.message || "No se pudo cargar el precio", "error");
    }
  };

  const today = todayIso();
  const vigenteId = prices?.find((p) => p.validFrom <= today)?.id;

  return (
    <Drawer title={`Historial de precios · ${insumo.code}`} onClose={onClose}>
      <p className="text-sm">
        {insumo.description} <span className="text-slate-500">({insumo.unit})</span>
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-xs font-semibold">
            <th className="py-1.5">Vigente desde</th>
            <th className="py-1.5 text-right">Precio s/IVA</th>
            <th className="py-1.5 pl-4">Origen</th>
          </tr>
        </thead>
        <tbody>
          {prices?.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="py-1.5">
                {fmtDate(p.validFrom)}
                {p.id === vigenteId && <span className="ml-2 text-xs font-semibold">vigente</span>}
                {p.validFrom > today && <span className="ml-2 text-xs text-slate-500">futuro</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatGs(p.price)}</td>
              <td className="py-1.5 pl-4 text-xs text-slate-500">{p.source || "—"}</td>
            </tr>
          ))}
          {prices?.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-slate-500">
                Sin precios cargados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t border-slate-200 pt-4">
        <Field label="Nuevo precio (Gs)">
          <NumCell className={cx(inputClass, "text-right")} value={precio} onValue={(n) => setPrecio(Math.round(n))} />
        </Field>
        <Field label="Vigente desde">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={add} disabled={!desde}>
          Agregar
        </Button>
      </div>
    </Drawer>
  );
};

const CreateInsumoModal: React.FC<{ defaultTipo: InsumoTipo; onClose: () => void; onCreated: () => void; showToast: Toast }> = ({
  defaultTipo,
  onClose,
  onCreated,
  showToast,
}) => {
  const [form, setForm] = useState({
    code: "",
    description: "",
    unit: "",
    category: "",
    tipo: defaultTipo,
    categoria: "MATERIAL" as InsumoCategoria,
    sector: "",
    toleranciaPct: 0,
    precio: 0,
    vigenteDesde: todayIso(),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      await api.createInsumo({
        ...form,
        category: form.category || undefined,
        sector: sectorFromLabel(form.sector),
      });
      onCreated();
    } catch (e: any) {
      showToast(e.message || "No se pudo crear el insumo", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nuevo insumo"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || !form.code || !form.description || !form.unit}>
            {saving ? "Guardando…" : "Crear"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Código">
          <input className={inputClass} value={form.code} onChange={set("code")} autoFocus />
        </Field>
        <Field label="Descripción" className="col-span-2">
          <input className={inputClass} value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Unidad">
          <input className={inputClass} value={form.unit} onChange={set("unit")} />
        </Field>
        <Field label="Tipo">
          <select className={inputClass} value={form.tipo} onChange={set("tipo")}>
            {Object.entries(TIPO_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoría">
          <select className={inputClass} value={form.categoria} onChange={set("categoria")}>
            {Object.entries(CATEGORIA_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subcategoría" hint="Ej: Hormigones, Aceros">
          <input className={inputClass} value={form.category} onChange={set("category")} />
        </Field>
        <Field label="Sector" hint="Opcional (MO)">
          <input className={inputClass} value={form.sector} onChange={set("sector")} list="insumo-sectores" />
          <datalist id="insumo-sectores">
            {Object.values(SECTOR_LABEL).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field label="Tolerancia de desvío %">
          <NumCell className={inputClass} value={form.toleranciaPct} onValue={(n) => setForm({ ...form, toleranciaPct: n })} />
        </Field>
        <Field label="Precio sin IVA (Gs)">
          <NumCell className={cx(inputClass, "text-right")} value={form.precio} onValue={(n) => setForm({ ...form, precio: Math.round(n) })} />
        </Field>
        <Field label="Vigente desde">
          <input type="date" className={inputClass} value={form.vigenteDesde} onChange={set("vigenteDesde")} />
        </Field>
      </div>
    </Modal>
  );
};
