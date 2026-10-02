import type { PillTone } from "../ui";

import { formatQty } from "../utils/numbers";
export type DocStatus = "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO" | "ANULADO";
type StatusInfo = { label: string; tone: PillTone };

export const REQUEST_STATUS: Record<DocStatus, StatusInfo> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  APROBADO_PARA_COMPRA: { label: "Aprobado", tone: "info" },
  EMITIDA: { label: "Con OC", tone: "violet" },
  RECIBIDO: { label: "Recibido", tone: "good" },
  ANULADO: { label: "Anulado", tone: "bad" },
};

export const ORDER_STATUS: Record<DocStatus, StatusInfo> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  APROBADO_PARA_COMPRA: { label: "Aprobada", tone: "info" },
  EMITIDA: { label: "Emitida", tone: "warn" },
  RECIBIDO: { label: "Recibida", tone: "good" },
  ANULADO: { label: "Anulada", tone: "bad" },
};

/** Estado visible del pedido: con varias OC, "Recibido" solo si todas las vigentes llegaron. */
export function pedidoEtapa(r: { status: DocStatus; purchaseOrders?: { status: DocStatus }[] }): StatusInfo {
  const ocs = (r.purchaseOrders ?? []).filter((o) => o.status !== "ANULADO");
  if (r.status === "ANULADO" || ocs.length === 0) return REQUEST_STATUS[r.status];
  const recibidas = ocs.filter((o) => o.status === "RECIBIDO").length;
  if (recibidas === ocs.length) return REQUEST_STATUS.RECIBIDO;
  if (recibidas > 0) return { label: `Parcial ${recibidas}/${ocs.length}`, tone: "warn" };
  return REQUEST_STATUS[r.status];
}

/** Las fechas sin hora (columnas DATE) llegan como medianoche UTC: se muestran tal cual, sin huso. */
export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const day = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(d);
  return day ? `${day[3]}/${day[2]}/${day[1]}` : new Date(d).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" });
};
export const fmtQty = (v: unknown) => formatQty(Number(v || 0));
