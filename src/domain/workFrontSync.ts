import { Prisma } from "@prisma/client";

/**
 * Sincroniza los frentes de trabajo (WorkFront) con las Áreas del presupuesto (rubros raíz,
 * no de sistema). Se llama cada vez que cambia el árbol de partidas, junto a
 * recalculateProjectFinancials: crea el frente que falte, renombra el que cambió de nombre
 * y limpia (o desvincula si está en uso) el que quedó sin Área.
 */
export async function syncWorkFrontsFromAreas(tx: Prisma.TransactionClient, projectId: number) {
  const areas = await tx.budgetItem.findMany({
    where: { projectId, parentId: null, nodeKind: { not: "ITEM" }, isSystem: false },
    select: { id: true, name: true },
  });

  const linked = await tx.workFront.findMany({
    where: { projectId, budgetItemId: { not: null } },
    select: { id: true, name: true, budgetItemId: true },
  });
  const byBudgetItemId = new Map(linked.map((w) => [w.budgetItemId as number, w]));

  for (const area of areas) {
    const front = byBudgetItemId.get(area.id);
    if (!front) {
      await tx.workFront.create({ data: { projectId, name: area.name, budgetItemId: area.id } });
    } else {
      byBudgetItemId.delete(area.id);
      if (front.name !== area.name) {
        await tx.workFront.update({ where: { id: front.id }, data: { name: area.name } });
      }
    }
  }

  // Frentes autogenerados cuya Área ya no existe (rubro raíz borrado).
  for (const orphan of byBudgetItemId.values()) {
    const [requests, partes] = await Promise.all([
      tx.materialRequest.count({ where: { workFrontId: orphan.id } }),
      tx.parteDiario.count({ where: { workFrontId: orphan.id } }),
    ]);
    if (requests || partes) {
      await tx.workFront.update({ where: { id: orphan.id }, data: { budgetItemId: null } });
    } else {
      await tx.workFront.delete({ where: { id: orphan.id } });
    }
  }
}
