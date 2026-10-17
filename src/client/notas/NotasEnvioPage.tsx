import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { api } from "../api";
import type { AppId } from "../apps";
import type {
  NotaEnvio,
  NotaEnvioContenido,
  NotaEnvioInput,
  NotaEnvioLineaTipo,
  NotaEnvioLugar,
  Project,
  User,
} from "../types";
import { Button, Card, EmptyState, Field, inputClass, Modal, Page, PageHeader, StatusPill, Tabs, type PillTone } from "../ui";
import { ActionBar } from "../ui/actions";
import { localIso } from "../../core/domain/localDate";
import { fmtDate, fmtQty } from "../compras/status";

export type NotaIntent = { nonce: number } | null;

interface Props {
  app: AppId;
  project: Project;
  projects: Project[];
  currentUser?: User | null;
  intent?: NotaIntent;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const ESTADO: Record<NotaEnvio["estado"], { label: string; tone: PillTone }> = {
  ENVIADA: { label: "Enviada", tone: "warn" },
  RECIBIDA: { label: "Recibida", tone: "good" },
  ANULADA: { label: "Anulada", tone: "bad" },
};

const LUGAR: Record<NotaEnvioLugar, string> = { OFICINA: "Oficina", OBRA: "Obra", TALLER: "Taller" };

const lugarDe = (n: NotaEnvio, lado: "origen" | "destino") => {
  const tipo = lado === "origen" ? n.origenTipo : n.destinoTipo;
  const obra = lado === "origen" ? n.origenProject : n.destinoProject;
  return tipo === "OBRA" && obra ? `${obra.code} · ${obra.name}` : LUGAR[tipo];
};

type Vista = "por-recibir" | "emitidas" | "todas";

/**
 * Notas de envío: documentos o materiales que viajan entre oficina (ERP), obra (ECMS) y taller.
 * Solo documentan: no mueven stock. El número es el correlativo único de la empresa (N/AAAA);
 * la recibe el sistema de destino y la anula quien la emitió.
 */
export function NotasEnvioPage({ app, project, projects, currentUser, intent, showToast }: Props) {
  const [vista, setVista] = useState<Vista>("por-recibir");
  const [notas, setNotas] = useState<NotaEnvio[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(false);
  const [detalle, setDetalle] = useState<NotaEnvio | null>(null);

  const load = useCallback(async () => {
    try {
      setNotas(await api.getNotasEnvio({ sistema: app, vista: "todas", projectId: app === "ECMS" ? project.id : undefined }));
    } catch (err: any) {
      showToast(err.message || "No se pudieron cargar las notas de envío", "error");
    }
  }, [app, project.id, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (intent) setForm(true);
  }, [intent?.nonce]);

  const porRecibir = useMemo(() => notas.filter((n) => n.recibeSistema === app && n.estado === "ENVIADA"), [notas, app]);
  const emitidas = useMemo(() => notas.filter((n) => n.sistemaOrigen === app), [notas, app]);
  const lista = useMemo(() => {
    const base = vista === "por-recibir" ? porRecibir : vista === "emitidas" ? emitidas : notas;
    const q = search.trim().toLowerCase();
    return base.filter((n) => !q || `${n.etiqueta} ${lugarDe(n, "origen")} ${lugarDe(n, "destino")} ${n.chofer ?? ""} ${n.lineas.map((l) => l.descripcion).join(" ")}`.toLowerCase().includes(q));
  }, [vista, porRecibir, emitidas, notas, search]);

  const nueva = (
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm(true)}>
      Nueva nota
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="Notas de envío"
        help="Documentos o materiales que viajan entre la oficina, la obra y el taller. Solo documentan: no mueven stock. Las recibe el lugar de destino."
      />
      <Tabs
        value={vista}
        onChange={setVista}
        items={[
          { value: "por-recibir", label: "Por recibir", count: porRecibir.length },
          { value: "emitidas", label: "Emitidas", count: emitidas.length },
          { value: "todas", label: "Todas", count: notas.length },
        ]}
      />
      <ActionBar search={search} onSearch={setSearch} primary={nueva} />

      {lista.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-10 w-10" />}
          title={vista === "por-recibir" ? "No hay notas por recibir" : "Todavía no hay notas"}
          help="Una nota lleva documentos (pedidos, órdenes de compra, solicitudes de fondos, facturas, certificados) o materiales de un lugar a otro."
          action={nueva}
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">N°</th>
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3">Origen</th>
                  <th className="px-3 py-3">Destino</th>
                  <th className="px-3 py-3">Contenido</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {lista.map((n) => (
                  <tr key={n.id} onClick={() => setDetalle(n)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{n.etiqueta}</td>
                    <td className="px-3 py-3 text-slate-600">{fmtDate(n.fecha)}</td>
                    <td className="px-3 py-3">{lugarDe(n, "origen")}</td>
                    <td className="px-3 py-3">{lugarDe(n, "destino")}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {n.contenido === "DOCUMENTOS" ? "Documentos" : "Materiales"} · {n.lineas.length}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={ESTADO[n.estado].tone}>{ESTADO[n.estado].label}</StatusPill>
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {n.recibeSistema === app && n.estado === "ENVIADA" && (
                        <Button size="sm" variant="primary" onClick={() => setDetalle(n)}>
                          Recibir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form && (
        <NotaForm
          app={app}
          project={project}
          projects={projects}
          onClose={() => setForm(false)}
          onSaved={(n) => {
            setForm(false);
            showToast(`Nota de envío N° ${n.etiqueta} emitida`);
            load();
          }}
          showToast={showToast}
        />
      )}
      {detalle && (
        <NotaDetalle
          app={app}
          nota={detalle}
          currentUser={currentUser}
          onClose={() => setDetalle(null)}
          onChanged={() => {
            setDetalle(null);
            load();
          }}
          showToast={showToast}
        />
      )}
    </Page>
  );
}

// ─── Detalle: recibir y anular ────────────────────────────────────────────────

function NotaDetalle({
  app,
  nota,
  currentUser,
  onClose,
  onChanged,
  showToast,
}: {
  app: AppId;
  nota: NotaEnvio;
  currentUser?: User | null;
  onClose: () => void;
  onChanged: () => void;
  showToast: Props["showToast"];
}) {
  const [accion, setAccion] = useState<"recibir" | "anular" | null>(null);
  const [recibidoPor, setRecibidoPor] = useState(currentUser?.fullName ?? "");
  const [fecha, setFecha] = useState(localIso());
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  const puedeRecibir = nota.estado === "ENVIADA" && nota.recibeSistema === app;
  const puedeAnular = nota.estado === "ENVIADA" && nota.sistemaOrigen === app;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(ok);
      onChanged();
    } catch (err: any) {
      showToast(err.message || "No se pudo completar", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Nota de envío N° ${nota.etiqueta}`}
      size="lg"
      onClose={onClose}
      footer={
        accion === null ? (
          <>
            {puedeAnular && (
              <Button onClick={() => setAccion("anular")} className="mr-auto">
                Anular
              </Button>
            )}
            <Button onClick={onClose}>Cerrar</Button>
            {puedeRecibir && (
              <Button variant="primary" onClick={() => setAccion("recibir")}>
                Recibir
              </Button>
            )}
          </>
        ) : accion === "recibir" ? (
          <>
            <Button onClick={() => setAccion(null)}>Volver</Button>
            <Button
              variant="primary"
              disabled={busy || !recibidoPor.trim()}
              onClick={() => run(() => api.recibirNotaEnvio(nota.id, { sistema: app, recibidoPor: recibidoPor.trim(), fecha }), `Nota N° ${nota.etiqueta} recibida`)}
            >
              Confirmar recepción
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setAccion(null)}>Volver</Button>
            <Button
              variant="danger"
              disabled={busy || !motivo.trim()}
              onClick={() => run(() => api.anularNotaEnvio(nota.id, { sistema: app, motivo: motivo.trim() }), `Nota N° ${nota.etiqueta} anulada`)}
            >
              Anular nota
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <StatusPill tone={ESTADO[nota.estado].tone}>{ESTADO[nota.estado].label}</StatusPill>
        <span>{fmtDate(nota.fecha)}</span>
        <span>
          · {lugarDe(nota, "origen")} → {lugarDe(nota, "destino")}
        </span>
        <span>· emitida por {nota.sistemaOrigen}</span>
      </div>
      {nota.chofer && <p className="text-sm text-slate-600">Chofer: {nota.chofer}</p>}
      {nota.observaciones && <p className="text-sm text-slate-600">{nota.observaciones}</p>}
      {nota.estado === "RECIBIDA" && (
        <p className="text-sm text-slate-600">
          Recibida el {fmtDate(nota.recibidoFecha)} por {nota.recibidoPor}.
        </p>
      )}
      {nota.estado === "ANULADA" && <p className="text-sm text-red-600">Anulada: {nota.anuladoMotivo}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="py-2">#</th>
            <th className="py-2">Detalle</th>
            <th className="py-2 text-right">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {nota.lineas.map((l) => (
            <tr key={l.id} className="border-b border-slate-100 last:border-0">
              <td className="py-2 text-slate-400">{l.position}</td>
              <td className="py-2">{l.descripcion}</td>
              <td className="py-2 text-right tabular-nums">{l.cantidad != null ? `${fmtQty(l.cantidad)} ${l.unidad ?? ""}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {accion === "recibir" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Recibió">
            <input className={inputClass} value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} />
          </Field>
          <Field label="Fecha de recepción">
            <input type="date" className={inputClass} value={fecha} min={nota.fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>
      )}
      {accion === "anular" && (
        <Field label="Motivo de la anulación" hint="Los documentos de la nota quedan libres para ir en otra.">
          <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

// ─── Alta ─────────────────────────────────────────────────────────────────────

type TipoDoc = "PEDIDO" | "OC" | "SF" | "CERTIFICADO" | "FACTURA";
const TIPO_DOC_LABEL: Record<TipoDoc | "REMITO" | "MANUAL", string> = {
  PEDIDO: "Pedido de materiales",
  OC: "Orden de compra",
  SF: "Solicitud de fondos",
  CERTIFICADO: "Certificado",
  FACTURA: "Factura",
  REMITO: "Remito / factura de papel",
  MANUAL: "Otro documento",
};
const REF_FIELD = { PEDIDO: "materialRequestId", OC: "purchaseOrderId", SF: "solicitudFondoId", CERTIFICADO: "certificationId", FACTURA: "invoiceId" } as const;

interface LineaForm {
  key: number;
  kind: NotaEnvioLineaTipo;
  refId: number | null;
  descripcion: string;
  cantidad: string;
  unidad: string;
}

function NotaForm({
  app,
  project,
  projects,
  onClose,
  onSaved,
  showToast,
}: {
  app: AppId;
  project: Project;
  projects: Project[];
  onClose: () => void;
  onSaved: (n: NotaEnvio) => void;
  showToast: Props["showToast"];
}) {
  const origenTipo: NotaEnvioLugar = app === "ERP" ? "OFICINA" : "OBRA";
  // El ECMS manda a la oficina, al taller o a otra obra; el ERP, a una obra o al taller
  const destinos: NotaEnvioLugar[] = app === "ERP" ? ["OBRA", "TALLER"] : ["OFICINA", "OBRA", "TALLER"];
  const [fecha, setFecha] = useState(localIso());
  const [destinoTipo, setDestinoTipo] = useState<NotaEnvioLugar>(destinos[0]);
  const [destinoProjectId, setDestinoProjectId] = useState<number | null>(app === "ERP" ? project.id : null);
  const [contenido, setContenido] = useState<NotaEnvioContenido>("DOCUMENTOS");
  const [chofer, setChofer] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<Partial<Record<TipoDoc, { id: number; label: string }[]>>>({});

  const otrasObras = projects.filter((p) => app === "ERP" || p.id !== project.id);
  const nuevaLinea = (c: NotaEnvioContenido): LineaForm => ({ key: Date.now() + Math.random(), kind: c === "DOCUMENTOS" ? "PEDIDO" : "MATERIAL", refId: null, descripcion: "", cantidad: "", unidad: "" });

  useEffect(() => setLineas([nuevaLinea(contenido)]), [contenido]);

  const cargarDocs = useCallback(
    async (kind: TipoDoc) => {
      if (docs[kind]) return;
      try {
        const list = await api.getNotaEnvioDocumentos(kind, project.id);
        setDocs((d) => ({ ...d, [kind]: list }));
      } catch (err: any) {
        showToast(err.message || "No se pudieron cargar los documentos", "error");
      }
    },
    [docs, project.id, showToast]
  );

  const setLinea = (key: number, patch: Partial<LineaForm>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const valida =
    fecha &&
    (destinoTipo !== "OBRA" || destinoProjectId) &&
    lineas.length > 0 &&
    lineas.every((l) =>
      contenido === "MATERIALES"
        ? l.descripcion.trim() && Number(l.cantidad) > 0
        : l.kind === "REMITO" || l.kind === "MANUAL"
        ? l.descripcion.trim()
        : l.refId
    );

  const guardar = async () => {
    const body: NotaEnvioInput = {
      sistema: app,
      fecha,
      origenTipo,
      origenProjectId: origenTipo === "OBRA" ? project.id : null,
      destinoTipo,
      destinoProjectId: destinoTipo === "OBRA" ? destinoProjectId : null,
      contenido,
      chofer: chofer.trim() || null,
      observaciones: observaciones.trim() || null,
      lineas: lineas.map((l) => {
        if (contenido === "MATERIALES") return { kind: "MATERIAL" as const, descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad), unidad: l.unidad.trim() || null };
        if (l.kind === "REMITO" || l.kind === "MANUAL") return { kind: l.kind, descripcion: l.descripcion.trim() };
        const ref = REF_FIELD[l.kind as TipoDoc];
        return { kind: l.kind, [ref]: l.refId };
      }),
    };
    setBusy(true);
    try {
      onSaved(await api.createNotaEnvio(body));
    } catch (err: any) {
      showToast(err.message || "No se pudo emitir la nota", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nueva nota de envío"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valida || busy} onClick={guardar}>
            Emitir nota
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Sale de">
          <input className={inputClass} disabled value={origenTipo === "OBRA" ? `${project.code} · ${project.name}` : "Oficina central"} />
        </Field>
        <Field label="Va a">
          <select
            className={inputClass}
            value={destinoTipo}
            onChange={(e) => {
              const v = e.target.value as NotaEnvioLugar;
              setDestinoTipo(v);
              setDestinoProjectId(v === "OBRA" ? (app === "ERP" ? project.id : null) : null);
            }}
          >
            {destinos.map((d) => (
              <option key={d} value={d}>
                {d === "OBRA" && app === "ECMS" ? "Otra obra" : LUGAR[d]}
              </option>
            ))}
          </select>
        </Field>
        {destinoTipo === "OBRA" && (
          <Field label="Obra de destino" className="sm:col-span-3">
            <select className={inputClass} value={destinoProjectId ?? ""} onChange={(e) => setDestinoProjectId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Elegí la obra…</option>
              {otrasObras.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Lleva">
          <select className={inputClass} value={contenido} onChange={(e) => setContenido(e.target.value as NotaEnvioContenido)}>
            <option value="DOCUMENTOS">Documentos</option>
            <option value="MATERIALES">Materiales</option>
          </select>
        </Field>
        <Field label="Chofer / portador">
          <input className={inputClass} value={chofer} onChange={(e) => setChofer(e.target.value)} />
        </Field>
        <Field label="Observaciones">
          <input className={inputClass} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        {lineas.map((l) => (
          <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
            {contenido === "DOCUMENTOS" ? (
              <>
                <Field label="Documento">
                  <select
                    className={inputClass}
                    value={l.kind}
                    onChange={(e) => {
                      const kind = e.target.value as NotaEnvioLineaTipo;
                      setLinea(l.key, { kind, refId: null, descripcion: "" });
                      if (kind in REF_FIELD) cargarDocs(kind as TipoDoc);
                    }}
                    onFocus={() => l.kind in REF_FIELD && cargarDocs(l.kind as TipoDoc)}
                  >
                    {(Object.keys(TIPO_DOC_LABEL) as (keyof typeof TIPO_DOC_LABEL)[]).map((k) => (
                      <option key={k} value={k}>
                        {TIPO_DOC_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                {l.kind === "REMITO" || l.kind === "MANUAL" ? (
                  <Field label="Detalle">
                    <input className={inputClass} placeholder="Número y proveedor / descripción" value={l.descripcion} onChange={(e) => setLinea(l.key, { descripcion: e.target.value })} />
                  </Field>
                ) : (
                  <Field label="Elegí el documento">
                    <select className={inputClass} value={l.refId ?? ""} onFocus={() => cargarDocs(l.kind as TipoDoc)} onChange={(e) => setLinea(l.key, { refId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">{docs[l.kind as TipoDoc] ? "Elegí…" : "Cargando…"}</option>
                      {(docs[l.kind as TipoDoc] ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            ) : (
              <>
                <Field label="Cantidad y unidad">
                  <div className="flex gap-2">
                    <input type="number" min={0} step="any" className={inputClass} placeholder="Cant." value={l.cantidad} onChange={(e) => setLinea(l.key, { cantidad: e.target.value })} />
                    <input className={inputClass} placeholder="Unidad" value={l.unidad} onChange={(e) => setLinea(l.key, { unidad: e.target.value })} />
                  </div>
                </Field>
                <Field label="Material">
                  <input className={inputClass} value={l.descripcion} onChange={(e) => setLinea(l.key, { descripcion: e.target.value })} />
                </Field>
              </>
            )}
            <button
              type="button"
              className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
              disabled={lineas.length === 1}
              onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}
              title="Quitar renglón"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLineas((ls) => [...ls, nuevaLinea(contenido)])}>
          Agregar renglón
        </Button>
      </div>
    </Modal>
  );
}
