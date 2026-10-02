import { Prisma } from "@prisma/client";
import { DomainError } from "../errors/domain";
import { toDecimal, type MoneyLike } from "../lib/money";
import { ledgerItemFor, ledgerLines } from "./imputation";

export const EVENTO = {
  OC_RECIBIDA: "OC_RECIBIDA",
  FACTURA_RECIBIDA: "FACTURA_RECIBIDA",
  CERTIFICADO_SUBCONTRATISTA_APROBADO: "CERTIFICADO_SUBCONTRATISTA_APROBADO",
  LIQUIDACION_APROBADA: "LIQUIDACION_APROBADA",
  CAJA_CHICA_RENDIDA: "CAJA_CHICA_RENDIDA",
  FACTURA_CLIENTE_EMITIDA: "FACTURA_CLIENTE_EMITIDA",
  /** IVA de la factura al cliente: se usa la cuenta haber (IVA débito fiscal). */
  IVA_DEBITO_FISCAL: "IVA_DEBITO_FISCAL",
  PAGO_FACTURA: "PAGO_FACTURA",
  /** Pago de una solicitud de fondos de anticipo (Debe Anticipos a proveedores). */
  PAGO_ANTICIPO_PROVEEDOR: "PAGO_ANTICIPO_PROVEEDOR",
  /** Pago de una solicitud de certificado de subcontrato sin factura (Debe Subcontratistas). */
  PAGO_CERTIFICADO_SUBCONTRATISTA: "PAGO_CERTIFICADO_SUBCONTRATISTA",
} as const;

/**
 * Libro diario. Todo asiento se registra aquí en la misma transacción del hecho que lo origina.
 * Nunca se borra: anular crea un contra-asiento enlazado por anulaDeId. Idempotente por
 * (sourceType, sourceId): si ya existe un asiento vigente (sin anular) para ese origen, se
 * devuelve sin duplicar.
 */

type Tx = Prisma.TransactionClient;

export interface PostAsientoLineaInput {
  cuentaId: number;
  debe?: MoneyLike;
  haber?: MoneyLike;
  budgetItemId?: number | null;
  partnerId?: number | null;
}

export interface PostAsientoInput {
  projectId: number;
  concepto: string;
  sourceType: string;
  sourceId: number;
  lineas: PostAsientoLineaInput[];
  usuario?: string;
  /** Fecha del hecho; por defecto hoy. */
  fecha?: Date;
}

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export interface AsientoLineaSimple {
  monto: MoneyLike;
  budgetItemId?: number | null;
  partnerId?: number | null;
}

/**
 * Arma un asiento desde la ReglaAsientoContable de `evento` (cuenta debe / cuenta haber, en la
 * base, no en el código): `debe` va a la cuenta debe de la regla, `haber` a la cuenta haber.
 * Si el evento no tiene regla activa, no contabiliza (no rompe el flujo operativo que lo llama).
 */
export async function postAsientoDesdeRegla(
  tx: Tx,
  params: {
    evento: string;
    projectId: number;
    concepto: string;
    sourceType: string;
    sourceId: number;
    fecha?: Date;
    usuario?: string;
    debe: AsientoLineaSimple[];
    haber: AsientoLineaSimple[];
  }
) {
  const regla = await tx.reglaAsientoContable.findUnique({ where: { evento: params.evento } });
  if (!regla || !regla.activo) return null;

  const lineas: PostAsientoLineaInput[] = [
    ...params.debe.map((l) => ({
      cuentaId: regla.cuentaDebeId,
      debe: l.monto,
      budgetItemId: l.budgetItemId,
      partnerId: l.partnerId,
    })),
    ...params.haber.map((l) => ({
      cuentaId: regla.cuentaHaberId,
      haber: l.monto,
      budgetItemId: l.budgetItemId,
      partnerId: l.partnerId,
    })),
  ];

  return postAsiento(tx, {
    projectId: params.projectId,
    concepto: params.concepto,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    fecha: params.fecha,
    usuario: params.usuario,
    lineas,
  });
}

/**
 * Asiento de una factura al cliente: Debe Clientes (total) / Haber Ventas (sin IVA) + Haber IVA
 * débito fiscal (IVA). Si no hay regla IVA_DEBITO_FISCAL activa, todo el total va a Ventas.
 */
export async function postAsientoFacturaCliente(
  tx: Tx,
  params: { projectId: number; invoiceId: number; numeroFactura: string; fecha: Date; total: MoneyLike; iva: MoneyLike; usuario?: string }
) {
  const regla = await tx.reglaAsientoContable.findUnique({ where: { evento: EVENTO.FACTURA_CLIENTE_EMITIDA } });
  if (!regla || !regla.activo) return null;
  const total = toDecimal(params.total);
  const iva = toDecimal(params.iva);
  const reglaIva = iva.gt(0) ? await tx.reglaAsientoContable.findUnique({ where: { evento: EVENTO.IVA_DEBITO_FISCAL } }) : null;
  const conIva = Boolean(reglaIva?.activo);
  return postAsiento(tx, {
    projectId: params.projectId,
    concepto: `Factura al cliente ${params.numeroFactura}`,
    sourceType: "Invoice",
    sourceId: params.invoiceId,
    fecha: params.fecha,
    usuario: params.usuario,
    lineas: [
      { cuentaId: regla.cuentaDebeId, debe: total },
      { cuentaId: regla.cuentaHaberId, haber: conIva ? total.minus(iva) : total },
      ...(conIva ? [{ cuentaId: reglaIva!.cuentaHaberId, haber: iva }] : []),
    ],
  });
}

export async function postAsiento(tx: Tx, input: PostAsientoInput) {
  const existing = await tx.asiento.findFirst({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, anulaDeId: null },
    include: { lineas: true },
  });
  if (existing) {
    const wasAnulado = await tx.asiento.findFirst({ where: { anulaDeId: existing.id } });
    if (!wasAnulado) return existing;
  }

  let totalDebe = toDecimal(0);
  let totalHaber = toDecimal(0);
  const lineas = input.lineas.map((l) => {
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    totalDebe = totalDebe.plus(debe);
    totalHaber = totalHaber.plus(haber);
    return {
      cuentaId: l.cuentaId,
      debe,
      haber,
      projectId: input.projectId,
      budgetItemId: l.budgetItemId ?? null,
      partnerId: l.partnerId ?? null,
    };
  });

  if (lineas.length < 2) {
    throw new DomainError("ASIENTO_SIN_LINEAS", "Un asiento requiere al menos dos líneas", 422);
  }
  if (!totalDebe.eq(totalHaber)) {
    throw new DomainError(
      "ASIENTO_DESBALANCEADO",
      `El asiento no balancea: debe ${totalDebe.toFixed(2)} ≠ haber ${totalHaber.toFixed(2)}`,
      422
    );
  }

  return tx.asiento.create({
    data: {
      projectId: input.projectId,
      concepto: input.concepto,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      usuario: input.usuario,
      fecha: input.fecha ?? today(),
      lineas: { create: lineas },
    },
    include: { lineas: true },
  });
}

/**
 * Genera los asientos que faltan para los documentos existentes de una obra (datos anteriores
 * al libro diario, o documentos sin regla activa al momento de confirmarse). Idempotente: un
 * documento que ya tiene asiento vigente no se vuelve a contabilizar. Análogo a
 * rebuildProjectLedger (src/domain/ledgerSync.ts) pero para el libro diario.
 */
export async function rebuildProjectAccounting(tx: Tx, projectId: number) {
  const skipped: string[] = [];
  let posted = 0;

  const hasAsiento = async (sourceType: string, sourceId: number) =>
    (await tx.asiento.count({ where: { sourceType, sourceId, anulaDeId: null } })) > 0;

  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      if (result) posted++;
    } catch (err: any) {
      skipped.push(`${label}: ${err?.message ?? err}`);
    }
  };

  // OC recibidas
  const orders = await tx.purchaseOrder.findMany({
    where: { projectId, status: "RECIBIDO" },
    include: { details: true },
  });
  for (const order of orders) {
    if (await hasAsiento("PurchaseOrder", order.id)) continue;
    await attempt(`OC ${order.number}`, async () => {
      const lines = await ledgerLines(tx, projectId, order.details);
      const total = lines.reduce((acc, l) => acc.plus(l.amount), toDecimal(0));
      if (total.lte(0)) return null;
      return postAsientoDesdeRegla(tx, {
        evento: EVENTO.OC_RECIBIDA,
        projectId,
        concepto: `OC ${order.number} recibida`,
        sourceType: "PurchaseOrder",
        sourceId: order.id,
        fecha: order.receivedDate ?? order.fecha,
        debe: lines.map((l) => ({ monto: l.amount, budgetItemId: l.budgetItemId })),
        haber: [{ monto: total, partnerId: order.partnerId }],
      });
    });
  }

  // Facturas recibidas imputadas sin OC ni certificado (renglones con ítem propio)
  const invoicesRecibidas = await tx.invoice.findMany({
    where: {
      projectId,
      tipo: "RECIBIDA",
      estado: { in: ["APROBADA", "PAGADA"] },
      purchaseOrderId: null,
      certificationId: null,
      certificacionId: null,
    },
    include: { items: true },
  });
  for (const inv of invoicesRecibidas) {
    if (await hasAsiento("Invoice", inv.id)) continue;
    await attempt(`Factura ${inv.numeroFactura}`, async () => {
      const items = inv.items.filter((i) => i.budgetItemId || i.insumoId);
      if (!items.length) return null;
      const total = items.reduce((acc, i) => acc.plus(toDecimal(i.subtotal)), toDecimal(0));
      if (total.lte(0)) return null;
      return postAsientoDesdeRegla(tx, {
        evento: EVENTO.FACTURA_RECIBIDA,
        projectId,
        concepto: `Factura ${inv.numeroFactura}`,
        sourceType: "Invoice",
        sourceId: inv.id,
        fecha: inv.fechaEmision,
        debe: items.map((i) => ({ monto: i.subtotal, budgetItemId: i.budgetItemId })),
        haber: [{ monto: total, partnerId: inv.partnerId }],
      });
    });
  }

  // Certificados de subcontratista certificados
  const subCerts = await tx.subcontractorCertificate.findMany({
    where: { status: { in: ["CERTIFICADO", "PAGADO", "CERRADO"] }, contract: { projectId } },
    include: { contract: true },
  });
  for (const cert of subCerts) {
    if (await hasAsiento("SubcontractorCertificate", cert.id)) continue;
    await attempt(`Certificado ${cert.number}`, () =>
      postAsientoDesdeRegla(tx, {
        evento: EVENTO.CERTIFICADO_SUBCONTRATISTA_APROBADO,
        projectId,
        concepto: `Certificado ${cert.number} / ${cert.contract.number}`,
        sourceType: "SubcontractorCertificate",
        sourceId: cert.id,
        fecha: cert.issuedAt ?? undefined,
        debe: [{ monto: cert.amount, budgetItemId: cert.contract.budgetItemId }],
        haber: [{ monto: cert.amount, partnerId: cert.contract.partnerId }],
      })
    );
  }

  // Liquidaciones de personal aprobadas
  const liquidaciones = await tx.liquidacionPersonal.findMany({
    where: { projectId, estado: "APROBADA", budgetItemId: { not: null } },
  });
  for (const liq of liquidaciones) {
    if (await hasAsiento("LiquidacionPersonal", liq.id)) continue;
    await attempt(`Liquidación ${liq.periodo} #${liq.id}`, () =>
      postAsientoDesdeRegla(tx, {
        evento: EVENTO.LIQUIDACION_APROBADA,
        projectId,
        concepto: `Liquidación ${liq.periodo} #${liq.id}`,
        sourceType: "LiquidacionPersonal",
        sourceId: liq.id,
        debe: [{ monto: liq.costoTotal, budgetItemId: liq.budgetItemId }],
        haber: [{ monto: liq.costoTotal }],
      })
    );
  }

  // Caja chica rendida
  const expensesRendidos = await tx.pettyCashExpense.findMany({
    where: { status: "RENDIDO", fund: { projectId } },
    include: { insumo: { select: { tipo: true } } },
  });
  for (const exp of expensesRendidos) {
    if (await hasAsiento("PettyCashExpense", exp.id)) continue;
    await attempt(`Caja chica ${exp.receiptNumber}`, async () => {
      const budgetItemId = exp.budgetItemId ?? (await ledgerItemFor(tx, projectId, { tipo: exp.insumo?.tipo ?? "COMUN", budgetItemId: null }));
      return postAsientoDesdeRegla(tx, {
        evento: EVENTO.CAJA_CHICA_RENDIDA,
        projectId,
        concepto: `Caja chica ${exp.receiptNumber}: ${exp.concept}`,
        sourceType: "PettyCashExpense",
        sourceId: exp.id,
        fecha: exp.date,
        debe: [{ monto: exp.amount, budgetItemId }],
        haber: [{ monto: exp.amount }],
      });
    });
  }

  // Facturas al cliente emitidas (certificado aprobado o cierre oficial)
  const facturasCliente = await tx.invoice.findMany({
    where: { projectId, tipo: "EMITIDA", estado: { not: "ANULADA" }, OR: [{ cierreId: { not: null } }, { certificationId: { not: null } }] },
  });
  for (const inv of facturasCliente) {
    if (await hasAsiento("Invoice", inv.id)) continue;
    await attempt(`Factura al cliente ${inv.numeroFactura}`, () =>
      postAsientoFacturaCliente(tx, {
        projectId,
        invoiceId: inv.id,
        numeroFactura: inv.numeroFactura,
        fecha: inv.fechaEmision,
        total: inv.total,
        iva: toDecimal(inv.montoIva10).plus(toDecimal(inv.montoIva5)),
      })
    );
  }

  // Pagos de facturas
  const payments = await tx.payment.findMany({ where: { invoice: { projectId } }, include: { invoice: true } });
  for (const pay of payments) {
    if (await hasAsiento("Payment", pay.id)) continue;
    await attempt(`Pago ${pay.referenciaBanco}`, () =>
      postAsientoDesdeRegla(tx, {
        evento: EVENTO.PAGO_FACTURA,
        projectId,
        concepto: `Pago factura ${pay.invoice.numeroFactura} — ${pay.referenciaBanco}`,
        sourceType: "Payment",
        sourceId: pay.id,
        fecha: pay.fechaPago,
        debe: [{ monto: pay.montoPagado, partnerId: pay.invoice.partnerId }],
        haber: [{ monto: pay.montoPagado }],
      })
    );
  }

  return { postedDocuments: posted, skipped };
}

/** Anula un asiento vigente con un contra-asiento de líneas invertidas. Nunca borra. */
export async function anularAsiento(
  tx: Tx,
  params: { asientoId: number; usuario?: string; concepto?: string }
) {
  const asiento = await tx.asiento.findUnique({
    where: { id: params.asientoId },
    include: { lineas: true },
  });
  if (!asiento) {
    throw new DomainError("ASIENTO_NO_EXISTE", `Asiento ${params.asientoId} no existe`, 404);
  }
  const yaAnulado = await tx.asiento.findFirst({ where: { anulaDeId: asiento.id }, include: { lineas: true } });
  if (yaAnulado) return yaAnulado;

  return tx.asiento.create({
    data: {
      projectId: asiento.projectId,
      concepto: params.concepto ?? `Anulación de asiento ${asiento.id}`,
      sourceType: asiento.sourceType,
      sourceId: asiento.sourceId,
      anulaDeId: asiento.id,
      usuario: params.usuario,
      fecha: today(),
      lineas: {
        create: asiento.lineas.map((l) => ({
          cuentaId: l.cuentaId,
          debe: l.haber,
          haber: l.debe,
          projectId: l.projectId,
          budgetItemId: l.budgetItemId,
          partnerId: l.partnerId,
        })),
      },
    },
    include: { lineas: true },
  });
}
