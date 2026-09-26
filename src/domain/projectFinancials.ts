import { Prisma } from "@prisma/client";
import { toDecimal } from "../lib/money";

/**
 * Consolida los montos de la obra a partir de las partidas hoja (ITEM) y del caché del
 * libro mayor. Rubros y subrubros no se suman: su monto es la suma de sus hijos.
 */
export async function recalculateProjectFinancials(tx: Prisma.TransactionClient, projectId: number) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) return null;

  const leaves = await tx.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM" },
    select: { originalAmount: true, costActualAmount: true },
  });

  const base = leaves.reduce((sum, item) => sum.plus(toDecimal(item.originalAmount)), new Prisma.Decimal(0));
  const spent = leaves.reduce((sum, item) => sum.plus(toDecimal(item.costActualAmount)), new Prisma.Decimal(0));

  const adendas = await tx.certificacion.aggregate({
    where: { projectId, esAdenda: true, estado: { not: "RECHAZADA" } },
    _sum: { monto_total: true },
  });
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
