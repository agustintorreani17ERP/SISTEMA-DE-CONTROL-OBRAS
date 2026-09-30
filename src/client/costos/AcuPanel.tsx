import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Copy, Save, Trash2, Undo2 } from "lucide-react";
import { api } from "../api";
import type { AcuBibliotecaItem, AcuGrupo, CostNode, Insumo, InsumoTipo, ItemAcuData, Project } from "../types";
import { Button, Field, Modal, cx, inputClass } from "../ui";
import { formatGs, formatPct, formatQty } from "../utils/numbers";
import { NumCell, cellInputCls, gridKeyDown } from "../components/certifications/sheetGrid";
import { computeAcu } from "../../domain/acuMath";
import { TIPO_LABEL } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const GRUPOS: { grupo: AcuGrupo; label: string; short: string }[] = [
  { grupo: "MATERIAL", label: "Materiales", short: "MAT" },
  { grupo: "MANO_OBRA", label: "Mano de obra", short: "MO" },
  { grupo: "EQUIPO", label: "Equipos", short: "EQ" },
];

interface DraftLine {
  key: string;
  insumoId: number;
  codigo: string;
  insumo: string;
  unidad: string;
  tipo: InsumoTipo;
  grupo: AcuGrupo;
  consumo: number;
  desperdicioPct: number;
  precio: number | null;
  nota: string | null;
}

const toDraft = (data: ItemAcuData): DraftLine[] =>
  data.lineas.map((l) => ({
    key: `c${l.id}`,
    insumoId: l.insumoId,
    codigo: l.codigo,
    insumo: l.insumo,
    unidad: l.unidad,
    tipo: l.tipo,
    grupo: l.grupo,
    consumo: l.consumo,
    desperdicioPct: l.desperdicioPct,
    precio: l.precio,
    nota: l.nota,
  }));

const sameLines = (a: DraftLine[], b: DraftLine[]) =>
  a.length === b.length &&
  a.every((l, i) => l.insumoId === b[i].insumoId && l.consumo === b[i].consumo && l.desperdicioPct === b[i].desperdicioPct);

// ─── Panel: lista de ítems + editor ───────────────────────────────────────

export const AcuPanel: React.FC<{
  project: Project;
  nodes: CostNode[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
  showToast: Toast;
}> = ({ project, nodes, selectedId, onSelect, onChanged, showToast }) => {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pareto" | "sin" | "supera">("todos");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getInsumos().then(setInsumos).catch((e) => showToast(e.message, "error"));
  }, [showToast]);

  const items = useMemo(() => {
    const text = q.trim().toLowerCase();
    return nodes.filter(
      (n) =>
        n.nodeKind === "ITEM" &&
        !n.isSystem &&
        (!text || `${n.code} ${n.name}`.toLowerCase().includes(text)) &&
        (filtro === "todos" ||
          (filtro === "pareto" && n.pareto) ||
          (filtro === "sin" && n.acuComponentes === 0) ||
          (filtro === "supera" && n.acuSuperaOferta))
    );
  }, [nodes, q, filtro]);

  const select = (id: number) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Hay cambios sin guardar en este ACU. ¿Descartarlos?")) return;
    setDirty(false);
    onSelect(id);
  };

  return (
    <div className="grid grid-cols-1 gap-4 text-slate-900 xl:grid-cols-[340px_1fr]">
      <div className="flex max-h-[78vh] flex-col border border-slate-300">
        <div className="space-y-2 border-b border-slate-300 p-2">
          <input className={inputClass} placeholder="Buscar ítem…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {(
              [
                ["todos", "Todos"],
                ["pareto", "Pareto 80 %"],
                ["sin", "Sin ACU"],
                ["supera", "Superan oferta"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} onClick={() => setFiltro(v)} className={cx(filtro === v ? "font-semibold underline underline-offset-4" : "text-slate-500")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto text-sm">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => select(n.id)}
                className={cx("flex w-full items-start gap-2 border-b border-slate-100 px-2 py-1.5 text-left", n.id === selectedId ? "font-semibold outline-2 -outline-offset-2 outline-slate-900" : "hover:bg-slate-50")}
              >
                <span className="w-16 shrink-0 font-mono text-xs text-slate-500">
                  {n.code}
                  {n.pareto && <span className="ml-0.5 text-slate-900">●</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{n.name}</span>
                  <span className="text-xs font-normal text-slate-500">
                    {n.acuComponentes ? `ACU ${n.acuComponentes} insumos` : n.costoMetaFuente === "K" ? "Sin ACU · PU ÷ K" : "Sin ACU"}
                    {n.acuSuperaOferta && <span className="ml-1 font-semibold text-red-600">supera oferta</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="p-4 text-center text-sm text-slate-500">Sin ítems.</li>}
        </ul>
        <p className="border-t border-slate-300 px-2 py-1 text-xs text-slate-500">
          {items.length} ítems · ● Pareto 80 %
        </p>
      </div>

      {selectedId ? (
        <AcuEditor
          key={selectedId}
          itemId={selectedId}
          project={project}
          nodes={nodes}
          insumos={insumos}
          onDirty={setDirty}
          onSaved={() => {
            setDirty(false);
            onChanged();
          }}
          showToast={showToast}
        />
      ) : (
        <div className="flex items-center justify-center border border-dashed border-slate-300 p-10 text-sm text-slate-500">
          Elegí un ítem para ver o cargar su análisis de costo unitario.
        </div>
      )}
    </div>
  );
};

// ─── Editor del ACU de un ítem (hoja "3 ACU") ─────────────────────────────

const AcuEditor: React.FC<{
  itemId: number;
  project: Project;
  nodes: CostNode[];
  insumos: Insumo[];
  onDirty: (d: boolean) => void;
  onSaved: () => void;
  showToast: Toast;
}> = ({ itemId, project, nodes, insumos, onDirty, onSaved, showToast }) => {
  const [data, setData] = useState<ItemAcuData | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await api.getItemAcu(itemId);
      setData(d);
      setLines(toDraft(d));
    } catch (e: any) {
      showToast(e.message || "No se pudo cargar el ACU", "error");
    }
  }, [itemId, showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = data ? !sameLines(lines, toDraft(data)) : false;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const result = useMemo(
    () =>
      data
        ? computeAcu({
            unitPrice: data.item.unitPrice,
            quantity: data.item.quantity,
            coeficienteK: data.project.coeficienteK,
            ivaPct: data.project.ivaPct,
            lines,
          })
        : null,
    [data, lines]
  );

  if (!data || !result) return <div className="p-6 text-sm text-slate-500">Cargando ACU…</div>;

  const unit = data.item.unit || "un.";
  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const add = (ins: Insumo) =>
    setLines((ls) => [
      ...ls,
      {
        key: `n${++seq.current}`,
        insumoId: ins.id,
        codigo: ins.code,
        insumo: ins.description,
        unidad: ins.unit,
        tipo: ins.tipo,
        grupo: ins.categoria,
        consumo: 1,
        desperdicioPct: 0,
        precio: ins.precio,
        nota: null,
      },
    ]);

  const save = async () => {
    const bad = lines.find((l) => !(l.consumo > 0));
    if (bad) {
      showToast(`El consumo de ${bad.codigo} tiene que ser mayor a 0`, "error");
      return;
    }
    setSaving(true);
    try {
      // Orden: materiales, mano de obra, equipos, como se ve en pantalla.
      const ordered = GRUPOS.flatMap((g) => lines.filter((l) => l.grupo === g.grupo));
      await api.saveItemAcu(
        itemId,
        ordered.map((l) => ({ insumoId: l.insumoId, consumo: l.consumo, desperdicioPct: l.desperdicioPct, nota: l.nota }))
      );
      showToast("ACU guardado", "success");
      await load();
      onSaved();
    } catch (e: any) {
      showToast(e.message || "No se pudo guardar el ACU", "error");
    } finally {
      setSaving(false);
    }
  };

  const used = new Set(lines.map((l) => l.insumoId));
  const k = data.project.coeficienteK;
  let row = 0;
  const totalRows = lines.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            ÍTEM {data.item.code} — {data.item.name} [{unit}]
          </h3>
          <p className="text-xs text-slate-500">
            Cantidad de contrato {formatQty(data.item.quantity)} {unit} · PU con IVA {formatGs(data.item.unitPrice)} · precios vigentes al{" "}
            {data.fecha.split("-").reverse().join("/")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<BookOpen className="h-4 w-4" />} onClick={() => setLibraryOpen(true)}>
            Traer de biblioteca
          </Button>
          <Button icon={<Copy className="h-4 w-4" />} onClick={() => setCopyOpen(true)} disabled={!data.lineas.length || dirty} title={dirty ? "Guardá antes de copiar" : undefined}>
            Copiar a…
          </Button>
          <Button icon={<Undo2 className="h-4 w-4" />} onClick={() => setLines(toDraft(data))} disabled={!dirty || saving}>
            Descartar
          </Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} disabled={!dirty || saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-300">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs font-semibold">
              <th className="w-20 px-2 py-2">Código</th>
              <th className="px-2 py-2">Insumo</th>
              <th className="w-14 px-2 py-2">Un.</th>
              <th className="w-28 px-2 py-2 text-right">Consumo por {unit}</th>
              <th className="w-20 px-2 py-2 text-right">% desp.</th>
              <th className="w-28 px-2 py-2 text-right">Precio unit. (Gs)</th>
              <th className="w-32 px-2 py-2 text-right">Parcial (Gs/{unit})</th>
              <th className="w-20 px-2 py-2">Tipo</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {GRUPOS.map((g) => {
              const groupLines = lines.filter((l) => l.grupo === g.grupo);
              return (
                <React.Fragment key={g.grupo}>
                  <tr className="border-b border-slate-200">
                    <td colSpan={9} className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide">
                      {g.label}
                    </td>
                  </tr>
                  {groupLines.map((l) => {
                    const r = row++;
                    const idx = lines.indexOf(l);
                    return (
                      <tr key={l.key} className="border-b border-slate-100">
                        <td className="px-2 py-1 font-mono text-xs">{l.codigo}</td>
                        <td className="px-2 py-1">{l.insumo}</td>
                        <td className="px-2 py-1 text-slate-600">{l.unidad}</td>
                        <td className="border-l border-slate-200 p-0">
                          <NumCell
                            data-grid="acu"
                            data-r={r}
                            data-c={0}
                            className={cx(cellInputCls, "text-right tabular-nums", !(l.consumo > 0) && "text-red-600")}
                            value={l.consumo}
                            onValue={(n) => update(l.key, { consumo: n })}
                            onKeyDown={(e) => gridKeyDown(e, totalRows)}
                          />
                        </td>
                        <td className="border-l border-r border-slate-200 p-0">
                          <NumCell
                            data-grid="acu"
                            data-r={r}
                            data-c={1}
                            className={cx(cellInputCls, "text-right tabular-nums")}
                            value={l.desperdicioPct}
                            onValue={(n) => update(l.key, { desperdicioPct: n })}
                            onKeyDown={(e) => gridKeyDown(e, totalRows)}
                          />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {l.precio === null ? <span className="font-semibold text-red-600">sin precio</span> : formatGs(l.precio)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{formatGs(result.parciales[idx])}</td>
                        <td className="px-2 py-1 text-xs text-slate-600">{TIPO_LABEL[l.tipo]}</td>
                        <td className="px-1 text-center">
                          <button onClick={() => remove(l.key)} className="p-1 text-slate-400 hover:text-slate-900" title="Quitar insumo">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-b border-slate-100">
                    <td colSpan={6} className="px-2 py-1">
                      <InsumoPicker insumos={insumos.filter((i) => i.categoria === g.grupo && !used.has(i.id))} placeholder={`+ Agregar ${g.label.toLowerCase()}…`} onPick={add} />
                    </td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatGs(result.subtotales[g.grupo])}</td>
                    <td colSpan={2} className="px-2 py-1 text-xs text-slate-500">
                      Subtotal {g.short}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <table className="w-full border border-slate-300 text-sm">
          <tbody>
            <SummaryRow label="Materiales" value={formatGs(result.subtotales.MATERIAL)} />
            <SummaryRow label="Mano de obra" value={formatGs(result.subtotales.MANO_OBRA)} />
            <SummaryRow label="Equipos" value={formatGs(result.subtotales.EQUIPO)} />
            <SummaryRow label={`COSTO DIRECTO ACU (Gs/${unit})`} value={result.costoAcu === null ? "—" : formatGs(result.costoAcu)} strong />
            <SummaryRow label="PU de contrato (con IVA)" value={formatGs(data.item.unitPrice)} />
            <SummaryRow label={k ? `Costo usado en la oferta (PU ÷ ${formatQty(k, 4)})` : "Costo usado en la oferta (PU ÷ K)"} value={result.costoOferta === null ? "definí K" : formatGs(result.costoOferta)} />
            <SummaryRow
              label="Diferencia ACU − oferta"
              value={result.diferenciaOferta === null ? "—" : formatGs(result.diferenciaOferta)}
              alert={result.superaOferta}
            />
            <SummaryRow label={`Venta sin IVA (PU ÷ ${formatQty(1 + data.project.ivaPct / 100, 2)})`} value={formatGs(result.ventaSinIvaUnit)} />
            <SummaryRow
              label="Margen previsto s/ venta sin IVA"
              value={result.margenPct === null ? "—" : formatPct(result.margenPct)}
              alert={(result.margenPct ?? 0) < 0}
              strong
            />
          </tbody>
        </table>
        <div className="space-y-3 text-sm">
          <div className={cx("border px-3 py-2", result.superaOferta ? "border-red-600 font-semibold text-red-600" : "border-slate-300")}>
            {result.costoAcu === null
              ? k
                ? "Sin ACU: el costo meta es PU ÷ K."
                : "Sin ACU y la obra no tiene K: el ítem no tiene costo meta."
              : result.costoOferta === null
              ? "La obra no tiene K: cargalo en Control para comparar con la oferta."
              : result.superaOferta
              ? "ACU supera la oferta: el ítem pierde margen antes de empezar."
              : "OK: ACU dentro del costo cotizado."}
          </div>
          {result.lineasSinPrecio > 0 && (
            <p className="font-semibold text-red-600">
              {result.lineasSinPrecio} insumo(s) sin precio vigente: cuentan como 0. Cargales precio en Configuración › Insumos.
            </p>
          )}
          <table className="w-full border border-slate-300">
            <tbody>
              <SummaryRow label={`Cantidad de contrato (${unit})`} value={formatQty(data.item.quantity)} />
              <SummaryRow label="Costo meta total" value={result.costoMetaTotal === null ? "—" : formatGs(result.costoMetaTotal)} strong />
              <SummaryRow label="Venta total sin IVA" value={formatGs(result.ventaSinIvaTotal)} />
              <SummaryRow label="Margen previsto total" value={result.margenTotal === null ? "—" : formatGs(result.margenTotal)} alert={(result.margenTotal ?? 0) < 0} />
            </tbody>
          </table>
          <p className="text-xs text-slate-500">
            Parcial = consumo × (1 + % desperdicio) × precio vigente. Montos sin IVA. Si el ítem no tiene componentes, el costo meta es PU ÷ K.
          </p>
        </div>
      </div>

      {copyOpen && (
        <CopyAcuModal
          source={data}
          currentProject={project}
          currentNodes={nodes}
          onClose={() => setCopyOpen(false)}
          onDone={() => {
            setCopyOpen(false);
            onSaved();
          }}
          showToast={showToast}
        />
      )}
      {libraryOpen && (
        <LibraryModal
          target={data}
          dirty={dirty}
          onClose={() => setLibraryOpen(false)}
          onDone={async () => {
            setLibraryOpen(false);
            await load();
            onSaved();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; value: React.ReactNode; strong?: boolean; alert?: boolean }> = ({ label, value, strong, alert }) => (
  <tr className="border-b border-slate-200 last:border-b-0">
    <td className={cx("px-3 py-1.5", strong && "font-semibold")}>{label}</td>
    <td className={cx("px-3 py-1.5 text-right tabular-nums", strong && "font-semibold", alert && "font-semibold text-red-600")}>{value}</td>
  </tr>
);

// ─── Selector de insumo ───────────────────────────────────────────────────

const InsumoPicker: React.FC<{ insumos: Insumo[]; placeholder: string; onPick: (i: Insumo) => void }> = ({ insumos, placeholder, onPick }) => {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    return insumos.filter((i) => !t || `${i.code} ${i.description}`.toLowerCase().includes(t)).slice(0, 30);
  }, [insumos, text]);

  const pick = (i: Insumo) => {
    onPick(i);
    setText("");
    setOpen(false);
    setHi(0);
  };

  return (
    <div className="relative">
      <input
        className="w-full bg-transparent py-0.5 text-sm outline-hidden placeholder:text-slate-400"
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && matches[hi]) {
            e.preventDefault();
            pick(matches[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-[520px] overflow-y-auto border border-slate-300 bg-white text-sm shadow-lg">
          {matches.map((i, idx) => (
            <li key={i.id}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                className={cx("flex w-full gap-2 px-2 py-1 text-left", idx === hi && "bg-slate-100")}
              >
                <span className="w-20 shrink-0 font-mono text-xs">{i.code}</span>
                <span className="flex-1 truncate">{i.description}</span>
                <span className="w-10 text-slate-500">{i.unit}</span>
                <span className={cx("w-24 text-right tabular-nums", i.precio === null && "text-red-600")}>{i.precio === null ? "sin precio" : formatGs(i.precio)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-2 text-slate-500">No hay insumos de este grupo. Crealos en Configuración › Insumos.</li>}
        </ul>
      )}
    </div>
  );
};

// ─── Copiar a otros ítems / otra obra ─────────────────────────────────────

const CopyAcuModal: React.FC<{
  source: ItemAcuData;
  currentProject: Project;
  currentNodes: CostNode[];
  onClose: () => void;
  onDone: () => void;
  showToast: Toast;
}> = ({ source, currentProject, currentNodes, onClose, onDone, showToast }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(currentProject.id);
  const [nodes, setNodes] = useState<CostNode[]>(currentNodes);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [modo, setModo] = useState<"REEMPLAZAR" | "AGREGAR">("REEMPLAZAR");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => setProjects([currentProject]));
  }, [currentProject]);
  useEffect(() => {
    setSelected(new Set());
    if (projectId === currentProject.id) {
      setNodes(currentNodes);
      return;
    }
    api
      .getCostControl(projectId)
      .then((d) => setNodes(d.nodes))
      .catch((e) => showToast(e.message, "error"));
  }, [projectId, currentProject.id, currentNodes, showToast]);

  const candidates = nodes.filter(
    (n) => n.nodeKind === "ITEM" && !n.isSystem && n.id !== source.item.id && (!q.trim() || `${n.code} ${n.name}`.toLowerCase().includes(q.trim().toLowerCase()))
  );
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.copyAcu({ sourceItemId: source.item.id, targetItemIds: [...selected], modo });
      showToast(`ACU copiado a ${res.copiados} ítem(s)${res.avisos.length ? ` · ${res.avisos.join(" · ")}` : ""}`, res.avisos.length ? "info" : "success");
      onDone();
    } catch (e: any) {
      showToast(e.message || "No se pudo copiar", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      size="lg"
      title={`Copiar ACU de ${source.item.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={run} disabled={busy || selected.size === 0}>
            {busy ? "Copiando…" : `Copiar a ${selected.size} ítem(s)`}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-slate-900">
        <Field label="Obra de destino">
          <select className={inputClass} value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            {(projects.length ? projects : [currentProject]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Buscar ítem">
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>
      <div className="max-h-[45vh] overflow-y-auto border border-slate-300 text-sm">
        {candidates.map((n) => {
          const unitMismatch = (n.unit || "").toLowerCase() !== (source.item.unit || "").toLowerCase();
          return (
            <label key={n.id} className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-2 py-1.5">
              <input type="checkbox" className="mt-0.5" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
              <span className="w-16 shrink-0 font-mono text-xs">{n.code}</span>
              <span className="flex-1">{n.name}</span>
              <span className={cx("w-10", unitMismatch && "font-semibold text-red-600")} title={unitMismatch ? "Unidad distinta a la del origen" : undefined}>
                {n.unit}
              </span>
              <span className="w-24 text-right text-xs text-slate-500">{n.acuComponentes ? `tiene ACU (${n.acuComponentes})` : ""}</span>
            </label>
          );
        })}
        {candidates.length === 0 && <p className="p-4 text-center text-slate-500">Sin ítems.</p>}
      </div>
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={modo === "REEMPLAZAR"} onChange={() => setModo("REEMPLAZAR")} />
          Reemplazar el ACU del destino
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={modo === "AGREGAR"} onChange={() => setModo("AGREGAR")} />
          Agregar a lo que ya tiene
        </label>
      </div>
    </Modal>
  );
};

// ─── Biblioteca: traer un ACU de otro ítem u obra ─────────────────────────

const LibraryModal: React.FC<{
  target: ItemAcuData;
  dirty: boolean;
  onClose: () => void;
  onDone: () => void;
  showToast: Toast;
}> = ({ target, dirty, onClose, onDone, showToast }) => {
  const [q, setQ] = useState(target.item.name.split(" ").slice(0, 3).join(" "));
  const [list, setList] = useState<AcuBibliotecaItem[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [modo, setModo] = useState<"REEMPLAZAR" | "AGREGAR">("REEMPLAZAR");

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .getAcuBiblioteca({ q: q.trim() || undefined })
        .then((l) => setList(l.filter((i) => i.id !== target.item.id)))
        .catch((e) => showToast(e.message, "error"));
    }, 250);
    return () => clearTimeout(t);
  }, [q, target.item.id, showToast]);

  const use = async (src: AcuBibliotecaItem) => {
    if (dirty && !window.confirm("Los cambios sin guardar de este ACU se van a perder. ¿Seguir?")) return;
    try {
      const res = await api.copyAcu({ sourceItemId: src.id, targetItemIds: [target.item.id], modo });
      showToast(`ACU traído de ${src.project.code} · ${src.code}${res.avisos.length ? ` · ${res.avisos.join(" · ")}` : ""}`, res.avisos.length ? "info" : "success");
      onDone();
    } catch (e: any) {
      showToast(e.message || "No se pudo copiar", "error");
    }
  };

  return (
    <Modal size="lg" title={`Biblioteca de ACU → ${target.item.code}`} onClose={onClose}>
      <div className="flex items-end gap-4 text-slate-900">
        <Field label="Buscar en todas las obras" className="flex-1">
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </Field>
        <div className="flex gap-4 pb-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={modo === "REEMPLAZAR"} onChange={() => setModo("REEMPLAZAR")} />
            Reemplazar
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={modo === "AGREGAR"} onChange={() => setModo("AGREGAR")} />
            Agregar
          </label>
        </div>
      </div>
      <div className="max-h-[55vh] overflow-y-auto border border-slate-300 text-sm text-slate-900">
        {list === null && <p className="p-4 text-slate-500">Buscando…</p>}
        {list?.length === 0 && <p className="p-4 text-center text-slate-500">No hay ACU que coincidan.</p>}
        {list?.map((i) => {
          const unitMismatch = (i.unit || "").toLowerCase() !== (target.item.unit || "").toLowerCase();
          return (
            <div key={i.id} className="border-b border-slate-200">
              <div className="flex items-start gap-2 px-2 py-1.5">
                <button onClick={() => setOpen(open === i.id ? null : i.id)} className="flex flex-1 items-start gap-2 text-left">
                  <span className="w-20 shrink-0 text-xs text-slate-500">{i.project.code}</span>
                  <span className="w-14 shrink-0 font-mono text-xs">{i.code}</span>
                  <span className="flex-1">{i.name}</span>
                  <span className={cx("w-10", unitMismatch && "font-semibold text-red-600")}>{i.unit}</span>
                  <span className="w-28 text-right tabular-nums">{formatGs(i.costoAcu)}</span>
                </button>
                <Button size="sm" onClick={() => use(i)}>
                  Usar
                </Button>
              </div>
              {open === i.id && (
                <table className="mb-2 ml-24 w-[calc(100%-7rem)] text-xs">
                  <tbody>
                    {i.lineas.map((l) => (
                      <tr key={l.codigo}>
                        <td className="w-16 font-mono">{l.codigo}</td>
                        <td>{l.insumo}</td>
                        <td className="w-24 text-right tabular-nums">
                          {formatQty(l.consumo, 3)} {l.unidad}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
