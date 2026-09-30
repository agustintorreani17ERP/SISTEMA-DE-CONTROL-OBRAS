import type { Tone } from "../ui";

import { formatQty } from "../utils/numbers";
export type DocStatus = "BORRADOR" | "APROBADO_PARA_COMPRA" | "EMITIDA" | "RECIBIDO" | "ANULADO";

export const REQUEST_STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  APROBADO_PARA_COMPRA: { label: "Aprobado", tone: "brand" },
  EMITIDA: { label: "Con OC", tone: "warn" },
  RECIBIDO: { label: "Recibido", tone: "good" },
  ANULADO: { label: "Anulado", tone: "bad" },
};

export const ORDER_STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  APROBADO_PARA_COMPRA: { label: "Aprobada", tone: "brand" },
  EMITIDA: { label: "Emitida", tone: "warn" },
  RECIBIDO: { label: "Recibida", tone: "good" },
  ANULADO: { label: "Anulada", tone: "bad" },
};

/** Las fechas sin hora (columnas DATE) llegan como medianoche UTC: se muestran tal cual, sin huso. */
export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const day = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(d);
  return day ? `${day[3]}/${day[2]}/${day[1]}` : new Date(d).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" });
};
export const fmtQty = (v: unknown) => formatQty(Number(v || 0));
