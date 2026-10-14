import { Prisma } from "@prisma/client";

/**
 * Nombre y código del frente a partir del nombre del Área:
 * "Área: 2) BLOQUE 6 - AULAS" → { codigo: "2", nombre: "BLOQUE 6 - AULAS" }.
 * Sin número, el código queda null y el nombre es el del Área sin el prefijo.
 */
export function areaFrontName(areaName: string): { codigo: string | null; nombre: string } {
  const sinPrefijo = areaName.replace(/^\s*[aá]rea\s*:?\s*/i, "");
  const m = sinPrefijo.match(/^(\d+)\s*[).]\s*(.*)$/);
  if (!m) return { codigo: null, nombre: sinPrefijo.trim() || areaName.trim() };
  return { codigo: m[1], nombre: m[2].trim() || areaName.trim() };
}

/** Código del próximo frente auxiliar: el mayor código numérico de la obra + 1 (24 áreas → 25). */
export function nextAuxiliaryCode(codigos: (string | null | undefined)[]): string {
  const nums = codigos.map((c) => Number(c)).filter((n) => Number.isInteger(n) && n >= 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

export interface WorkFrontSyncResult {
  creados: number;
  actualizados: number;
  desvinculados: number;
  borrados: number;
}

/**
 * Sincroniza los frentes de trabajo (WorkFront) con las Áreas del presupuesto (rubros raíz,
 * no de sistema). Se llama cada vez que cambia el árbol de partidas, junto a
 * recalculateProjectFinancials: crea el frente que falte, actualiza nombre/código/orden del que
 * cambió y limpia (o desvincula si está en uso) el que quedó sin Área. Los frentes AUXILIAR
 * (alta manual) no se tocan.
 */
export async function syncWorkFrontsFromAreas(
  tx: Prisma.TransactionClient,
  projectId: number
): Promise<WorkFrontSyncResult> {
  const result: WorkFrontSyncResult = { creados: 0, actualizados: 0, desvinculados: 0, borrados: 0 };
  const areas = await tx.budgetItem.findMany({
    where: { projectId, parentId: null, nodeKind: { not: "ITEM" }, isSystem: false },
    select: { id: true, name: true, sortOrder: true },
  });

  const linked = await tx.workFront.findMany({
    where: { projectId, budgetItemId: { not: null } },
    select: { id: true, name: true, codigo: true, orden: true, tipo: true, budgetItemId: true },
  });
  const byBudgetItemId = new Map(linked.map((w) => [w.budgetItemId as number, w]));

  for (const area of areas) {
    const { codigo, nombre } = areaFrontName(area.name);
    const data = { name: nombre, codigo, orden: area.sortOrder ?? 0, tipo: "AREA" as const };
    const front = byBudgetItemId.get(area.id);
    if (!front) {
      await tx.workFront.create({ data: { projectId, budgetItemId: area.id, ...data } });
      result.creados++;
    } else {
      byBudgetItemId.delete(area.id);
      if (front.name !== data.name || front.codigo !== data.codigo || front.orden !== data.orden || front.tipo !== "AREA") {
        await tx.workFront.update({ where: { id: front.id }, data });
        result.actualizados++;
      }
    }
  }

  // Frentes autogenerados cuya Área ya no existe (rubro raíz borrado).
  for (const orphan of byBudgetItemId.values()) {
    const [requests, partes, lineas] = await Promise.all([
      tx.materialRequest.count({ where: { workFrontId: orphan.id } }),
      tx.parteDiario.count({ where: { workFrontId: orphan.id } }),
      tx.subPlanillaLinea.count({ where: { workFrontId: orphan.id } }),
    ]);
    if (requests || partes || lineas) {
      await tx.workFront.update({ where: { id: orphan.id }, data: { budgetItemId: null, tipo: "AUXILIAR" } });
      result.desvinculados++;
    } else {
      await tx.workFront.delete({ where: { id: orphan.id } });
      result.borrados++;
    }
  }
  return result;
}
