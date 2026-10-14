import { Prisma } from "@prisma/client";
import { toDecimal } from "../../lib/money";

/**
 * Consolida los montos de la obra a partir de las partidas hoja (ITEM) y del caché del
 * libro mayor. Rubros y subrubros no se suman: su monto es la suma de sus hijos.
 * Base = contrato original congelado; real = presupuesto vigente (base ± adendas aprobadas).
 */
export async function recalculateProjectFinancials(tx: Prisma.TransactionClient, projectId: number) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) return null;

  const leaves = await tx.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM" },
    select: { originalAmount: true, contractAmount: true, costActualAmount: true },
  });

  // originalAmount es el monto VIGENTE (contrato ± adendas aprobadas); contractAmount es el contrato congelado.
  const real = leaves.reduce((sum, item) => sum.plus(toDecimal(item.originalAmount)), new Prisma.Decimal(0));
  const contrato = leaves.reduce((sum, item) => sum.plus(toDecimal(item.contractAmount)), new Prisma.Decimal(0));
  const base = project.presupuestoCongeladoAt ? contrato : real;
  const spent = leaves.reduce((sum, item) => sum.plus(toDecimal(item.costActualAmount)), new Prisma.Decimal(0));

  return tx.project.update({
    where: { id: projectId },
    data: {
      montoPresupuestoBase: base,
      montoRealActualizado: real,
      totalGastado: spent,
    },
  });
}
