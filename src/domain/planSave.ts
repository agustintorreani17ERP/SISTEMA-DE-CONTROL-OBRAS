import type { Prisma } from "@prisma/client";
import { toDay } from "./prices";

export interface PlanLinea {
  budgetItemId: number;
  fecha: string; // AAAA-MM-DD
  cantidad: number;
}

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * Guarda el cronograma (avance planificado) en bloque: una sola pasada, sin un upsert por celda.
 * REEMPLAZAR borra el cronograma anterior de la obra; COMBINAR solo pisa los ítem+período cargados.
 * Cantidad 0 = borrar ese período. Devuelve cuántos valores quedaron guardados.
 */
export async function guardarPlan(
  tx: Prisma.TransactionClient,
  projectId: number,
  modo: "REEMPLAZAR" | "COMBINAR",
  lineas: PlanLinea[]
): Promise<number> {
  const nuevas = new Map<string, PlanLinea>();
  for (const l of lineas) nuevas.set(`${l.budgetItemId}|${l.fecha}`, l);

  if (modo === "REEMPLAZAR") {
    await tx.avancePlanificado.deleteMany({ where: { projectId } });
  } else {
    const ids = [...new Set(lineas.map((l) => l.budgetItemId))];
    const existentes = await tx.avancePlanificado.findMany({
      where: { projectId, budgetItemId: { in: ids } },
      select: { id: true, budgetItemId: true, fecha: true },
    });
    const pisar = existentes.filter((e) => nuevas.has(`${e.budgetItemId}|${day(e.fecha)}`)).map((e) => e.id);
    if (pisar.length) await tx.avancePlanificado.deleteMany({ where: { id: { in: pisar } } });
  }

  const data = [...nuevas.values()]
    .filter((l) => l.cantidad > 0)
    .map((l) => ({ projectId, budgetItemId: l.budgetItemId, fecha: toDay(l.fecha), cantidad: l.cantidad }));
  if (data.length) await tx.avancePlanificado.createMany({ data });
  return data.length;
}
