import type { BudgetMovementSource, Prisma, PrismaClient } from "@prisma/client";
import { moneyNumber } from "../lib/money";
import { costEngine } from "./costEngine";
import { toDay } from "./prices";
import { type DocInput, type FacturaInput, type Fuente, type LedgerInput, reconcile } from "./reconciliationMath";

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const FUENTE: Partial<Record<BudgetMovementSource, Fuente>> = {
  PURCHASE_ORDER: "OC",
  SUBCONTRACT: "SUBCONTRATO",
  PETTY_CASH: "CAJA_CHICA",
  INVOICE: "FACTURA",
  LABOR_COST: "PERSONAL",
};
const VAT_RATE: Record<string, number> = { IVA10: 0.1, IVA5: 0.05, EXENTA: 0 };
const sinIva = (items: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; vatType: string }[]) =>
  items.reduce((s, l) => s + Math.round((Number(l.quantity) * Number(l.unitPrice)) / (1 + (VAT_RATE[l.vatType] ?? 0.1))), 0);
const finDeMes = (periodo: string) => {
  const [y, m] = periodo.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};

/** Conciliación documentos ↔ libro mayor ↔ motor de costos para [desde, hasta]. */
export async function reconciliation(db: Db, projectId: number, desde: string, hasta: string) {
  const d0 = toDay(desde);
  const d1 = toDay(hasta);
  const enRango = (f: string | null) => f !== null && f >= desde && f <= hasta;

  const movs = await db.budgetMovement.findMany({
    where: { projectId, stage: "ACTUAL", source: { not: "CLIENT_CERTIFICATE" }, fecha: { gte: d0, lte: d1 } },
    select: { sourceType: true, sourceId: true, sourceNumber: true, source: true, amount: true, fecha: true },
  });
  const ledger: LedgerInput[] = movs.map((m) => ({
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    sourceNumber: m.sourceNumber,
    fuente: FUENTE[m.source] ?? "OTROS",
    amount: moneyNumber(m.amount),
    fecha: iso(m.fecha),
  }));
  const idsDe = (t: string) => [...new Set(movs.filter((m) => m.sourceType === t).map((m) => m.sourceId))];
  const rango = { gte: d0, lte: new Date(d1.getTime() + 86_399_999) };

  const [ocs, certs, gastos, facturasImp, liqs] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { projectId, status: "RECIBIDO", OR: [{ receivedDate: rango }, { id: { in: idsDe("PurchaseOrder") } }] },
      include: { details: { select: { subtotal: true } } },
    }),
    db.certification.findMany({
      where: { projectId, partnerId: { not: null }, estado: "APROBADO", OR: [{ approvedAt: rango }, { id: { in: idsDe("Certification") } }] },
      include: { partner: { select: { name: true } } },
    }),
    db.pettyCashExpense.findMany({
      where: { fund: { projectId }, status: "RENDIDO", OR: [{ date: rango }, { id: { in: idsDe("PettyCashExpense") } }] },
    }),
    db.invoice.findMany({
      where: {
        projectId,
        tipo: "RECIBIDA",
        purchaseOrderId: null,
        certificationId: null,
        certificacionId: null,
        estado: { not: "ANULADA" },
        items: { some: {}, every: { insumoId: { not: null } } },
        OR: [{ fechaEmision: rango }, { id: { in: idsDe("Invoice") } }],
      },
      include: { items: { select: { quantity: true, unitPrice: true, vatType: true } } },
    }),
    db.liquidacionPersonal.findMany({ where: { projectId, estado: { in: ["APROBADA", "PAGADA"] } }, include: { empleado: { select: { fullName: true } } } }),
  ]);

  const docs: DocInput[] = [];
  for (const o of ocs) {
    const f = o.receivedDate ? iso(o.receivedDate) : null;
    docs.push({ sourceType: "PurchaseOrder", sourceId: o.id, fuente: "OC", numero: `OC ${o.number}`, fecha: f, esperado: o.details.reduce((s, d) => s + moneyNumber(d.subtotal), 0), enRango: enRango(f) });
  }
  for (const c of certs) {
    const f = c.approvedAt ? iso(c.approvedAt) : null;
    docs.push({ sourceType: "Certification", sourceId: c.id, fuente: "SUBCONTRATO", numero: `Cert. N° ${c.numero} ${c.partner?.name ?? ""}`.trim(), fecha: f, esperado: moneyNumber(c.montoTotal), enRango: enRango(f) });
  }
  for (const g of gastos) {
    const f = iso(g.date);
    docs.push({ sourceType: "PettyCashExpense", sourceId: g.id, fuente: "CAJA_CHICA", numero: `Caja chica ${g.receiptNumber}`, fecha: f, esperado: moneyNumber(g.amount), enRango: enRango(f) });
  }
  for (const i of facturasImp) {
    const f = iso(i.fechaEmision);
    docs.push({ sourceType: "Invoice", sourceId: i.id, fuente: "FACTURA", numero: `Fact. ${i.numeroFactura}`, fecha: f, esperado: sinIva(i.items), enRango: enRango(f) });
  }
  const liqLedger = new Set(idsDe("LiquidacionPersonal"));
  for (const l of liqs) {
    const f = finDeMes(l.periodo);
    if (!enRango(f) && !liqLedger.has(l.id)) continue;
    docs.push({ sourceType: "LiquidacionPersonal", sourceId: l.id, fuente: "PERSONAL", numero: `Liq. ${l.periodo} ${l.empleado.fullName}`, fecha: f, esperado: moneyNumber(l.costoTotal), enRango: enRango(f) });
  }

  // Facturas recibidas contra su OC o certificado (mismo criterio que el control de 3 vías)
  const recibidas = await db.invoice.findMany({
    where: {
      projectId,
      tipo: "RECIBIDA",
      estado: { not: "ANULADA" },
      OR: [{ purchaseOrderId: { not: null } }, { certificationId: { not: null } }],
      fechaEmision: rango,
    },
    include: { purchaseOrder: { select: { totalAmount: true } }, certification: { select: { montoTotal: true } } },
  });
  const facturas: FacturaInput[] = recibidas.map((f) => ({
    invoiceId: f.id,
    numero: f.numeroFactura,
    fecha: iso(f.fechaEmision),
    total: moneyNumber(f.total),
    sourceType: f.purchaseOrderId ? "PurchaseOrder" : "Certification",
    sourceId: (f.purchaseOrderId ?? f.certificationId)!,
    totalDocumento: f.purchaseOrder ? moneyNumber(f.purchaseOrder.totalAmount) : moneyNumber(f.certification?.montoTotal ?? 0),
  }));
  // Las facturas de OC/certificados del rango pueden ser de fechas anteriores: se buscan todas
  const facturadas = await db.invoice.findMany({
    where: {
      projectId,
      tipo: "RECIBIDA",
      estado: { not: "ANULADA" },
      OR: [{ purchaseOrderId: { in: docs.filter((d) => d.sourceType === "PurchaseOrder").map((d) => d.sourceId) } }, { certificationId: { in: docs.filter((d) => d.sourceType === "Certification").map((d) => d.sourceId) } }],
    },
    select: { purchaseOrderId: true, certificationId: true },
  });
  const conFactura = new Set(facturadas.map((f) => (f.purchaseOrderId ? `PurchaseOrder#${f.purchaseOrderId}` : `Certification#${f.certificationId}`)));
  const facturaExigida = new Set(docs.filter((d) => (d.sourceType === "PurchaseOrder" || d.sourceType === "Certification") && !conFactura.has(`${d.sourceType}#${d.sourceId}`)).map((d) => `${d.sourceType}#${d.sourceId}`));

  const r = reconcile(docs, ledger, facturas, { facturaExigida });

  const motor = await costEngine(db, projectId, desde, hasta);
  const t = motor.totales;
  return {
    desde,
    hasta,
    ...r,
    motor: {
      totalContable: t.totalContable,
      imputado: t.imputado,
      perdidas: t.perdidas,
      noImputado: t.noImputado,
      a: t.a,
      b: t.b,
      c: t.c,
      ok: t.ok,
      diferencia: t.diferencia,
      /** El motor debe partir del mismo libro: total contable del motor − libro de la conciliación. */
      diferenciaConLibro: Math.round(t.totalContable - r.totales.libro),
      avisos: motor.avisos,
    },
  };
}
