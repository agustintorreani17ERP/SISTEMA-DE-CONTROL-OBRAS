import type { Prisma } from "@prisma/client";
import { postCost, postMovement, rebuildItemCache } from "./budget";
import { recalculateProjectFinancials } from "./projectFinancials";
import { toDecimal } from "../lib/money";

type Tx = Prisma.TransactionClient;

/**
 * Registra en el libro mayor los documentos confirmados que todavía no tienen movimientos
 * (datos anteriores al libro mayor) y recalcula el caché de las partidas. Es idempotente:
 * un documento que ya tiene movimientos no se vuelve a registrar.
 */
export async function rebuildProjectLedger(tx: Tx, projectId: number) {
  const skipped: string[] = [];
  let posted = 0;

  const hasMovements = async (sourceType: string, sourceId: number) =>
    (await tx.budgetMovement.count({ where: { sourceType, sourceId } })) > 0;

  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      posted++;
    } catch (err: any) {
      skipped.push(`${label}: ${err?.message ?? err}`);
    }
  };

  // Órdenes de compra emitidas o recibidas
  const orders = await tx.purchaseOrder.findMany({
    where: { projectId, status: { in: ["EMITIDA", "RECIBIDO"] } },
    include: { details: true },
  });
  for (const order of orders) {
    if (await hasMovements("PurchaseOrder", order.id)) continue;
    const byItem = new Map<number, ReturnType<typeof toDecimal>>();
    for (const d of order.details) {
      byItem.set(d.budgetItemId, (byItem.get(d.budgetItemId) ?? toDecimal(0)).plus(d.subtotal));
    }
    for (const [budgetItemId, amount] of byItem) {
      const base = {
        projectId,
        budgetItemId,
        amount,
        source: "PURCHASE_ORDER" as const,
        sourceType: "PurchaseOrder",
        sourceId: order.id,
        sourceNumber: order.number,
        note: "Sincronización de datos existentes",
      };
      await attempt(`OC ${order.number}`, async () => {
        await postMovement(tx, { ...base, stage: "COMMITTED" });
        if (order.status === "RECIBIDO") await postMovement(tx, { ...base, stage: "ACTUAL" });
      });
    }
  }

  // Certificados (medición avanzada) aprobados
  const certifications = await tx.certification.findMany({
    where: { projectId, estado: "APROBADO" },
    include: { items: true },
  });
  for (const cert of certifications) {
    if (await hasMovements("Certification", cert.id)) continue;
    for (const item of cert.items) {
      const base = {
        projectId,
        budgetItemId: item.budgetItemId,
        amount: item.montoTotal,
        quantity: item.cantidadPresente,
        sourceType: "Certification",
        sourceId: cert.id,
        sourceNumber: `CERT-${String(cert.numero).padStart(2, "0")}`,
      };
      await attempt(`Certificado ${cert.numero}`, () =>
        cert.partnerId
          ? postCost(tx, { ...base, source: "SUBCONTRACT" })
          : postMovement(tx, { ...base, source: "CLIENT_CERTIFICATE", stage: "ACTUAL" })
      );
    }
  }

  // Certificados de subcontratista certificados
  const subCerts = await tx.subcontractorCertificate.findMany({
    where: { status: { in: ["CERTIFICADO", "PAGADO", "CERRADO"] }, contract: { projectId } },
    include: { contract: true },
  });
  for (const cert of subCerts) {
    if (await hasMovements("SubcontractorCertificate", cert.id)) continue;
    await attempt(`Certificado ${cert.number}`, () =>
      postCost(tx, {
        projectId,
        budgetItemId: cert.contract.budgetItemId,
        amount: cert.amount,
        quantity: cert.quantity,
        source: "SUBCONTRACT",
        sourceType: "SubcontractorCertificate",
        sourceId: cert.id,
        sourceNumber: `${cert.number} / ${cert.contract.number}`,
      })
    );
  }

  // Actas legado aprobadas
  const actas = await tx.certificacion.findMany({
    where: { projectId, estado: { in: ["APROBADA", "PAGADA"] }, budgetItemId: { not: null } },
  });
  for (const acta of actas) {
    if (!acta.budgetItemId || (await hasMovements("Certificacion", acta.id))) continue;
    const base = {
      projectId,
      budgetItemId: acta.budgetItemId,
      amount: acta.monto_total,
      quantity: acta.cantidad_medida,
      sourceType: "Certificacion",
      sourceId: acta.id,
      sourceNumber: `ACTA-${acta.id}`,
    };
    await attempt(`Acta ${acta.id}`, () =>
      acta.partnerId
        ? postCost(tx, { ...base, source: "SUBCONTRACT" })
        : postMovement(tx, { ...base, source: "CLIENT_CERTIFICATE", stage: "ACTUAL" })
    );
  }

  // Caja chica no rechazada
  const expenses = await tx.pettyCashExpense.findMany({
    where: { status: { not: "RECHAZADO" }, fund: { projectId } },
  });
  for (const exp of expenses) {
    if (await hasMovements("PettyCashExpense", exp.id)) continue;
    await attempt(`Caja chica ${exp.receiptNumber}`, () =>
      postCost(tx, {
        projectId,
        budgetItemId: exp.budgetItemId,
        amount: exp.amount,
        source: "PETTY_CASH",
        sourceType: "PettyCashExpense",
        sourceId: exp.id,
        sourceNumber: exp.receiptNumber,
      })
    );
  }

  const cache = await rebuildItemCache(tx, projectId);
  await recalculateProjectFinancials(tx, projectId);
  return { postedDocuments: posted, skipped, ...cache };
}
