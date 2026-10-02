import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api";
import type {
  AnticipoOtorgado,
  CuentaFinanciera,
  EstadoSolicitudFondo,
  OrigenSolicitudFondo,
  Partner,
  Project,
  SolicitudFondo,
  SolicitudesFondosFiltros,
  SolicitudesFondosPage,
} from "../types";
import { Button, Field, inputClass, Modal, Tabs } from "../ui";
import { formatGs } from "../utils/numbers";
import { fmtDate } from "../compras/status";
import { todayIso } from "../insumos/labels";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

const ESTADOS: { value: EstadoSolicitudFondo; label: string }[] = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "APROBADA", label: "Aprobada" },
  { value: "PROGRAMADA", label: "Programada" },
  { value: "PAGADA_PARCIAL", label: "Pagada en parte" },
  { value: "PAGADA", label: "Pagada" },
  { value: "RECHAZADA", label: "Rechazada" },
  { value: "ANULADA", label: "Anulada" },
];
const ESTADO_LABEL = Object.fromEntries(ESTADOS.map((e) => [e.value, e.label])) as Record<EstadoSolicitudFondo, string>;
const ORIGEN_LABEL: Record<OrigenSolicitudFondo, string> = {
  CERT_SUBCONTRATISTA: "Certificado subcontratista",
  ANTICIPO: "Anticipo",
  FACTURA: "Factura",
};
const PAGABLES: EstadoSolicitudFondo[] = ["APROBADA", "PROGRAMADA", "PAGADA_PARCIAL"];

const th = "px-2 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap";
const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const td = "px-2 py-1.5 whitespace-nowrap";
const linkBtn = "text-slate-900 underline underline-offset-2 hover:text-slate-600";

/** Navegación a otra pestaña del ERP (la escucha App). */
function navegar(tab: string, subTab?: string) {
  window.dispatchEvent(new CustomEvent("infratrack:navigate", { detail: { tab, subTab } }));
}

function documento(s: SolicitudFondo): { label: string; abrir?: () => void } {
  if (s.sourceType === "Certification") return { label: `Cert. #${s.sourceId}${s.invoice ? ` · Fact. ${s.invoice.numeroFactura}` : ""}`, abrir: () => navegar("ejecucion-certificaciones") };
  if (s.sourceType === "SubcontractorCertificate") return { label: `Cert. subcontrato #${s.sourceId}`, abrir: () => navegar("ejecucion-certificaciones") };
  if (s.sourceType === "Invoice") return { label: `Factura ${s.invoice?.numeroFactura ?? `#${s.sourceId}`}`, abrir: () => navegar("contabilidad-finanzas", "facturas") };
  if (s.sourceType === "Anticipo") return { label: `Anticipo #${s.sourceId}` };
  return { label: `${s.sourceType} #${s.sourceId}` };
}

/**
 * Solicitudes de fondos: lo que hay que pagar, generado por los documentos (certificados de
 * subcontratistas aprobados, anticipos otorgados). Aprobar (otra persona que quien la generó),
 * programar y pagar, de a una o en lote. `fixedProject`: pestaña de la obra (sin filtro de obra).
 */
export const SolicitudesFondosPanel: React.FC<{ project: Project; fixedProject?: boolean; showToast: Toast }> = ({ project, fixedProject, showToast }) => {
  const [view, setView] = useState<"solicitudes" | "anticipos">("solicitudes");
  return (
    <div className="space-y-4">
      <Tabs
        value={view}
        onChange={setView}
        items={[
          { value: "solicitudes", label: "Solicitudes" },
          { value: "anticipos", label: "Anticipos otorgados" },
        ]}
      />
      {view === "solicitudes" ? (
        <SolicitudesView project={project} fixedProject={fixedProject} showToast={showToast} />
      ) : (
        <AnticiposView project={project} showToast={showToast} />
      )}
    </div>
  );
};

const SolicitudesView: React.FC<{ project: Project; fixedProject?: boolean; showToast: Toast }> = ({ project, fixedProject, showToast }) => {
  const [soloObra, setSoloObra] = useState(true);
  const [estados, setEstados] = useState<EstadoSolicitudFondo[]>([]);
  const [origen, setOrigen] = useState<OrigenSolicitudFondo | "">("");
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [vencidas, setVencidas] = useState(false);
  const [montoMin, setMontoMin] = useState("");
  const [montoMax, setMontoMax] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [data, setData] = useState<SolicitudesFondosPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const [pagar, setPagar] = useState<SolicitudFondo[] | null>(null);
  const [programar, setProgramar] = useState<SolicitudFondo | null>(null);
  const [rechazar, setRechazar] = useState<SolicitudFondo | null>(null);

  const filtros = useMemo<SolicitudesFondosFiltros>(
    () => ({
      projectId: fixedProject || soloObra ? project.id : undefined,
      estado: estados,
      origen,
      partnerId: partnerId || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
      vencidas: vencidas ? "1" : "",
      montoMin: montoMin ? Number(montoMin) : undefined,
      montoMax: montoMax ? Number(montoMax) : undefined,
    }),
    [fixedProject, soloObra, project.id, estados, origen, partnerId, desde, hasta, vencidas, montoMin, montoMax]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getSolicitudesFondos({ ...filtros, page, pageSize }));
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [filtros, page, showToast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
    setSeleccion(new Set());
  }, [filtros]);
  useEffect(() => {
    api.getPartners().then(setPartners).catch(() => setPartners([]));
  }, []);

  const accion = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      showToast(okMsg, "success");
      setSeleccion(new Set());
      await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const rows = data?.rows ?? [];
  const seleccionadas = rows.filter((r) => seleccion.has(r.id));
  const toggle = (id: number) =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pagarLote = () => {
    if (seleccionadas.length === 0) return;
    if (new Set(seleccionadas.map((s) => s.projectId)).size > 1) {
      showToast("El pago en lote es por obra: elegí solicitudes de una sola obra", "error");
      return;
    }
    setPagar(seleccionadas);
  };

  const exportar = async () => {
    try {
      const all = await api.getSolicitudesFondos({ ...filtros, page: 1, pageSize: 5000 });
      const aoa: (string | number)[][] = [
        ["N°", "Obra", "Proveedor", "RUC", "Origen", "Documento", "Concepto", "Bruto", "Fondo de reparo", "Retenciones", "Anticipo", "Neto", "Pagado", "Saldo", "Vencimiento", "Programada", "Estado", "Generada por", "Aprobada por", "Motivo rechazo"],
        ...all.rows.map((s) => [
          s.numero,
          s.project?.code ?? "",
          s.partner?.name ?? "",
          s.partner?.taxId ?? "",
          ORIGEN_LABEL[s.origen],
          documento(s).label,
          s.concepto,
          s.montoBruto,
          s.descuentoReparo,
          s.descuentoRetenciones,
          s.descuentoAnticipo,
          s.montoNeto,
          s.montoPagado,
          s.saldo,
          fmtDate(s.fechaVencimiento),
          fmtDate(s.fechaProgramada),
          ESTADO_LABEL[s.estado],
          s.creadoPor,
          s.aprobadoPor ?? "",
          s.motivoRechazo ?? "",
        ]),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Solicitudes de fondos");
      XLSX.writeFile(wb, `solicitudes_fondos_${todayIso()}.xlsx`);
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4 text-slate-900">
      {/* Filtros */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {!fixedProject && (
          <Field label="Obra">
            <select className={inputClass} value={soloObra ? "obra" : "todas"} onChange={(e) => setSoloObra(e.target.value === "obra")}>
              <option value="obra">{project.code}</option>
              <option value="todas">Todas las obras</option>
            </select>
          </Field>
        )}
        <Field label="Origen">
          <select className={inputClass} value={origen} onChange={(e) => setOrigen(e.target.value as OrigenSolicitudFondo | "")}>
            <option value="">Todos</option>
            {Object.entries(ORIGEN_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Proveedor">
          <select className={inputClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Todos</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vence desde">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Vence hasta">
          <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Field>
        <Field label="Neto mínimo">
          <input type="number" min={0} className={inputClass} value={montoMin} onChange={(e) => setMontoMin(e.target.value)} />
        </Field>
        <Field label="Neto máximo">
          <input type="number" min={0} className={inputClass} value={montoMax} onChange={(e) => setMontoMax(e.target.value)} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={vencidas} onChange={(e) => setVencidas(e.target.checked)} />
          Solo vencidas
        </label>
      </div>

      {/* Totales por estado (clic = filtrar) */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => {
          const t = data?.totales[e.value];
          const activo = estados.includes(e.value);
          return (
            <button
              key={e.value}
              onClick={() => setEstados((prev) => (activo ? prev.filter((x) => x !== e.value) : [...prev, e.value]))}
              className={`rounded-xl border px-3 py-2 text-left text-xs ${activo ? "border-slate-900" : "border-slate-200"}`}
            >
              <div className="text-slate-500">
                {e.label} · {t?.cantidad ?? 0}
              </div>
              <div className="text-sm font-semibold tabular-nums">{formatGs(e.value === "PAGADA" ? t?.pagado ?? 0 : t?.saldo ?? 0)}</div>
            </button>
          );
        })}
        <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <div className="text-slate-500">Solicitado sin pagar</div>
          <div className="text-sm font-semibold tabular-nums">{formatGs(data?.solicitadoSinPagar ?? 0)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={seleccionadas.length === 0} onClick={pagarLote}>
          Pagar en lote ({seleccionadas.length}) · {formatGs(seleccionadas.reduce((a, s) => a + s.saldo, 0))}
        </Button>
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportar}>
          Exportar Excel
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />} onClick={load}>
          Actualizar
        </Button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200">
            <tr>
              <th className={th}></th>
              <th className={th}>N°</th>
              {!fixedProject && !soloObra && <th className={th}>Obra</th>}
              <th className={th}>Proveedor</th>
              <th className={th}>Documento</th>
              <th className={th}>Concepto</th>
              <th className={`${th} text-right`}>Bruto</th>
              <th className={`${th} text-right`}>Descuentos</th>
              <th className={`${th} text-right`}>Neto</th>
              <th className={`${th} text-right`}>Pagado</th>
              <th className={`${th} text-right`}>Saldo</th>
              <th className={th}>Vence</th>
              <th className={th}>Estado</th>
              <th className={th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-2 py-6 text-center text-slate-500">
                  {loading ? "Cargando…" : "No hay solicitudes con estos filtros."}
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const doc = documento(s);
              const descuentos = s.descuentoReparo + s.descuentoRetenciones + s.descuentoAnticipo;
              const pagable = PAGABLES.includes(s.estado);
              return (
                <tr key={s.id} className="border-b border-slate-100 align-top">
                  <td className={td}>{pagable && <input type="checkbox" checked={seleccion.has(s.id)} onChange={() => toggle(s.id)} />}</td>
                  <td className={td}>{s.numero}</td>
                  {!fixedProject && !soloObra && <td className={td}>{s.project?.code}</td>}
                  <td className={td}>{s.partner?.name}</td>
                  <td className={td}>
                    {doc.abrir ? (
                      <button className={linkBtn} onClick={doc.abrir}>
                        {doc.label}
                      </button>
                    ) : (
                      doc.label
                    )}
                    <div className="text-xs text-slate-500">{ORIGEN_LABEL[s.origen]}</div>
                  </td>
                  <td className="max-w-xs truncate px-2 py-1.5" title={s.concepto}>
                    {s.concepto}
                    {s.motivoRechazo && <div className="text-xs text-red-600">Rechazo: {s.motivoRechazo}</div>}
                  </td>
                  <td className={num}>{formatGs(s.montoBruto)}</td>
                  <td
                    className={num}
                    title={`Fondo de reparo ${formatGs(s.descuentoReparo)} · Retenciones ${formatGs(s.descuentoRetenciones)} · Anticipo ${formatGs(s.descuentoAnticipo)}`}
                  >
                    {descuentos ? `− ${formatGs(descuentos)}` : "—"}
                  </td>
                  <td className={`${num} font-semibold`}>{formatGs(s.montoNeto)}</td>
                  <td className={num}>{formatGs(s.montoPagado)}</td>
                  <td className={num}>{formatGs(s.saldo)}</td>
                  <td className={`${td} ${s.vencida ? "text-red-600 font-medium" : ""}`}>
                    {fmtDate(s.fechaVencimiento)}
                    {s.fechaProgramada && <div className="text-xs text-slate-500">Prog. {fmtDate(s.fechaProgramada)}</div>}
                  </td>
                  <td className={td}>
                    {ESTADO_LABEL[s.estado]}
                    <div className="text-xs text-slate-500">{s.aprobadoPor ? `por ${s.aprobadoPor}` : `generó ${s.creadoPor}`}</div>
                  </td>
                  <td className={`${td} space-x-2`}>
                    {s.estado === "PENDIENTE" && (
                      <button className={linkBtn} onClick={() => accion(() => api.aprobarSolicitudFondo(s.id), `Solicitud N° ${s.numero} aprobada`)}>
                        Aprobar
                      </button>
                    )}
                    {(s.estado === "PENDIENTE" || s.estado === "APROBADA") && (
                      <button className={linkBtn} onClick={() => setRechazar(s)}>
                        Rechazar
                      </button>
                    )}
                    {pagable && (
                      <button className={linkBtn} onClick={() => setProgramar(s)}>
                        Programar
                      </button>
                    )}
                    {pagable && (
                      <button className={linkBtn} onClick={() => setPagar([s])}>
                        Pagar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.total > pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            Página {page} de {totalPages} · {data.total} solicitudes
          </span>
          <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      )}

      {pagar && (
        <PagarModal
          solicitudes={pagar}
          onClose={() => setPagar(null)}
          onDone={async (msg) => {
            setPagar(null);
            showToast(msg, "success");
            setSeleccion(new Set());
            await load();
          }}
          showToast={showToast}
        />
      )}
      {programar && (
        <ProgramarModal
          solicitud={programar}
          onClose={() => setProgramar(null)}
          onSave={(body) => {
            const s = programar;
            setProgramar(null);
            accion(() => api.programarSolicitudFondo(s.id, body), `Solicitud N° ${s.numero} programada`);
          }}
        />
      )}
      {rechazar && (
        <RechazarModal
          solicitud={rechazar}
          onClose={() => setRechazar(null)}
          onSave={(motivo) => {
            const s = rechazar;
            setRechazar(null);
            accion(() => api.rechazarSolicitudFondo(s.id, motivo), `Solicitud N° ${s.numero} rechazada`);
          }}
        />
      )}
    </div>
  );
};

function useCuentas(projectId: number) {
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  useEffect(() => {
    api.getCuentasFinancieras(projectId).then((c) => setCuentas(c.filter((x) => x.active !== false))).catch(() => setCuentas([]));
  }, [projectId]);
  return cuentas;
}

const PagarModal: React.FC<{
  solicitudes: SolicitudFondo[];
  onClose: () => void;
  onDone: (msg: string) => void;
  showToast: Toast;
}> = ({ solicitudes, onClose, onDone, showToast }) => {
  const unica = solicitudes.length === 1 ? solicitudes[0] : null;
  const cuentas = useCuentas(solicitudes[0].projectId);
  const [cuentaId, setCuentaId] = useState<number | "">(unica?.cuentaFinancieraId ?? "");
  const [monto, setMonto] = useState(unica ? String(unica.saldo) : "");
  const [fecha, setFecha] = useState(todayIso());
  const [metodo, setMetodo] = useState<"TRANSFERENCIA" | "EFECTIVO">("TRANSFERENCIA");
  const [referencia, setReferencia] = useState("");
  const [saving, setSaving] = useState(false);
  const total = solicitudes.reduce((a, s) => a + s.saldo, 0);

  useEffect(() => {
    if (!cuentaId && cuentas.length === 1) setCuentaId(cuentas[0].id);
  }, [cuentas, cuentaId]);

  const guardar = async () => {
    if (!cuentaId) return showToast("Elegí la cuenta", "error");
    if (!referencia.trim()) return showToast("La referencia es obligatoria", "error");
    setSaving(true);
    try {
      const base = { cuentaFinancieraId: Number(cuentaId), fecha, metodo, referencia: referencia.trim() };
      if (unica) {
        await api.pagarSolicitudFondo(unica.id, { ...base, monto: Number(monto) });
        onDone(`Pago registrado: solicitud N° ${unica.numero}`);
      } else {
        const r = await api.pagarSolicitudesLote({ ...base, items: solicitudes.map((s) => ({ solicitudId: s.id })) });
        onDone(`Pago en lote: ${r.cantidad} solicitudes por ${formatGs(r.total)}`);
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={unica ? `Pagar solicitud N° ${unica.numero}` : `Pagar ${solicitudes.length} solicitudes`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={guardar}>
            {saving ? "Guardando…" : "Registrar pago"}
          </Button>
        </>
      }
    >
      {unica ? (
        <p className="text-sm">
          {unica.partner?.name} · Neto {formatGs(unica.montoNeto)} · Pagado {formatGs(unica.montoPagado)} · Saldo {formatGs(unica.saldo)}
          {unica.invoice ? ` · Factura ${unica.invoice.numeroFactura}` : " · Sin factura (solo egreso de la cuenta)"}
        </p>
      ) : (
        <p className="text-sm">
          Se paga el saldo completo de cada solicitud. Total {formatGs(total)}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cuenta">
          <select className={inputClass} value={cuentaId} onChange={(e) => setCuentaId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Elegir…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        {unica && (
          <Field label="Monto" hint="Puede ser parcial">
            <input type="number" min={1} max={unica.saldo} className={inputClass} value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
        )}
        <Field label="Fecha">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Método">
          <select className={inputClass} value={metodo} onChange={(e) => setMetodo(e.target.value as "TRANSFERENCIA" | "EFECTIVO")}>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="EFECTIVO">Efectivo</option>
          </select>
        </Field>
        <Field label="Referencia / N° de recibo" className="col-span-2">
          <input className={inputClass} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
};

const ProgramarModal: React.FC<{
  solicitud: SolicitudFondo;
  onClose: () => void;
  onSave: (body: { fechaProgramada: string; cuentaFinancieraId?: number | null }) => void;
}> = ({ solicitud, onClose, onSave }) => {
  const cuentas = useCuentas(solicitud.projectId);
  const [fecha, setFecha] = useState(solicitud.fechaProgramada ?? solicitud.fechaVencimiento);
  const [cuentaId, setCuentaId] = useState<number | "">(solicitud.cuentaFinancieraId ?? "");
  return (
    <Modal
      title={`Programar solicitud N° ${solicitud.numero}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!fecha} onClick={() => onSave({ fechaProgramada: fecha, cuentaFinancieraId: cuentaId || null })}>
            Programar
          </Button>
        </>
      }
    >
      <Field label="Fecha de pago">
        <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>
      <Field label="Cuenta (opcional)">
        <select className={inputClass} value={cuentaId} onChange={(e) => setCuentaId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Sin definir</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
};

const RechazarModal: React.FC<{ solicitud: SolicitudFondo; onClose: () => void; onSave: (motivo: string) => void }> = ({ solicitud, onClose, onSave }) => {
  const [motivo, setMotivo] = useState("");
  return (
    <Modal
      title={`Rechazar solicitud N° ${solicitud.numero}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={!motivo.trim()} onClick={() => onSave(motivo.trim())}>
            Rechazar
          </Button>
        </>
      }
    >
      <Field label="Motivo">
        <textarea className={inputClass} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
    </Modal>
  );
};

/** Pantalla mínima de anticipos otorgados: alta (genera su solicitud de fondos) y anulación. */
const AnticiposView: React.FC<{ project: Project; showToast: Toast }> = ({ project, showToast }) => {
  const [rows, setRows] = useState<AnticipoOtorgado[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [concepto, setConcepto] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.getAnticiposOtorgados(project.id));
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  }, [project.id, showToast]);

  useEffect(() => {
    load();
    api.getPartners().then(setPartners).catch(() => setPartners([]));
  }, [load]);

  const crear = async () => {
    if (!partnerId || !(Number(monto) > 0)) return showToast("Elegí el proveedor y el monto", "error");
    setSaving(true);
    try {
      await api.createAnticipoOtorgado({ projectId: project.id, partnerId: Number(partnerId), monto: Number(monto), fecha, concepto: concepto.trim() || undefined });
      showToast("Anticipo registrado; se generó su solicitud de fondos", "success");
      setMonto("");
      setConcepto("");
      await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const anular = async (a: AnticipoOtorgado) => {
    if (!window.confirm(`¿Anular el anticipo de ${formatGs(a.monto)} a ${a.partner?.name ?? ""}?`)) return;
    try {
      await api.anularAnticipo(a.id);
      showToast("Anticipo anulado", "success");
      await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  return (
    <div className="space-y-4 text-slate-900">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Field label="Obra">
          <input className={inputClass} value={`${project.code} · ${project.name}`} disabled />
        </Field>
        <Field label="Proveedor / subcontratista">
          <select className={inputClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Elegir…</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monto (Gs)">
          <input type="number" min={1} className={inputClass} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Field>
        <Field label="Fecha">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Concepto">
          <input className={inputClass} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </Field>
      </div>
      <Button variant="primary" size="sm" disabled={saving} onClick={crear}>
        Registrar anticipo
      </Button>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200">
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Proveedor</th>
              <th className={th}>Concepto</th>
              <th className={`${th} text-right`}>Monto</th>
              <th className={`${th} text-right`}>Aplicado</th>
              <th className={`${th} text-right`}>Saldo</th>
              <th className={th}>Solicitud de fondos</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                  Sin anticipos otorgados.
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className={td}>{fmtDate(a.fecha)}</td>
                <td className={td}>{a.partner?.name}</td>
                <td className={td}>{a.concepto ?? "—"}</td>
                <td className={num}>{formatGs(a.monto)}</td>
                <td className={num}>{formatGs(a.saldoAplicado)}</td>
                <td className={num}>{formatGs(a.saldoPendiente)}</td>
                <td className={td}>{a.solicitud ? `N° ${a.solicitud.numero} · ${ESTADO_LABEL[a.solicitud.estado]}` : "—"}</td>
                <td className={td}>
                  {a.anuladoAt ? (
                    "Anulado"
                  ) : (
                    <button className={linkBtn} onClick={() => anular(a)}>
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
