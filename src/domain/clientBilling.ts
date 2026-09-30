import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { moneyNumber } from "../lib/money";
import { buildClientInvoice, type BillingRow } from "./clientBillingMath";
import { measurementDate } from "./progress";
import { EVENTO, postAsientoDesdeRegla } from "./contabilidad";

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface SnapshotRow {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  ejecutadoOficial?: number;
  ejecutado?: number;
  puConIva: number;
}

/**
 * Borrador de la factura al cliente de un cierre oficial: sale del snapshot del cierre (la
 * medición oficial congelada), no de datos vivos, así la factura coincide con lo cerrado.
 */
export async function clientInvoicePreview(db: Db, cierreId: number) {
  const cierre = await db.cierrePeriodo.findUnique({ where: { id: cierreId }, include: { factura: { select: { id: true, numeroFactura: true } } } });
  if (!cierre) throw new NotFoundError("Cierre", cierreId);
  const project = await db.project.findUniqueOrThrow({ where: { id: cierre.projectId }, select: { id: true, name: true, code: true, clientName: true, ivaPct: true } });
  const snap = cierre.snapshot as unknown as { avance?: { rows?: SnapshotRow[] } };
  const rows: BillingRow[] = (snap.avance?.rows ?? []).map((r) => ({
    budgetItemId: r.budgetItemId,
    code: r.code,
    name: r.name,
    unit: r.unit,
    cantidad: r.ejecutadoOficial ?? r.ejecutado ?? 0,
    puConIva: r.puConIva,
  }));

  // Certificados al cliente del período: fondo de reparo y estado
  const certs = await db.certification.findMany({
    where: { projectId: cierre.projectId, partnerId: null, estado: { not: "MEDICION_BORRADOR" } },
    select: { id: true, numero: true, estado: true, retentionPct: true, periodTo: true, fecha: true },
  });
  const delPeriodo = certs.filter((c) => {
    const d = measurementDate(c);
    return d >= cierre.desde && d <= cierre.hasta;
  });
  const retencionPct = Math.max(0, ...delPeriodo.map((c) => moneyNumber(c.retentionPct)));
  const draft = buildClientInvoice(rows, moneyNumber(project.ivaPct), retencionPct);

  const avisos: string[] = [];
  if (cierre.factura) avisos.push(`El cierre ya está facturado (factura ${cierre.factura.numeroFactura}).`);
  if (!draft.lineas.length) avisos.push("El cierre no tiene medición oficial con cantidades a facturar.");
  const sinAprobar = delPeriodo.filter((c) => c.estado !== "APROBADO");
  if (sinAprobar.length) avisos.push(`Certificado(s) al cliente del período sin aprobar: N° ${sinAprobar.map((c) => c.numero).join(", ")}.`);
  if (draft.negativos.length) avisos.push(`${draft.negativos.length} ítem(s) con medición negativa: van en una nota de crédito, no en esta factura.`);

  return {
    cierre: { id: cierre.id, desde: iso(cierre.desde), hasta: iso(cierre.hasta) },
    project,
    certificados: delPeriodo.map((c) => ({ id: c.id, numero: c.numero, estado: c.estado })),
    facturada: cierre.factura,
    draft,
    avisos,
  };
}

/** Emite la factura al cliente del cierre (una sola por cierre). */
export async function createClientInvoice(
  tx: Prisma.TransactionClient,
  cierreId: number,
  params: { numeroFactura?: string | null; timbrado?: string | null; fechaEmision?: Date; diasVencimiento?: number }
) {
  const p = await clientInvoicePreview(tx, cierreId);
  if (p.facturada) throw new DomainError("ALREADY_INVOICED", `El cierre ya está facturado (factura ${p.facturada.numeroFactura})`, 409);
  if (!p.draft.lineas.length) throw new DomainError("NOTHING_TO_INVOICE", "El cierre no tiene cantidades oficiales para facturar", 422);
  const emision = params.fechaEmision ?? new Date();
  const vence = new Date(emision.getTime() + (params.diasVencimiento ?? 30) * 86400000);
  const n = (await tx.invoice.count({ where: { projectId: p.project.id, tipo: "EMITIDA" } })) + 1;
  const d = p.draft;
  const notas = [`Medición oficial del ${p.cierre.desde.split("-").reverse().join("/")} al ${p.cierre.hasta.split("-").reverse().join("/")}.`];
  if (d.retencion) notas.push(`Fondo de reparo ${d.retencionPct}%: ${d.retencion.toLocaleString("es-PY")} Gs. Neto a cobrar ${d.netoACobrar.toLocaleString("es-PY")} Gs.`);
  const created = await tx.invoice.create({
    data: {
      projectId: p.project.id,
      partnerId: null,
      cierreId,
      numeroFactura: params.numeroFactura?.trim() || `001-001-${String(n).padStart(7, "0")}`,
      timbrado: params.timbrado?.trim() || "PENDIENTE",
      tipo: "EMITIDA",
      estado: "APROBADA",
      fechaEmision: emision,
      fechaVencimiento: vence,
      condicionVenta: "CREDITO",
      concepto: `Avance de obra ${p.cierre.desde} a ${p.cierre.hasta} — ${p.project.name}`,
      subtotal: d.sinIva,
      montoExento: 0,
      montoIva5: d.ivaPct === 5 ? d.iva : 0,
      montoIva10: d.ivaPct === 5 ? 0 : d.iva,
      total: d.total,
      threeWayMatchPassed: true,
      matchNotes: notas.join(" "),
      items: {
        create: d.lineas.map((l) => ({
          description: `${l.code} - ${l.name}`,
          quantity: l.cantidad,
          unitPrice: l.puConIva,
          vatType: d.ivaPct === 5 ? "IVA5" : d.ivaPct === 0 ? "EXENTA" : "IVA10",
          montoExento: d.ivaPct === 0 ? l.total : 0,
          montoIva5: d.ivaPct === 5 ? l.iva : 0,
          montoIva10: d.ivaPct === 5 || d.ivaPct === 0 ? 0 : l.iva,
          subtotal: l.sinIva,
          budgetItemId: l.budgetItemId,
        })),
      },
    },
    include: { items: true },
  });

  await postAsientoDesdeRegla(tx, {
    evento: EVENTO.FACTURA_CLIENTE_EMITIDA,
    projectId: p.project.id,
    concepto: `Factura al cliente ${created.numeroFactura}`,
    sourceType: "Invoice",
    sourceId: created.id,
    fecha: emision,
    debe: [{ monto: d.total }],
    haber: [{ monto: d.total }],
  });

  return created;
}
