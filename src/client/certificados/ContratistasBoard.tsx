import React, { useEffect, useMemo, useState } from "react";
import { Building2, Camera, ChevronLeft, ChevronRight, ClipboardCheck, FileText, HardHat, Pencil, Plus, Ruler, Search, UserPlus } from "lucide-react";
import { api } from "../api";
import { Certification, LaborPrice, Partner, Project, SubcontractorContract } from "../types";
import { Badge, Button, Card, EmptyState, Field, Modal, ProgressBar, cx, inputClass } from "../ui";
import { formatMoney } from "../utils/format";
import { CERT_STATUS, periodLabel } from "./status";

/**
 * Fichas por contratista, para Mediciones y para Certificados.
 * La lista sale del maestro de proveedores/subcontratistas (Partner): lo que se crea o edita acá
 * aparece allá y viceversa. El rubro y la frecuencia de corte se guardan en `classification`
 * con el mismo formato que usa el calendario de subcontratistas ("OBRA CIVIL - CORTE_QUINCENAL").
 * Un contratista puede no tener contrato: se mide y certifica con la lista de mano de obra.
 */

export type ModoFichas = "MEDICION" | "CERTIFICADO";

interface Props {
  modo: ModoFichas;
  project: Project;
  partners: Partner[];
  subcontracts: SubcontractorContract[];
  certs: Certification[];
  currency: "PYG" | "USD";
  onNew: (partnerId: number | null) => void;
  onOpenDocument: (id: number) => void;
  onPartnersChanged: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

type Filtro = "TODOS" | "ACTIVOS" | "PENDIENTES" | "SIN_DOC" | "BAJA";
type Frecuencia = "SEMANAL" | "QUINCENAL" | "MENSUAL";

/** Clave del destino: id del subcontratista, o 0 para el avance de obra (cliente). */
type Key = number;
const CLIENTE: Key = 0;

const n = (v: unknown) => Number(v ?? 0) || 0;
const qty = (v: number) => v.toLocaleString("es-PY", { maximumFractionDigits: 2 });
const numero = (c: Certification) => String(c.numero).padStart(2, "0");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const CORTE: Record<Frecuencia, string> = {
  SEMANAL: "Viernes de cada semana",
  QUINCENAL: "Días 15 y 30 de cada mes",
  MENSUAL: "Fin de mes",
};

/** Lee rubro y frecuencia de corte del campo classification (mismo formato que el calendario). */
export function leerClasificacion(classification?: string | null): { rubro: string; frecuencia: Frecuencia } {
  const t = (classification || "").toUpperCase();
  const frecuencia: Frecuencia = t.includes("SEMANA") ? "SEMANAL" : t.includes("MENSUAL") ? "MENSUAL" : "QUINCENAL";
  const rubro = (classification || "").split(" - CORTE_")[0].split("-CORTE_")[0].trim() || "OBRA CIVIL";
  return { rubro, frecuencia };
}
const armarClasificacion = (rubro: string, frecuencia: Frecuencia) => `${rubro.trim().toUpperCase() || "OBRA CIVIL"} - CORTE_${frecuencia}`;

const esMedicion = (c: Certification) => c.estado === "MEDICION_BORRADOR" || c.estado === "MEDICION_CERRADA";
const esCertificado = (c: Certification) => c.estado === "CERTIFICADO_BORRADOR" || c.estado === "APROBADO";

interface Resumen {
  key: Key;
  nombre: string;
  partner: Partner | null;
  rubro: string;
  frecuencia: Frecuencia | null;
  activo: boolean;
  contratos: SubcontractorContract[];
  certs: Certification[]; // todos los documentos, del más nuevo al más viejo
  docs: Certification[]; // los de la pestaña (mediciones o certificados)
  contratado: number;
  aprobado: number;
  pendientes: number;
  reparo: number;
  neto: number;
  ultimo: Certification | null;
}

function resumir(modo: ModoFichas, key: Key, partner: Partner | null, contratos: SubcontractorContract[], certs: Certification[]): Resumen {
  const ordenados = [...certs].sort((a, b) => b.numero - a.numero);
  const aprobados = ordenados.filter((c) => c.estado === "APROBADO");
  // En Mediciones se ve todo lo medido (una medición después pasa a certificado); en Certificados, solo certificados.
  const docs = modo === "MEDICION" ? ordenados : ordenados.filter(esCertificado);
  const clas = partner ? leerClasificacion(partner.classification) : null;
  return {
    key,
    nombre: partner?.name ?? "Avance de obra (cliente)",
    partner,
    rubro: clas?.rubro ?? "Medición oficial · precios de venta",
    frecuencia: clas?.frecuencia ?? null,
    activo: partner ? partner.active !== false : true,
    contratos,
    certs: ordenados,
    docs,
    contratado: contratos.filter((c) => c.status !== "CANCELADO").reduce((a, c) => a + n(c.contractAmount), 0),
    aprobado: aprobados.reduce((a, c) => a + n(c.montoTotal), 0),
    pendientes: ordenados.filter((c) => (modo === "MEDICION" ? c.estado === "MEDICION_BORRADOR" : c.estado === "CERTIFICADO_BORRADOR")).length,
    reparo: aprobados.reduce((a, c) => a + n(c.retentionAmount), 0),
    neto: aprobados.reduce((a, c) => a + n(c.netAmount ?? c.montoTotal), 0),
    ultimo: docs[0] ?? null,
  };
}

export function ContratistasBoard({ modo, project, partners, subcontracts, certs, currency, onNew, onOpenDocument, onPartnersChanged, showToast }: Props) {
  const [selected, setSelected] = useState<Key | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [search, setSearch] = useState("");
  const [laborPrices, setLaborPrices] = useState<LaborPrice[]>([]);
  const [editando, setEditando] = useState<Partner | "nuevo" | null>(null);
  const money = (v: number) => formatMoney(v, currency);
  const txt = modo === "MEDICION" ? TEXTOS_MEDICION : TEXTOS_CERT;

  useEffect(() => {
    api
      .getLaborPrices(project.id)
      .then(setLaborPrices)
      .catch(() => setLaborPrices([]));
  }, [project.id]);

  const resumenes = useMemo(() => {
    const projectContracts = subcontracts.filter((c) => c.projectId === project.id);
    const subs = partners.filter((p) => p.kind !== "SUPPLIER");
    // Si alguien certificó y después se lo pasó a proveedor o se borró, igual se muestra.
    const extra = certs
      .filter((c) => c.partnerId && !subs.some((p) => p.id === c.partnerId) && c.partner)
      .map((c) => c.partner as Partner)
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
    const list = [...subs, ...extra].map((p) =>
      resumir(
        modo,
        p.id,
        p,
        projectContracts.filter((c) => c.partnerId === p.id),
        certs.filter((c) => c.partnerId === p.id),
      ),
    );
    const movimiento = (r: Resumen) => Number(r.certs.length > 0 || r.contratos.length > 0);
    list.sort((a, b) => movimiento(b) - movimiento(a) || a.nombre.localeCompare(b.nombre));
    return [
      resumir(
        modo,
        CLIENTE,
        null,
        [],
        certs.filter((c) => !c.partnerId),
      ),
      ...list,
    ];
  }, [modo, partners, subcontracts, certs, project.id]);

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resumenes.filter((r) => {
      if (q && !`${r.nombre} ${r.partner?.taxId ?? ""} ${r.rubro}`.toLowerCase().includes(q)) return false;
      if (filtro === "BAJA") return !r.activo;
      if (!r.activo) return false;
      if (filtro === "ACTIVOS") return r.certs.length > 0 || r.contratos.length > 0;
      if (filtro === "PENDIENTES") return r.pendientes > 0;
      if (filtro === "SIN_DOC") return r.docs.length === 0;
      return true;
    });
  }, [resumenes, filtro, search]);

  const modal = editando && (
    <PartnerModal
      partner={editando === "nuevo" ? null : editando}
      onClose={() => setEditando(null)}
      onSaved={(p) => {
        setEditando(null);
        onPartnersChanged();
        showToast(editando === "nuevo" ? `${p.name} agregado a la lista de subcontratistas` : "Datos actualizados en la lista de subcontratistas");
      }}
      showToast={showToast}
    />
  );

  if (selected !== null) {
    const idx = visibles.findIndex((r) => r.key === selected);
    const actual = resumenes.find((r) => r.key === selected);
    if (actual) {
      const nav = (d: number) => {
        if (idx < 0 || !visibles.length) return;
        setSelected(visibles[(idx + d + visibles.length) % visibles.length].key);
      };
      return (
        <>
          <FichaContratista
            modo={modo}
            r={actual}
            posicion={idx >= 0 ? `${idx + 1} de ${visibles.length}` : ""}
            laborPrices={laborPrices}
            money={money}
            onBack={() => setSelected(null)}
            onPrev={() => nav(-1)}
            onNext={() => nav(1)}
            onNew={() => onNew(actual.key === CLIENTE ? null : actual.key)}
            onOpen={onOpenDocument}
            onEdit={actual.partner ? () => setEditando(actual.partner) : undefined}
          />
          {modal}
        </>
      );
    }
  }

  const activos = resumenes.filter((r) => r.activo);
  const filtros: { value: Filtro; label: string; count: number }[] = [
    { value: "TODOS", label: "Todos", count: activos.length },
    { value: "ACTIVOS", label: "Con movimiento", count: activos.filter((r) => r.certs.length > 0 || r.contratos.length > 0).length },
    { value: "PENDIENTES", label: txt.filtroPendientes, count: activos.filter((r) => r.pendientes > 0).length },
    { value: "SIN_DOC", label: txt.filtroSinDoc, count: activos.filter((r) => r.docs.length === 0).length },
    { value: "BAJA", label: "Dados de baja", count: resumenes.length - activos.length },
  ];

  return (
    <div className="space-y-4">
      <ol className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-900 sm:grid-cols-3">
        {txt.pasos.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-900 text-xs font-semibold">{i + 1}</span>
            <span>
              <span className="block font-semibold">{t}</span>
              <span className="block text-xs text-slate-600">{d}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={cx(inputClass, "pl-9")} placeholder="Buscar contratista, RUC o rubro" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditando("nuevo")}>
          Nuevo contratista
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {filtros.map((f) => (
          <button
            key={f.value}
            onClick={() => setFiltro(f.value)}
            className={cx(
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              filtro === f.value ? "border-slate-900 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-400",
            )}
          >
            {f.label} <span className="tabular-nums">({f.count})</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          icon={<HardHat className="h-10 w-10" />}
          title="No hay contratistas con ese filtro"
          help="Los contratistas salen de la lista de subcontratistas. Agregá uno con «Nuevo contratista» o cambiá el filtro."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((r) => (
            <TarjetaContratista
              key={r.key}
              modo={modo}
              r={r}
              money={money}
              onOpen={() => setSelected(r.key)}
              onNew={() => onNew(r.key === CLIENTE ? null : r.key)}
            />
          ))}
        </div>
      )}
      {modal}
    </div>
  );
}

const TEXTOS_MEDICION = {
  pasos: [
    ["Elegí el contratista", "Las fichas salen de tu lista de subcontratistas, con todos sus datos."],
    ["Revisá su ficha", "Planilla de mano de obra con precios, última medición e historial."],
    ["Cargá la nueva medición", "Arranca con el contratista elegido. Después se revisa y pasa a certificado."],
  ] as [string, string][],
  filtroPendientes: "Mediciones abiertas",
  filtroSinDoc: "Sin mediciones",
  pendiente: (k: number) => `${k} medición${k === 1 ? "" : "es"} abierta${k === 1 ? "" : "s"}`,
  ultimo: "Última medición",
  ninguno: "Todavía no tiene mediciones.",
  nuevoCorto: "Nueva medición",
  nuevoLargo: "Cargar nueva medición",
  vista: "Vista previa · Medición",
  historial: "Mediciones",
};
const TEXTOS_CERT = {
  pasos: [
    ["Elegí el contratista", "Las fichas salen de tu lista de subcontratistas, con todos sus datos."],
    ["Revisá su ficha", "Planilla de mano de obra con precios, último certificado e historial."],
    ["Generá el nuevo certificado", "Arranca con el contratista elegido y los acumulados cargados."],
  ] as [string, string][],
  filtroPendientes: "Por aprobar",
  filtroSinDoc: "Sin certificados",
  pendiente: (k: number) => `${k} por aprobar`,
  ultimo: "Último certificado",
  ninguno: "Todavía no tiene certificados.",
  nuevoCorto: "Nuevo cert.",
  nuevoLargo: "Generar nuevo certificado",
  vista: "Vista previa · Certificado",
  historial: "Certificados",
};

/** En la pestaña Mediciones todo se nombra «Medición N°» (el certificado conserva el número de su medición). */
const docLabel = (c: Certification, modo?: ModoFichas) => `${modo === "MEDICION" || esMedicion(c) ? "Medición" : "Cert."} N° ${numero(c)}`;

function TarjetaContratista({
  modo,
  r,
  money,
  onOpen,
  onNew,
}: {
  modo: ModoFichas;
  r: Resumen;
  money: (v: number) => string;
  onOpen: () => void;
  onNew: () => void;
}) {
  const txt = modo === "MEDICION" ? TEXTOS_MEDICION : TEXTOS_CERT;
  const avance = r.contratado > 0 ? r.aprobado / r.contratado : 0;
  const esCliente = r.key === CLIENTE;
  return (
    <article
      onClick={onOpen}
      className={cx(
        "flex cursor-pointer flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xs transition hover:border-slate-900",
        !r.activo && "opacity-60",
      )}
    >
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-900 text-sm font-semibold">
          {esCliente ? <Building2 className="h-5 w-5" /> : initials(r.nombre)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold leading-snug">{r.nombre}</h3>
          <p className="text-xs text-slate-600">{esCliente ? r.rubro : `RUC ${r.partner?.taxId || "—"} · ${r.rubro}`}</p>
          {r.frecuencia && (
            <p className="text-xs text-slate-600">
              Corte {r.frecuencia.toLowerCase()} · {CORTE[r.frecuencia]}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {r.pendientes > 0 && <Badge tone="warn">{txt.pendiente(r.pendientes)}</Badge>}
            {!r.activo && <Badge>Dado de baja</Badge>}
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        {!esCliente && (
          <>
            <dt className="text-slate-600">Contrato</dt>
            <dd className="text-right tabular-nums">{r.contratos.length ? money(r.contratado) : "Sin contrato vinculado"}</dd>
          </>
        )}
        <dt className="text-slate-600">Certificado aprobado</dt>
        <dd className="whitespace-nowrap text-right font-semibold tabular-nums">{money(r.aprobado)}</dd>
        <dt className="text-slate-600">{modo === "MEDICION" ? "Mediciones" : "Certificados"}</dt>
        <dd className="text-right tabular-nums">{r.docs.length}</dd>
      </dl>

      {!esCliente && r.contratado > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>Avance del contrato</span>
            <span className="tabular-nums">{(avance * 100).toFixed(0)} %</span>
          </div>
          <ProgressBar value={avance} tone={avance > 1 ? "bad" : "neutral"} />
        </div>
      )}
      {!esCliente && r.contratado === 0 && <p className="text-xs text-slate-600">Se mide y certifica con los precios de la lista de mano de obra.</p>}

      <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
        {r.ultimo ? (
          <>
            <p className="font-medium">
              {txt.ultimo}: {docLabel(r.ultimo, modo)} · {money(n(r.ultimo.montoTotal))}
            </p>
            <p className="text-slate-600">
              {periodLabel(r.ultimo) || "sin período"} · {CERT_STATUS[r.ultimo.estado].label}
            </p>
          </>
        ) : (
          <p className="text-slate-600">{txt.ninguno}</p>
        )}
      </div>

      <footer className="mt-auto flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" className="flex-1" icon={<FileText className="h-4 w-4" />} onClick={onOpen}>
          Ver ficha y planilla
        </Button>
        <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew} disabled={!r.activo}>
          {txt.nuevoCorto}
        </Button>
      </footer>
    </article>
  );
}

interface FilaPlanilla {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string;
  precio: number;
  fuente: string;
  cantPresupuesto: number;
  acumulado: number;
  monto: number;
  enCurso: number;
}

function FichaContratista({
  modo,
  r,
  posicion,
  laborPrices,
  money,
  onBack,
  onPrev,
  onNext,
  onNew,
  onOpen,
  onEdit,
}: {
  modo: ModoFichas;
  r: Resumen;
  posicion: string;
  laborPrices: LaborPrice[];
  money: (v: number) => string;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onNew: () => void;
  onOpen: (id: number) => void;
  onEdit?: () => void;
}) {
  const txt = modo === "MEDICION" ? TEXTOS_MEDICION : TEXTOS_CERT;
  const esCliente = r.key === CLIENTE;

  /** Planilla general: todos los ítems que trabajó (contratos + documentos) con su precio de mano de obra. */
  const planilla = useMemo(() => {
    const filas = new Map<number, FilaPlanilla>();
    const lp = new Map(laborPrices.filter((l) => l.budgetItemId).map((l) => [l.budgetItemId as number, l]));
    const base = (id: number, bi?: { code?: string; name?: string; unit?: string | null; totalQuantity?: unknown } | null): FilaPlanilla => {
      const l = lp.get(id);
      return {
        budgetItemId: id,
        code: bi?.code ?? l?.budgetItem?.code ?? l?.code ?? String(id),
        name: bi?.name ?? l?.budgetItem?.name ?? l?.description ?? "",
        unit: bi?.unit ?? l?.unit ?? "",
        precio: !esCliente && l ? n(l.unitPrice) : 0,
        fuente: !esCliente && l ? "Lista de MO" : "—",
        cantPresupuesto: n(bi?.totalQuantity),
        acumulado: 0,
        monto: 0,
        enCurso: 0,
      };
    };
    for (const c of r.contratos) {
      if (!filas.has(c.budgetItemId)) filas.set(c.budgetItemId, base(c.budgetItemId, c.budgetItem as any));
    }
    // De los más viejos a los más nuevos, así el precio queda el del último documento.
    for (const c of [...r.certs].reverse()) {
      for (const i of c.items ?? []) {
        const f = filas.get(i.budgetItemId) ?? base(i.budgetItemId, i.budgetItem as any);
        if (i.budgetItem) {
          f.code = i.budgetItem.code;
          f.name = i.budgetItem.name;
          f.unit = i.budgetItem.unit ?? f.unit;
          f.cantPresupuesto = n((i.budgetItem as any).totalQuantity) || f.cantPresupuesto;
        }
        if (n(i.precioUnitario)) {
          f.precio = n(i.precioUnitario);
          f.fuente = docLabel(c);
        }
        if (c.estado === "APROBADO") {
          f.acumulado += n(i.cantidadPresente);
          f.monto += n(i.montoTotal);
        } else {
          f.enCurso += n(i.cantidadPresente);
        }
        filas.set(i.budgetItemId, f);
      }
    }
    return [...filas.values()].sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
  }, [r, laborPrices, esCliente]);

  const totalPlanilla = planilla.reduce((a, f) => a + f.monto, 0);
  const p = r.partner;

  return (
    <div className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} onClick={onBack}>
          Todos los contratistas
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrev}>
            Anterior
          </Button>
          {posicion && <span className="text-xs tabular-nums text-slate-600">{posicion}</span>}
          <Button size="sm" onClick={onNext}>
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-slate-900 text-lg font-semibold">
            {esCliente ? <Building2 className="h-6 w-6" /> : initials(r.nombre)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">
              {r.nombre} {!r.activo && <Badge>Dado de baja</Badge>}
            </h2>
            {esCliente ? (
              <p className="text-sm text-slate-600">Medición oficial del período con precios de venta del presupuesto.</p>
            ) : (
              <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
                <Dato label="RUC" value={p?.taxId} />
                <Dato label="Rubro" value={r.rubro} />
                <Dato label="Corte" value={r.frecuencia ? `${r.frecuencia.toLowerCase()} · ${CORTE[r.frecuencia]}` : null} />
                <Dato label="Tipo" value={p?.kind === "BOTH" ? "Proveedor y subcontratista" : "Subcontratista"} />
                <Dato label="Teléfono" value={p?.phone} />
                <Dato label="Email" value={p?.email} />
                <Dato label="Dirección" value={p?.fiscalAddress} />
              </dl>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {onEdit && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
                Editar datos
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew} disabled={!r.activo}>
              {txt.nuevoLargo}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {!esCliente && <Kpi label="Contrato" value={r.contratos.length ? money(r.contratado) : "Sin contrato"} />}
          <Kpi label="Certificado aprobado" value={money(r.aprobado)} />
          {!esCliente && <Kpi label="Saldo del contrato" value={r.contratos.length ? money(r.contratado - r.aprobado) : "—"} />}
          <Kpi label="Fondo de reparo retenido" value={money(r.reparo)} />
          <Kpi label="Neto aprobado" value={money(r.neto)} />
        </div>
      </section>

      {!esCliente && (
        <Card title={`Contratos vinculados (${r.contratos.length})`} padded={false}>
          {r.contratos.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-600">
              No tiene contrato en esta obra, y no hace falta: se mide y certifica con los precios de la lista de mano de obra. Si querés controlar un tope,
              creá el contrato en la pestaña Contratos.
            </p>
          ) : (
            <Tabla
              head={["N°", "Descripción", "Ítem", "Monto", "Certificado", "Saldo", "Estado"]}
              right={[3, 4, 5]}
              rows={r.contratos.map((c) => [
                c.number,
                c.description,
                c.budgetItem ? `${c.budgetItem.code} ${c.budgetItem.name}` : "—",
                money(n(c.contractAmount)),
                money(n(c.certifiedAmount)),
                money(n(c.contractAmount) - n(c.certifiedAmount)),
                c.status,
              ])}
            />
          )}
        </Card>
      )}

      <Card
        title={esCliente ? "Planilla general (precios de venta)" : "Planilla general de mano de obra"}
        action={<span className="text-xs text-slate-600">{planilla.length} ítem(s)</span>}
        padded={false}
      >
        {planilla.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-600">Todavía no hay ítems medidos ni contratados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs text-slate-600">
                <tr className="border-b border-slate-900">
                  <th className="px-4 py-2">Código</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Ud.</th>
                  <th className="px-3 py-2 text-right">Precio unit.</th>
                  <th className="px-3 py-2">Precio de</th>
                  <th className="px-3 py-2 text-right">Cant. presup.</th>
                  <th className="px-3 py-2 text-right">Acum. aprobado</th>
                  <th className="px-3 py-2 text-right">% avance</th>
                  <th className="px-3 py-2 text-right">Monto acum.</th>
                  <th className="px-4 py-2 text-right">En curso</th>
                </tr>
              </thead>
              <tbody>
                {planilla.map((f) => {
                  const pct = f.cantPresupuesto > 0 ? f.acumulado / f.cantPresupuesto : null;
                  return (
                    <tr key={f.budgetItemId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 font-medium tabular-nums">{f.code}</td>
                      <td className="px-3 py-2">{f.name}</td>
                      <td className="px-3 py-2">{f.unit}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{f.precio ? money(f.precio) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{f.fuente}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{f.cantPresupuesto ? qty(f.cantPresupuesto) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qty(f.acumulado)}</td>
                      <td className={cx("whitespace-nowrap px-3 py-2 text-right tabular-nums", pct !== null && pct > 1 && "font-semibold text-rose-700")}>
                        {pct === null ? "—" : `${(pct * 100).toFixed(1)} %`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(f.monto)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{f.enCurso ? qty(f.enCurso) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-900 font-semibold">
                  <td className="px-4 py-2" colSpan={8}>
                    Total certificado aprobado
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(totalPlanilla)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className="px-4 py-2 text-xs text-slate-600">«En curso»: cantidades en mediciones o certificados todavía sin aprobar.</p>
          </div>
        )}
      </Card>

      <VisorDocumentos modoInicial={modo} certs={r.certs} money={money} onOpen={onOpen} clave={r.key} />
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onNew} disabled={!r.activo}>
          {txt.nuevoLargo}
          {esCliente ? "" : ` para ${r.nombre}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Visor grande dentro de la ficha: pestaña Mediciones (cómputo y fotos de cada medición) y pestaña
 * Certificados (anterior / presente / acumulado, montos, fondo de reparo y neto), cada una con su
 * navegador para recorrer los documentos uno por uno.
 */
function VisorDocumentos({
  modoInicial,
  certs,
  money,
  onOpen,
  clave,
}: {
  modoInicial: ModoFichas;
  certs: Certification[];
  money: (v: number) => string;
  onOpen: (id: number) => void;
  clave: Key;
}) {
  const [tab, setTab] = useState<ModoFichas>(modoInicial);
  // Orden cronológico (N° 01, 02, …); se abre en el último.
  const listas = useMemo(() => {
    const asc = [...certs].sort((a, b) => a.numero - b.numero);
    return { MEDICION: asc, CERTIFICADO: asc.filter(esCertificado) };
  }, [certs]);
  const lista = listas[tab];
  const [pos, setPos] = useState<Record<ModoFichas, number>>({ MEDICION: -1, CERTIFICADO: -1 });
  useEffect(() => setPos({ MEDICION: -1, CERTIFICADO: -1 }), [clave]);
  const idx = lista.length ? (pos[tab] < 0 || pos[tab] >= lista.length ? lista.length - 1 : pos[tab]) : -1;
  const doc = idx >= 0 ? lista[idx] : null;
  const ir = (i: number) => setPos((p) => ({ ...p, [tab]: Math.max(0, Math.min(lista.length - 1, i)) }));

  const accion = (d: Certification) =>
    d.estado === "MEDICION_BORRADOR"
      ? { label: "Revisar y pasar a certificado", primary: true }
      : d.estado === "CERTIFICADO_BORRADOR"
        ? { label: "Revisar y aprobar", primary: true }
        : { label: tab === "MEDICION" ? "Abrir medición" : "Abrir certificado", primary: false };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-end gap-1 border-b border-slate-200 px-3 pt-2">
        {(
          [
            ["MEDICION", "Mediciones", <Ruler key="r" className="h-4 w-4" />],
            ["CERTIFICADO", "Certificados", <ClipboardCheck key="c" className="h-4 w-4" />],
          ] as const
        ).map(([v, label, icon]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={cx(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === v ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {icon}
            {label}
            <span className="rounded-full border border-slate-300 px-1.5 text-xs tabular-nums">{listas[v].length}</span>
          </button>
        ))}
      </div>

      {!doc ? (
        <p className="px-5 py-8 text-center text-sm text-slate-600">
          {tab === "MEDICION" ? "Todavía no tiene mediciones." : "Todavía no tiene certificados. Salen de una medición revisada."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Button size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => ir(idx - 1)} disabled={idx <= 0}>
                Anterior
              </Button>
              <select
                className={cx(inputClass, "!w-auto min-w-0 max-w-[460px] flex-1")}
                value={doc.id}
                onChange={(e) => ir(lista.findIndex((d) => d.id === Number(e.target.value)))}
              >
                {lista.map((d) => (
                  <option key={d.id} value={d.id}>
                    {tab === "MEDICION" ? "Medición" : "Certificado"} N° {numero(d)} · {periodLabel(d) || "sin período"} · {CERT_STATUS[d.estado].label}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => ir(idx + 1)} disabled={idx >= lista.length - 1}>
                Siguiente <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
                {idx + 1} de {lista.length}
              </span>
            </div>
            <span className="ml-auto">
              <Button size="sm" variant={accion(doc).primary ? "primary" : "secondary"} onClick={() => onOpen(doc.id)}>
                {accion(doc).label}
              </Button>
            </span>
          </div>
          <h3 className="px-5 pt-4 text-lg font-semibold text-slate-900">
            {tab === "MEDICION" ? "Medición" : "Certificado"} N° {numero(doc)}
          </h3>
          {tab === "MEDICION" ? <VistaMedicion doc={doc} money={money} /> : <VistaDocumento doc={doc} money={money} />}
        </>
      )}
    </section>
  );
}

/** Medición: lo medido en el período, ítem por ítem, con su cómputo (veces × largo × ancho × alto) y fotos. */
function VistaMedicion({ doc, money }: { doc: Certification; money: (v: number) => string }) {
  const items = doc.items ?? [];
  const importe = items.reduce((a, i) => a + n(i.montoTotal), 0);
  const dim = (v: unknown) => (n(v) ? qty(n(v)) : "");
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-5 py-3 text-sm">
        <span>
          <span className="text-slate-600">Período: </span>
          {periodLabel(doc) || "—"}
        </span>
        <span>
          <span className="text-slate-600">Estado: </span>
          {CERT_STATUS[doc.estado].label}
        </span>
        <span>
          <span className="text-slate-600">Ítems medidos: </span>
          {items.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-slate-600">
            <tr className="border-b border-slate-900">
              <th className="px-4 py-2">Ítem / ubicación</th>
              <th className="px-3 py-2 text-right">Veces</th>
              <th className="px-3 py-2 text-right">Largo</th>
              <th className="px-3 py-2 text-right">Ancho</th>
              <th className="px-3 py-2 text-right">Alto</th>
              <th className="px-3 py-2 text-right">Parcial</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, k) => {
              const aux = i.auxiliaryCalculations ?? [];
              const fotos = i.photos ?? [];
              return (
                <React.Fragment key={i.id ?? k}>
                  <tr className="border-t border-slate-200">
                    <td className="px-4 py-2" colSpan={6}>
                      <span className="font-medium tabular-nums">{i.budgetItem?.code}</span> {i.budgetItem?.name}
                      {fotos.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-600">
                          <Camera className="h-3.5 w-3.5" /> {fotos.length} foto{fotos.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">
                      {qty(n(i.cantidadPresente))} {i.budgetItem?.unit}
                    </td>
                  </tr>
                  {aux.length === 0 ? (
                    <tr>
                      <td className="px-4 pb-2 pl-8 text-xs text-slate-500" colSpan={7}>
                        Sin cómputo detallado: cantidad cargada directa.
                      </td>
                    </tr>
                  ) : (
                    aux.map((a, j) => (
                      <tr key={a.id ?? j} className="text-xs text-slate-700">
                        <td className="py-1 pl-8 pr-3">
                          {a.isDeduction ? "− " : ""}
                          {a.location || a.descripcion || "—"}
                          {a.needsReview ? " [?]" : ""}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">{dim(a.factor_repeticion)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{dim(a.largo)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{dim(a.ancho)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{dim(a.alto)}</td>
                        <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">{qty(n(a.subtotal))}</td>
                        <td />
                      </tr>
                    ))
                  )}
                  {fotos.length > 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-3 pl-8">
                        <div className="flex flex-wrap gap-2">
                          {fotos.slice(0, 6).map((f, j) => (
                            <a key={f.id ?? j} href={f.url} target="_blank" rel="noreferrer">
                              <img src={f.url} alt={f.comentario ?? "foto"} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-right text-sm">
        <span className="text-slate-600">Importe estimado a precio de la medición: </span>
        <span className="font-semibold tabular-nums">{money(importe)}</span>
      </p>
    </div>
  );
}

function VistaDocumento({ doc, money }: { doc: Certification; money: (v: number) => string }) {
  const bruto = n(doc.montoTotal);
  const reparo = n(doc.retentionAmount);
  const neto = n(doc.netAmount ?? bruto - reparo);
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-5 py-3 text-sm">
        <span>
          <span className="text-slate-600">Período: </span>
          {periodLabel(doc) || "—"}
        </span>
        <span>
          <span className="text-slate-600">Estado: </span>
          {CERT_STATUS[doc.estado].label}
        </span>
        <span>
          <span className="text-slate-600">Contrato: </span>
          {doc.contract?.number ?? "sin contrato"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-xs text-slate-600">
            <tr className="border-b border-slate-900">
              <th className="px-4 py-2">Ítem</th>
              <th className="px-3 py-2">Ud.</th>
              <th className="px-3 py-2 text-right">Anterior</th>
              <th className="px-3 py-2 text-right">Presente</th>
              <th className="px-3 py-2 text-right">Acumulado</th>
              <th className="px-3 py-2 text-right">P. unit.</th>
              <th className="px-4 py-2 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {(doc.items ?? []).map((i, k) => (
              <tr key={i.id ?? k} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <span className="font-medium tabular-nums">{i.budgetItem?.code}</span> {i.budgetItem?.name}
                </td>
                <td className="px-3 py-2">{i.budgetItem?.unit}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qty(n(i.cantidadAnterior))}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{qty(n(i.cantidadPresente))}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qty(n(i.cantidadAcumulada))}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(n(i.precioUnitario))}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{money(n(i.montoTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid max-w-sm grid-cols-2 gap-y-1 px-5 py-3 text-sm">
        <dt className="text-slate-600">Monto del período</dt>
        <dd className="whitespace-nowrap text-right tabular-nums">{money(bruto)}</dd>
        {reparo > 0 && (
          <>
            <dt className="text-slate-600">Fondo de reparo ({n(doc.retentionPct)} %)</dt>
            <dd className="whitespace-nowrap text-right tabular-nums">− {money(reparo)}</dd>
          </>
        )}
        <dt className="border-t border-slate-900 pt-1 font-semibold">Neto a pagar</dt>
        <dd className="whitespace-nowrap border-t border-slate-900 pt-1 text-right font-semibold tabular-nums">{money(neto)}</dd>
      </dl>
    </div>
  );
}

/** Alta o edición del contratista en la lista maestra de subcontratistas (la misma de Configuración y del calendario). */
function PartnerModal({
  partner,
  onClose,
  onSaved,
  showToast,
}: {
  partner: Partner | null;
  onClose: () => void;
  onSaved: (p: Partner) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const clas = leerClasificacion(partner?.classification);
  const [f, setF] = useState({
    name: partner?.name ?? "",
    taxId: partner?.taxId ?? "",
    rubro: partner ? clas.rubro : "OBRA CIVIL",
    frecuencia: partner ? clas.frecuencia : ("QUINCENAL" as Frecuencia),
    phone: partner?.phone ?? "",
    email: partner?.email ?? "",
    fiscalAddress: partner?.fiscalAddress ?? "",
    tambienProveedor: partner?.kind === "BOTH",
    activo: partner ? partner.active !== false : true,
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (!f.name.trim() || !f.taxId.trim()) return showToast("Nombre y RUC son obligatorios", "error");
    setSaving(true);
    const body = {
      kind: (f.tambienProveedor ? "BOTH" : "SUBCONTRACTOR") as "BOTH" | "SUBCONTRACTOR",
      name: f.name.trim(),
      taxId: f.taxId.trim(),
      classification: armarClasificacion(f.rubro, f.frecuencia),
      phone: f.phone.trim(),
      email: f.email.trim(),
      fiscalAddress: f.fiscalAddress.trim(),
    };
    try {
      const saved = partner ? await api.updatePartner(partner.id, { ...body, active: f.activo }) : await api.createPartner(body);
      onSaved(saved);
    } catch (err: any) {
      showToast(err.message || "No se pudo guardar el contratista", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={partner ? `Editar ${partner.name}` : "Nuevo contratista"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {partner ? "Guardar cambios" : "Agregar a la lista"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Se guarda en la lista de subcontratistas: los cambios se ven también en Configuración y en el calendario de cortes.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre o razón social">
          <input className={inputClass} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="RUC">
          <input className={inputClass} value={f.taxId} onChange={(e) => set({ taxId: e.target.value })} />
        </Field>
        <Field label="Rubro">
          <input className={inputClass} value={f.rubro} onChange={(e) => set({ rubro: e.target.value })} placeholder="OBRA CIVIL, ELECTRICIDAD…" />
        </Field>
        <Field label="Frecuencia de corte">
          <select className={inputClass} value={f.frecuencia} onChange={(e) => set({ frecuencia: e.target.value as Frecuencia })}>
            <option value="SEMANAL">Semanal (viernes)</option>
            <option value="QUINCENAL">Quincenal (15 y 30)</option>
            <option value="MENSUAL">Mensual (fin de mes)</option>
          </select>
        </Field>
        <Field label="Teléfono">
          <input className={inputClass} value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} value={f.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Dirección">
            <input className={inputClass} value={f.fiscalAddress} onChange={(e) => set({ fiscalAddress: e.target.value })} />
          </Field>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.tambienProveedor} onChange={(e) => set({ tambienProveedor: e.target.checked })} />
        También es proveedor de materiales
      </label>
      {partner && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.activo} onChange={(e) => set({ activo: e.target.checked })} />
          Activo (si lo desmarcás queda dado de baja y no se le pueden cargar mediciones nuevas)
        </label>
      )}
    </Modal>
  );
}

function Dato({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-600">{label}:</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="mt-0.5 whitespace-nowrap font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Tabla({ head, rows, right = [] }: { head: string[]; rows: React.ReactNode[][]; right?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-slate-600">
          <tr className="border-b border-slate-900">
            {head.map((h, i) => (
              <th key={h} className={cx("px-4 py-2", right.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, k) => (
            <tr key={k} className="border-b border-slate-100 last:border-0">
              {row.map((c, i) => (
                <td key={i} className={cx("px-4 py-2", right.includes(i) && "whitespace-nowrap text-right tabular-nums")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
