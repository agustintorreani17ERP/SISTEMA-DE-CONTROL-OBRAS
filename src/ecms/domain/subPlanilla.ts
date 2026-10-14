import { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { numeroLinea, siguienteCorrelativo } from "./asignacionMO";

type Tx = Prisma.TransactionClient;

export interface LineaInput {
  planillaLineaId?: number | null;
  workFrontId: number;
  laborPriceId: number;
  budgetItemId: number | null;
}

/**
 * Línea de la planilla del subcontratista para frente + rubro MO + rubro presupuestario.
 * La misma combinación reutiliza su línea (y su número) en todos los certificados. Una línea
 * que estaba sin rubro conserva su número al asignarse, salvo que la combinación ya exista.
 */
export async function resolverLinea(tx: Tx, projectId: number, partnerId: number, input: LineaInput) {
  const front = await tx.workFront.findUnique({ where: { id: input.workFrontId } });
  if (!front || front.projectId !== projectId) throw new NotFoundError("Frente", input.workFrontId);
  const lp = await tx.laborPrice.findUnique({ where: { id: input.laborPriceId } });
  if (!lp || lp.projectId !== projectId) throw new NotFoundError("Rubro de la lista de MO", input.laborPriceId);

  const key = { partnerId, workFrontId: front.id, laborPriceId: lp.id };

  const existing = await tx.subPlanillaLinea.findFirst({ where: { ...key, budgetItemId: input.budgetItemId } });
  if (existing) return existing;

  if (input.planillaLineaId) {
    const previa = await tx.subPlanillaLinea.findUnique({ where: { id: input.planillaLineaId } });
    if (previa && previa.partnerId === partnerId && previa.workFrontId === front.id && previa.laborPriceId === lp.id && previa.budgetItemId === null) {
      return tx.subPlanillaLinea.update({ where: { id: previa.id }, data: { budgetItemId: input.budgetItemId } });
    }
  }

  const usados = await tx.subPlanillaLinea.findMany({ where: { partnerId, workFrontId: front.id }, select: { correlativo: true } });
  const correlativo = siguienteCorrelativo(usados.map((u) => u.correlativo));
  return tx.subPlanillaLinea.create({
    data: {
      projectId,
      ...key,
      budgetItemId: input.budgetItemId,
      correlativo,
      numero: numeroLinea(front.codigo ?? String(front.id), correlativo),
    },
  });
}

/** Borra las líneas sin rubro del contratista que quedaron sin uso (borrador editado). */
export async function limpiarLineasHuerfanas(tx: Tx, partnerId: number) {
  await tx.subPlanillaLinea.deleteMany({ where: { partnerId, budgetItemId: null, items: { none: {} } } });
}

export function assertSinLineasPendientes(numeros: string[], mensaje: string) {
  if (numeros.length) throw new DomainError("LINEAS_SIN_RUBRO", mensaje, 422, numeros);
}
