import React, { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import { api } from "../api";
import type { Partner, Requisicion, RequisicionEstado } from "../types";
import { Button, Card, EmptyState, Field, inputClass, Modal, StatusPill, type PillTone } from "../ui";
import { ActionBar } from "../ui/actions";
import { formatMoney } from "../utils/format";
import { todayIso } from "../insumos/labels";
import { fmtDate, fmtQty } from "./status";

const ESTADO: Record<RequisicionEstado, { label: string; tone: PillTone }> = {
  RECIBIDA: { label: "Por comprar", tone: "info" },
  COMPRADA_PARCIAL: { label: "Compra parcial", tone: "warn" },
  EN_COMPRA: { label: "En compra", tone: "violet" },
  COMPRADA: { label: "Comprada", tone: "good" },
  RECHAZADA: { label: "Rechazada", tone: "bad" },
  ANULADA: { label: "Anulada", tone: "bad" },
};

type Filtro = "PENDIENTES" | "TODOS";
type Origen = "TODOS" | "ECMS" | "TALLER";

const destinoDe = (r: Requisicion) =>
  r.sistemaOrigen === "TALLER"
    ? [r.project ? `${r.project.code} · ${r.project.name}` : r.obraTexto, r.maquinaTexto].filter(Boolean).join(" — ") || "Taller"
    : r.project
    ? `${r.project.code} · ${r.project.name}`
    : "—";

interface Props {
  requisiciones: Requisicion[];
  partners: Partner[];
  currency: "PYG" | "USD";
  /** Pedido de obra: se compra con el formulario de OC de siempre (imputa a los ítems del presupuesto). */
  onComprarPedidoDeObra: (materialRequestId: number) => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

/**
 * Bandeja de pedidos del ERP: los pedidos de obra (ECMS) y del Taller llegan acá para comprarse.
 * Un pedido de obra se convierte en OC con imputación a su ítem; uno del Taller, en una OC sin
 * obra (el repuesto va en texto libre y su costo no entra al libro de ninguna obra todavía).
 */
export function BandejaView({ requisiciones, partners, currency, onComprarPedidoDeObra, onRefresh, showToast }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("PENDIENTES");
  const [origen, setOrigen] = useState<Origen>("TODOS");
  const [search, setSearch] = useState("");
  const [detalle, setDetalle] = useState<Requisicion | null>(null);
  const [comprando, setComprando] = useState<Requisicion | null>(null);
  const [rechazando, setRechazando] = useState<Requisicion | null>(null);

  const pendientes = (r: Requisicion) => r.estado === "RECIBIDA" || r.estado === "COMPRADA_PARCIAL";
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requisiciones.filter(
      (r) =>
        (filtro === "TODOS" || pendientes(r)) &&
        (origen === "TODOS" || r.sistemaOrigen === origen) &&
        (!q || `${r.numeroOrigen} ${destinoDe(r)} ${r.lineas.map((l) => `${l.descripcion} ${l.nroParte ?? ""}`).join(" ")}`.toLowerCase().includes(q))
    );
  }, [requisiciones, filtro, origen, search]);

  const comprar = (r: Requisicion) => {
    setDetalle(null);
    if (r.sistemaOrigen === "ECMS" && r.materialRequestId) onComprarPedidoDeObra(r.materialRequestId);
    else setComprando(r);
  };

  const puedeComprar = (r: Requisicion) => pendientes(r) && r.lineas.some((l) => l.pendiente > 0);

  return (
    <div className="space-y-4">
      <ActionBar
        chips={[
          { value: "PENDIENTES", label: "Por comprar", count: requisiciones.filter(pendientes).length },
          { value: "TODOS", label: "Todos", count: requisiciones.length },
        ]}
        chip={filtro}
        onChip={setFiltro}
        search={search}
        onSearch={setSearch}
        secondary={[
          { label: "Todos los orígenes", onClick: () => setOrigen("TODOS") },
          { label: "Solo pedidos de obra", onClick: () => setOrigen("ECMS") },
          { label: "Solo pedidos del Taller", onClick: () => setOrigen("TALLER") },
        ]}
      />

      {visibles.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title={filtro === "PENDIENTES" ? "No hay pedidos por comprar" : "La bandeja está vacía"}
          help="Los pedidos de materiales de las obras aprobados en el ECMS y los del Taller llegan acá."
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-3">Pedido</th>
                  <th className="px-3 py-3">Origen</th>
                  <th className="px-3 py-3">Obra / máquina</th>
                  <th className="px-3 py-3 text-right">Renglones</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={r.id} onClick={() => setDetalle(r)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{r.numeroOrigen}</p>
                      <p className="text-xs text-slate-500">{fmtDate(r.fecha)}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.sistemaOrigen === "TALLER" ? "Taller" : "Obra"}
                      {r.compraCentral && <span className="ml-1 text-xs text-slate-400">· compra central</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{destinoDe(r)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.lineas.length}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={ESTADO[r.estado].tone}>{ESTADO[r.estado].label}</StatusPill>
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {puedeComprar(r) && (
                        <Button size="sm" variant="primary" onClick={() => comprar(r)}>
                          Crear OC
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

      {detalle && (
        <Modal
          title={`Pedido ${detalle.numeroOrigen} · ${detalle.sistemaOrigen === "TALLER" ? "Taller" : "Obra"}`}
          size="lg"
          onClose={() => setDetalle(null)}
          footer={
            <>
              {detalle.sistemaOrigen === "TALLER" && pendientes(detalle) && detalle.purchaseOrders.every((o) => o.status === "ANULADO") && (
                <Button className="mr-auto" onClick={() => { setRechazando(detalle); setDetalle(null); }}>
                  Rechazar
                </Button>
              )}
              <Button onClick={() => setDetalle(null)}>Cerrar</Button>
              {puedeComprar(detalle) && (
                <Button variant="primary" onClick={() => comprar(detalle)}>
                  Crear OC
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusPill tone={ESTADO[detalle.estado].tone}>{ESTADO[detalle.estado].label}</StatusPill>
            <span>{fmtDate(detalle.fecha)}</span>
            <span>· {destinoDe(detalle)}</span>
            {detalle.purchaseOrders.length > 0 && <span>· OC: {detalle.purchaseOrders.map((o) => o.number).join(", ")}</span>}
          </div>
          {detalle.observaciones && <p className="text-sm text-slate-600">{detalle.observaciones}</p>}
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-2">Detalle</th>
                <th className="py-2 text-right">Pedido</th>
                <th className="py-2 text-right">En OC</th>
                <th className="py-2 text-right">Recibido</th>
              </tr>
            </thead>
            <tbody>
              {detalle.lineas.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">
                    <p>{l.descripcion}</p>
                    {(l.nroParte || l.maquinaCodigo) && (
                      <p className="text-xs text-slate-500">{[l.nroParte && `Parte ${l.nroParte}`, l.maquinaCodigo].filter(Boolean).join(" · ")}</p>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtQty(l.cantidad)} {l.unidad ?? ""}</td>
                  <td className="py-2 text-right tabular-nums">{fmtQty(l.pedida)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtQty(l.recibida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {comprando && (
        <TallerOrderForm
          requisicion={comprando}
          partners={partners}
          currency={currency}
          onClose={() => setComprando(null)}
          onSaved={(numero) => {
            setComprando(null);
            showToast(`OC ${numero} creada. El Taller ya sabe que el ERP compra este pedido.`);
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {rechazando && (
        <RechazoModal
          requisicion={rechazando}
          onClose={() => setRechazando(null)}
          onDone={() => {
            setRechazando(null);
            showToast("Pedido rechazado; el Taller fue avisado");
            onRefresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── OC de un pedido del Taller ──────────────────────────────────────────────

function TallerOrderForm({
  requisicion,
  partners,
  currency,
  onClose,
  onSaved,
  showToast,
}: {
  requisicion: Requisicion;
  partners: Partner[];
  currency: "PYG" | "USD";
  onClose: () => void;
  onSaved: (numero: string) => void;
  showToast: Props["showToast"];
}) {
  const proveedores = partners.filter((p) => p.kind !== "SUBCONTRACTOR" && p.active !== false);
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [fecha, setFecha] = useState(todayIso());
  const [filas, setFilas] = useState(() =>
    requisicion.lineas
      .filter((l) => l.pendiente > 0)
      .map((l) => ({ id: l.id, descripcion: l.descripcion, nroParte: l.nroParte, unidad: l.unidad, pendiente: l.pendiente, incluir: true, cantidad: String(l.pendiente), precio: "" }))
  );
  const [busy, setBusy] = useState(false);

  const elegidas = filas.filter((f) => f.incluir);
  const total = elegidas.reduce((a, f) => a + Number(f.cantidad || 0) * Number(f.precio || 0), 0);
  const valida =
    partnerId !== "" &&
    elegidas.length > 0 &&
    elegidas.every((f) => Number(f.cantidad) > 0 && Number(f.cantidad) <= f.pendiente && f.precio !== "" && Number(f.precio) >= 0);

  const guardar = async () => {
    setBusy(true);
    try {
      const oc = await api.createPurchaseOrderDesdeRequisicion({
        requisicionId: requisicion.id,
        partnerId: Number(partnerId),
        fecha,
        details: elegidas.map((f) => ({ requisicionLineaId: f.id, quantity: Number(f.cantidad), unitPrice: Number(f.precio) })),
      });
      onSaved(oc.number);
    } catch (err: any) {
      showToast(err.message || "No se pudo crear la OC", "error");
    } finally {
      setBusy(false);
    }
  };

  const setFila = (id: number, patch: Partial<(typeof filas)[number]>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <Modal
      title={`Crear OC · pedido del Taller ${requisicion.numeroOrigen}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-600">Total {formatMoney(total, currency)}</span>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valida || busy} onClick={guardar}>
            Crear OC
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {destinoDe(requisicion)}. La OC no imputa costo a ninguna obra: el repuesto se pide en texto libre.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proveedor">
          <select className={inputClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Elegí el proveedor…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.taxId ? `· ${p.taxId}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de la OC">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-2">
        {filas.map((f) => (
          <div key={f.id} className="grid items-end gap-2 sm:grid-cols-[auto_2fr_1fr_1fr]">
            <input type="checkbox" className="mb-3" checked={f.incluir} onChange={(e) => setFila(f.id, { incluir: e.target.checked })} />
            <div>
              <p className="text-sm text-slate-800">{f.descripcion}</p>
              <p className="text-xs text-slate-500">
                {f.nroParte ? `Parte ${f.nroParte} · ` : ""}falta comprar {fmtQty(f.pendiente)} {f.unidad ?? ""}
              </p>
            </div>
            <Field label="Cantidad">
              <input type="number" min={0} step="any" className={inputClass} disabled={!f.incluir} value={f.cantidad} onChange={(e) => setFila(f.id, { cantidad: e.target.value })} />
            </Field>
            <Field label="Precio unitario">
              <input type="number" min={0} step="any" className={inputClass} disabled={!f.incluir} value={f.precio} onChange={(e) => setFila(f.id, { precio: e.target.value })} />
            </Field>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function RechazoModal({ requisicion, onClose, onDone, showToast }: { requisicion: Requisicion; onClose: () => void; onDone: () => void; showToast: Props["showToast"] }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Rechazar pedido ${requisicion.numeroOrigen}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Volver</Button>
          <Button
            variant="danger"
            disabled={!motivo.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.rechazarRequisicion(requisicion.id, motivo.trim());
                onDone();
              } catch (err: any) {
                showToast(err.message || "No se pudo rechazar", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Rechazar
          </Button>
        </>
      }
    >
      <Field label="Motivo" hint="El Taller recibe el aviso y vuelve a poder comprarlo por su cuenta.">
        <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
    </Modal>
  );
}
