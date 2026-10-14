import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { buildClientInvoice, limitarAPendiente, pendienteDeFacturar, type BillingRow, type ClientInvoiceDraft } from "../../erp/domain/clientBillingMath";
import { measurementDate, loadMediciones } from "../../ecms/domain/medicion";
import { postAsientoFacturaCliente } from "../../erp/domain/contabilidad";
import { evaluateMatch } from "../../erp/domain/threeWayMatch";

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date | string) => (typeof d === "string" ? d : iso(d)).split("-").reverse().join("/");

/**
 * Factura al cliente. Sale de la medición del certificado al cliente: se emite al aprobar el
 * certificado. Lo que ya se facturó no se factura otra vez: el tope es medición acumulada −
 * facturado por ítem.
 */

/** Medición acumulada por ítem (certificados al cliente) hasta `hasta` inclusive. */
export async function oficialAcumulado(db: Db, projectId: number, hasta: Date) {
  const mediciones = await loadMediciones(db, projectId, iso(hasta));
  const out = new Map<number, number>();
  for (const [itemId, list] of mediciones) out.set(itemId, list.reduce((acc, m) => acc + m.cantidad, 0));
  return out;
}

/**
 * Cantidad ya facturada al cliente por ítem, de certificados con medición hasta esa fecha:
 * facturas EMITIDA no anuladas.
 */
export async function facturadoHasta(db: Db, projectId: number, hasta: Date) {
  const certs = await db.certification.findMany({ where: { projectId, partnerId: null }, select: { id: true, periodTo: true, fecha: true } });
  const certIds = new Set(certs.filter((c) => measurementDate(c) <= hasta).map((c) => c.id));
  const invoices = (await db.invoice.findMany({ where: { projectId, tipo: "EMITIDA" }, select: { id: true, estado: true, certificationId: true } })).filter(
    (i) => i.estado !== "ANULADA" && i.certificationId != null && certIds.has(i.certificationId)
  );
  const out = new Map<number, number>();
  if (!invoices.length) return out;
  const items = await db.invoiceItem.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } }, select: { budgetItemId: true, quantity: true } });
  for (const it of items) {
    if (it.budgetItemId == null) continue;
    out.set(it.budgetItemId, (out.get(it.budgetItemId) ?? 0) + moneyNumber(it.quantity));
  }
  return out;
}

interface EmitirParams {
  projectId: number;
  draft: ClientInvoiceDraft;
  certificationId: number;
  concepto: string;
  notas: string[];
  fechaEmision?: Date;
  usuario?: string;
}

/** Crea la factura EMITIDA (IVA desglosado por línea), su asiento y el fondo de reparo. */
async function emitirFacturaCliente(tx: Prisma.TransactionClient, p: EmitirParams) {
  const d = p.draft;
  const emision = p.fechaEmision ?? new Date();
  const vence = new Date(emision.getTime() + 30 * 86400000);
  const n = (await tx.invoice.count({ where: { projectId: p.projectId, tipo: "EMITIDA" } })) + 1;
  const notas = [...p.notas];
  if (d.retencion) notas.push(`Fondo de reparo ${d.retencionPct}%: ${d.retencion.toLocaleString("es-PY")} Gs. Neto a cobrar ${d.netoACobrar.toLocaleString("es-PY")} Gs.`);
  const matchResult = evaluateMatch({ tipo: "EMITIDA", total: d.total });
  notas.push(matchResult.notes);
  const created = await tx.invoice.create({
    data: {
      projectId: p.projectId,
      partnerId: null,
      certificationId: p.certificationId,
      numeroFactura: `001-001-${String(n).padStart(7, "0")}`,
      timbrado: "PENDIENTE",
      tipo: "EMITIDA",
      estado: "APROBADA",
      fechaEmision: emision,
      fechaVencimiento: vence,
      condicionVenta: "CREDITO",
      concepto: p.concepto,
      subtotal: d.sinIva,
      montoExento: 0,
      montoIva5: d.ivaPct === 5 ? d.iva : 0,
      montoIva10: d.ivaPct === 5 ? 0 : d.iva,
      total: d.total,
      montoRetenido: d.retencion,
      threeWayMatchPassed: matchResult.passed,
      matchNotes: notas.join(" "),
    },
  });
  // Renglones aparte (no create anidado): el almacenamiento simulado de desarrollo no lo soporta.
  await tx.invoiceItem.createMany({
    data: d.lineas.map((l) => ({
      invoiceId: created.id,
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
  });

  await postAsientoFacturaCliente(tx, {
    projectId: p.projectId,
    invoiceId: created.id,
    numeroFactura: created.numeroFactura,
    fecha: emision,
    total: d.total,
    iva: d.iva,
    usuario: p.usuario,
  });

  if (d.retencion > 0) {
    await tx.retencionFondo.create({
      data: {
        projectId: p.projectId,
        partnerId: null,
        tipo: "FONDO_REPARO",
        monto: d.retencion,
        fecha: emision,
        sourceType: "Invoice",
        sourceId: created.id,
        notas: `Fondo de reparo ${d.retencionPct}% — factura ${created.numeroFactura}`,
      },
    });
  }
  return tx.invoice.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
}

/**
 * Factura al cliente de un certificado que se aprueba: sus cantidades × PU con IVA, cada una
 * hasta lo pendiente de facturar del ítem (si un certificado anterior ya facturó esa medición, no se repite).
 * Idempotente: si el certificado ya tiene su factura emitida, la devuelve.
 */
export async function facturarCertificadoCliente(tx: Prisma.TransactionClient, certificationId: number, opts: { fechaEmision?: Date; usuario?: string } = {}) {
  const cert = await tx.certification.findUnique({
    where: { id: certificationId },
    include: { items: { include: { budgetItem: { select: { code: true, name: true, unit: true } } } } },
  });
  if (!cert) throw new NotFoundError("Certificación", certificationId);
  if (cert.partnerId) throw new DomainError("NOT_CLIENT_CERT", "Solo los certificados al cliente se facturan al cliente", 422);
  const existente = await tx.invoice.findFirst({ where: { certificationId, tipo: "EMITIDA" } });
  if (existente) return { invoice: existente, avisos: [] as string[] };

  const project = await tx.project.findUniqueOrThrow({ where: { id: cert.projectId }, select: { id: true, name: true, ivaPct: true } });
  const hasta = measurementDate(cert);
  const pendiente = pendienteDeFacturar(await oficialAcumulado(tx, cert.projectId, hasta), await facturadoHasta(tx, cert.projectId, hasta));
  const { lineas, recortadas } = limitarAPendiente(
    cert.items.flatMap((i) => (i.budgetItemId !== null && i.budgetItem ? [{ ...i, budgetItemId: i.budgetItemId, budgetItem: i.budgetItem }] : [])).map(
      (i): BillingRow => ({
        budgetItemId: i.budgetItemId,
        code: i.budgetItem.code,
        name: i.budgetItem.name,
        unit: i.budgetItem.unit,
        cantidad: moneyNumber(i.cantidadPresente),
        puConIva: moneyNumber(i.precioUnitario),
      })
    ),
    pendiente
  );
  const draft = buildClientInvoice(lineas, moneyNumber(project.ivaPct), moneyNumber(cert.retentionPct));
  const avisos: string[] = [];
  if (recortadas.length) avisos.push(`${recortadas.length} ítem(s) ya estaban facturados por un certificado anterior: se factura solo la diferencia.`);
  if (draft.negativos.length) avisos.push(`${draft.negativos.length} ítem(s) con medición negativa: van en una nota de crédito, no en esta factura.`);
  if (!draft.lineas.length) {
    avisos.push("No se emitió factura: lo medido en este certificado ya estaba facturado.");
    return { invoice: null, avisos };
  }
  const invoice = await emitirFacturaCliente(tx, {
    projectId: project.id,
    draft,
    certificationId,
    concepto: `Certificado N° ${cert.numero} de avance de obra — ${project.name}`,
    notas: [`Medición N° ${cert.numero} al ${fmt(hasta)}.`],
    fechaEmision: opts.fechaEmision,
    usuario: opts.usuario,
  });
  return { invoice, avisos };
}
