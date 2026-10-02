import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { moneyNumber } from "../lib/money";
import { buildClientInvoice, limitarAPendiente, pendienteDeFacturar, type BillingRow, type ClientInvoiceDraft } from "./clientBillingMath";
import { measurementDate } from "./progress";
import { postAsientoFacturaCliente } from "./contabilidad";
import { evaluateMatch } from "./threeWayMatch";

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date | string) => (typeof d === "string" ? d : iso(d)).split("-").reverse().join("/");

/**
 * Factura al cliente. Sale de la medición oficial: se emite al aprobar el certificado al cliente
 * y el cierre oficial factura solo lo que todavía no se facturó (medición oficial acumulada −
 * facturado), así nunca se factura dos veces la misma cantidad.
 */

interface SnapshotRow {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  anteriorOficial?: number;
  ejecutadoOficial?: number;
  acumuladoOficial?: number;
  ejecutado?: number;
  puConIva: number;
}

/** Medición oficial acumulada por ítem al `hasta` (inclusive). */
export async function oficialAcumulado(db: Db, projectId: number, hasta: Date) {
  const rows = await db.avanceItem.findMany({
    where: { projectId, origen: "MEDICION_OFICIAL", fecha: { lte: hasta } },
    select: { budgetItemId: true, cantidad: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.budgetItemId, (out.get(r.budgetItemId) ?? 0) + moneyNumber(r.cantidad));
  return out;
}

/**
 * Cantidad ya facturada al cliente por ítem, de mediciones hasta `hasta`: facturas EMITIDA no
 * anuladas de certificados al cliente con medición hasta esa fecha, de cierres hasta esa fecha y
 * de cierres reabiertos (su factura sigue vigente aunque el cierre ya no exista).
 */
export async function facturadoHasta(db: Db, projectId: number, hasta: Date) {
  const [certs, cierres, reaperturas] = await Promise.all([
    db.certification.findMany({ where: { projectId, partnerId: null }, select: { id: true, periodTo: true, fecha: true } }),
    db.cierrePeriodo.findMany({ where: { projectId, hasta: { lte: hasta } }, select: { id: true } }),
    db.cierreReapertura.findMany({ where: { projectId, hasta: { lte: hasta } }, select: { facturaId: true } }),
  ]);
  const certIds = new Set(certs.filter((c) => measurementDate(c) <= hasta).map((c) => c.id));
  const cierreIds = new Set(cierres.map((c) => c.id));
  const reabiertas = new Set(reaperturas.map((r) => r.facturaId).filter((id): id is number => id !== null));
  const invoices = (await db.invoice.findMany({ where: { projectId, tipo: "EMITIDA" }, select: { id: true, estado: true, certificationId: true, cierreId: true } })).filter(
    (i) =>
      i.estado !== "ANULADA" &&
      ((i.certificationId != null && certIds.has(i.certificationId)) || (i.cierreId != null && cierreIds.has(i.cierreId)) || reabiertas.has(i.id))
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

/**
 * Borrador de la factura al cliente de un cierre oficial: la medición oficial acumulada congelada
 * en el snapshot, menos lo ya facturado (por ejemplo, al aprobar los certificados del período).
 */
export async function clientInvoicePreview(db: Db, cierreId: number) {
  const cierre = await db.cierrePeriodo.findUnique({ where: { id: cierreId }, include: { factura: { select: { id: true, numeroFactura: true } } } });
  if (!cierre) throw new NotFoundError("Cierre", cierreId);
  const project = await db.project.findUniqueOrThrow({ where: { id: cierre.projectId }, select: { id: true, name: true, code: true, clientName: true, ivaPct: true } });
  const snap = cierre.snapshot as unknown as { avance?: { rows?: SnapshotRow[] } };
  const snapRows = snap.avance?.rows ?? [];
  const oficial = new Map(snapRows.map((r) => [r.budgetItemId, r.acumuladoOficial ?? (r.anteriorOficial ?? 0) + (r.ejecutadoOficial ?? r.ejecutado ?? 0)]));
  const facturado = await facturadoHasta(db, cierre.projectId, cierre.hasta);
  const pendiente = pendienteDeFacturar(oficial, facturado);
  const rows: BillingRow[] = snapRows.map((r) => ({
    budgetItemId: r.budgetItemId,
    code: r.code,
    name: r.name,
    unit: r.unit,
    cantidad: pendiente.get(r.budgetItemId) ?? 0,
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
  else if (!draft.lineas.length && [...facturado.values()].some((q) => q !== 0)) {
    avisos.push("Todo lo medido hasta este cierre ya está facturado (al aprobar los certificados al cliente): no queda nada por facturar.");
  } else if (!draft.lineas.length) avisos.push("El cierre no tiene medición oficial con cantidades a facturar.");
  const sinAprobar = delPeriodo.filter((c) => c.estado !== "APROBADO");
  if (sinAprobar.length) {
    avisos.push(`Certificado(s) al cliente del período sin aprobar: N° ${sinAprobar.map((c) => c.numero).join(", ")}. Si los aprobás, se facturan solos y no hace falta facturar el cierre.`);
  }
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

interface EmitirParams {
  projectId: number;
  draft: ClientInvoiceDraft;
  origen: { cierreId: number } | { certificationId: number };
  concepto: string;
  notas: string[];
  numeroFactura?: string | null;
  timbrado?: string | null;
  fechaEmision?: Date;
  diasVencimiento?: number;
  usuario?: string;
}

/** Crea la factura EMITIDA (IVA desglosado por línea), su asiento y el fondo de reparo. */
async function emitirFacturaCliente(tx: Prisma.TransactionClient, p: EmitirParams) {
  const d = p.draft;
  const emision = p.fechaEmision ?? new Date();
  const vence = new Date(emision.getTime() + (p.diasVencimiento ?? 30) * 86400000);
  const n = (await tx.invoice.count({ where: { projectId: p.projectId, tipo: "EMITIDA" } })) + 1;
  const notas = [...p.notas];
  if (d.retencion) notas.push(`Fondo de reparo ${d.retencionPct}%: ${d.retencion.toLocaleString("es-PY")} Gs. Neto a cobrar ${d.netoACobrar.toLocaleString("es-PY")} Gs.`);
  const matchResult = evaluateMatch({ tipo: "EMITIDA", total: d.total });
  notas.push(matchResult.notes);
  const created = await tx.invoice.create({
    data: {
      projectId: p.projectId,
      partnerId: null,
      ...("cierreId" in p.origen ? { cierreId: p.origen.cierreId } : { certificationId: p.origen.certificationId }),
      numeroFactura: p.numeroFactura?.trim() || `001-001-${String(n).padStart(7, "0")}`,
      timbrado: p.timbrado?.trim() || "PENDIENTE",
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

/** Emite la factura al cliente del cierre (una sola por cierre, y solo por lo no facturado). */
export async function createClientInvoice(
  tx: Prisma.TransactionClient,
  cierreId: number,
  params: { numeroFactura?: string | null; timbrado?: string | null; fechaEmision?: Date; diasVencimiento?: number }
) {
  const p = await clientInvoicePreview(tx, cierreId);
  if (p.facturada) throw new DomainError("ALREADY_INVOICED", `El cierre ya está facturado (factura ${p.facturada.numeroFactura})`, 409);
  if (!p.draft.lineas.length) {
    throw new DomainError("NOTHING_TO_INVOICE", "El cierre no tiene cantidades oficiales pendientes de facturar (lo medido ya se facturó al aprobar los certificados).", 422);
  }
  return emitirFacturaCliente(tx, {
    projectId: p.project.id,
    draft: p.draft,
    origen: { cierreId },
    concepto: `Avance de obra ${p.cierre.desde} a ${p.cierre.hasta} — ${p.project.name}`,
    notas: [`Medición oficial del ${fmt(p.cierre.desde)} al ${fmt(p.cierre.hasta)}.`],
    ...params,
  });
}

/**
 * Factura al cliente de un certificado que se aprueba: sus cantidades × PU con IVA, cada una
 * hasta lo pendiente de facturar del ítem (si un cierre ya facturó esa medición, no se repite).
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
    cert.items.map(
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
  if (recortadas.length) avisos.push(`${recortadas.length} ítem(s) ya estaban facturados por el cierre del período: se factura solo la diferencia.`);
  if (draft.negativos.length) avisos.push(`${draft.negativos.length} ítem(s) con medición negativa: van en una nota de crédito, no en esta factura.`);
  if (!draft.lineas.length) {
    avisos.push("No se emitió factura: lo medido en este certificado ya estaba facturado.");
    return { invoice: null, avisos };
  }
  const invoice = await emitirFacturaCliente(tx, {
    projectId: project.id,
    draft,
    origen: { certificationId },
    concepto: `Certificado N° ${cert.numero} de avance de obra — ${project.name}`,
    notas: [`Medición oficial N° ${cert.numero} al ${fmt(hasta)}.`],
    fechaEmision: opts.fechaEmision,
    usuario: opts.usuario,
  });
  return { invoice, avisos };
}
