import { Prisma } from "@prisma/client";
import { toDecimal } from "../lib/money";

export async function recalculateProjectFinancials(
  tx: Prisma.TransactionClient,
  projectId: number
) {
  const [project, budgetItems, purchaseOrders, subcontractorCertificates] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId } }),
    tx.budgetItem.findMany({ where: { projectId: projectId } }),
    tx.purchaseOrder.findMany({
      where: { projectId, status: { in: ["EMITIDA", "RECIBIDO"] } },
      select: { totalAmount: true },
    }),
    tx.subcontractorCertificate.findMany({
      where: { contract: { projectId }, status: "PAGADO" },
      select: { amount: true },
    }),
  ]);

  if (!project) return null;

  const base = budgetItems.reduce((sum, item) => sum.plus(toDecimal(item.originalAmount)), new Prisma.Decimal(0));
  const adendas = await tx.certificacion.aggregate({
    where: { projectId, esAdenda: true, estado: { not: "RECHAZADA" } },
    _sum: { monto_total: true },
  });
  const spent = purchaseOrders
    .reduce((sum, order) => sum.plus(toDecimal(order.totalAmount)), new Prisma.Decimal(0))
    .plus(subcontractorCertificates.reduce((sum, certificate) => sum.plus(toDecimal(certificate.amount)), new Prisma.Decimal(0)));
  const real = base.plus(toDecimal(adendas?._sum?.monto_total ?? 0));

  return tx.project.update({
    where: { id: projectId },
    data: {
      montoPresupuestoBase: base,
      montoRealActualizado: real,
      totalGastado: spent,
    },
  });
}
