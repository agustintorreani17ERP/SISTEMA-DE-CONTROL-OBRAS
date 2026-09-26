import type { Certification, CertificationStatus } from "../types";
import type { Tone } from "../ui";

export const CERT_STATUS: Record<CertificationStatus, { label: string; tone: Tone }> = {
  MEDICION_BORRADOR: { label: "Medición en borrador", tone: "neutral" },
  MEDICION_CERRADA: { label: "Medición cerrada", tone: "neutral" },
  CERTIFICADO_BORRADOR: { label: "Certificado por aprobar", tone: "warn" },
  APROBADO: { label: "Aprobado", tone: "good" },
};

export const destinoLabel = (c: Pick<Certification, "partner" | "partnerId">) =>
  c.partnerId ? c.partner?.name ?? "Subcontratista" : "Avance de obra";

export function periodLabel(c: Pick<Certification, "periodFrom" | "periodTo" | "fecha">) {
  const f = (d?: string | null) => (d ? new Date(d).toLocaleDateString("es-PY") : null);
  if (c.periodFrom && c.periodTo) return `${f(c.periodFrom)} al ${f(c.periodTo)}`;
  return f(c.periodTo) ?? f(c.fecha) ?? "";
}
