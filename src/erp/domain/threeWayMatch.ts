/**
 * Control de aprobación de facturas recibidas antes de pagarlas. No todas las facturas pasan por
 * el mismo control: una con Orden de Compra sí tiene 3 vías reales (OC + recepción física + factura);
 * una con certificado de subcontratista son 2 vías (certificado aprobado + factura, sin recepción
 * física porque es un servicio); una factura al cliente (EMITIDA) no es una compra, no aplica
 * ningún control; una factura recibida sin documento de respaldo requiere aprobación manual.
 *
 * `estado` del Invoice y `threeWayMatchPassed` deben escribirse siempre juntos a partir de un único
 * MatchResult (ver `applyMatchResult` en invoices.controller.ts) para que nunca queden desincronizados.
 */

export const MATCH_TOLERANCE_GS = 0.05;

export type MatchKind = "ORDEN_COMPRA" | "CERTIFICADO" | "NO_APLICA" | "SIN_DOCUMENTO";

export interface MatchInput {
  tipo: "EMITIDA" | "RECIBIDA";
  total: number;
  purchaseOrder?: { number: string; totalAmount: number; stockRegistered: boolean } | null;
  /** Certificado de subcontratista (modelo legado `Certificacion` o el nuevo `Certification`). */
  certificado?: { ref: string; estado: string; estadosAprobados: string[]; monto: number } | null;
  remisionNumber?: string | null;
}

export interface MatchResult {
  kind: MatchKind;
  passed: boolean;
  notes: string;
}

const fmt = (n: number) => n.toLocaleString("es-PY");

export function evaluateMatch(input: MatchInput): MatchResult {
  const { tipo, total, purchaseOrder, certificado, remisionNumber } = input;

  if (tipo === "EMITIDA") {
    return {
      kind: "NO_APLICA",
      passed: true,
      notes: "Factura de venta al cliente: no aplica control de compras.",
    };
  }

  if (purchaseOrder) {
    const diff = Math.abs(total - purchaseOrder.totalAmount);
    if (diff > MATCH_TOLERANCE_GS) {
      return {
        kind: "ORDEN_COMPRA",
        passed: false,
        notes: `Discrepancia de monto (tolerancia 0%): factura ${fmt(total)} vs. O.C. ${purchaseOrder.number} (${fmt(purchaseOrder.totalAmount)}). Diferencia: ${fmt(diff)}.`,
      };
    }
    const hasPhysicalReceipt = purchaseOrder.stockRegistered || Boolean(remisionNumber && remisionNumber.trim().length > 0);
    if (!hasPhysicalReceipt) {
      return {
        kind: "ORDEN_COMPRA",
        passed: false,
        notes: `Pendiente de recepción física en pañol para la O.C. ${purchaseOrder.number}.`,
      };
    }
    return {
      kind: "ORDEN_COMPRA",
      passed: true,
      notes: `Control de 3 vías OK: O.C. ${purchaseOrder.number}, recepción en pañol y factura coinciden (0% de tolerancia).`,
    };
  }

  if (certificado) {
    if (!certificado.estadosAprobados.includes(certificado.estado)) {
      return {
        kind: "CERTIFICADO",
        passed: false,
        notes: `El certificado ${certificado.ref} aún no está aprobado (estado: ${certificado.estado}).`,
      };
    }
    const diff = Math.abs(total - certificado.monto);
    if (diff > MATCH_TOLERANCE_GS) {
      return {
        kind: "CERTIFICADO",
        passed: false,
        notes: `Discrepancia en medición: factura ${fmt(total)} vs. certificado ${certificado.ref} (${fmt(certificado.monto)}).`,
      };
    }
    return {
      kind: "CERTIFICADO",
      passed: true,
      notes: `Control de 2 vías OK: certificado ${certificado.ref} aprobado y factura coinciden (sin recepción física: es un servicio).`,
    };
  }

  return {
    kind: "SIN_DOCUMENTO",
    passed: false,
    notes: "Factura sin Orden de Compra ni certificado: requiere aprobación manual (imputación por renglón).",
  };
}
