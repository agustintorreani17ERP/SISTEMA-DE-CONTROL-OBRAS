import type { Prisma } from "@prisma/client";

/**
 * Rubro de sistema "Gastos Generales / No imputados": todo gasto sin partida del contrato
 * (materiales sin rubro, herramientas, otros) se imputa aquí para que nunca quede fuera del
 * control. Arranca con presupuesto 0 y no se borra al reimportar.
 */
export const GENERAL_EXPENSES_ROOT_PATH = "SYS-GG";

const GG_ITEMS = [
  { code: "GG.01", name: "Materiales y consumibles sin rubro asignado" },
  { code: "GG.02", name: "Herramientas y equipos menores" },
  { code: "GG.03", name: "Otros gastos" },
];

export async function ensureGeneralExpenses(tx: Prisma.TransactionClient, projectId: number) {
  const root = await tx.budgetItem.upsert({
    where: { projectId_path: { projectId, path: GENERAL_EXPENSES_ROOT_PATH } },
    update: {},
    create: {
      projectId,
      code: "GG",
      name: "Gastos Generales / No imputados",
      category: "GASTOS GENERALES",
      path: GENERAL_EXPENSES_ROOT_PATH,
      nodeKind: "RUBRO",
      hierarchyLevel: 0,
      sortOrder: 1_000_000,
      isSystem: true,
    },
  });

  for (const [idx, item] of GG_ITEMS.entries()) {
    const path = `${GENERAL_EXPENSES_ROOT_PATH}/${item.code}`;
    await tx.budgetItem.upsert({
      where: { projectId_path: { projectId, path } },
      update: {},
      create: {
        projectId,
        code: item.code,
        name: item.name,
        category: "GASTOS GENERALES",
        unit: "gl",
        path,
        parentId: root.id,
        nodeKind: "ITEM",
        hierarchyLevel: 1,
        sortOrder: 1_000_001 + idx,
        isSystem: true,
      },
    });
  }
  await ensureDistributionPools(tx, projectId);
  return root;
}

/**
 * Rubro de sistema "Costos a distribuir": lo que la regla de imputación no permite cargar a un
 * ítem en el momento (insumos COMUNES que van al stock, TIEMPO sin ítem). El motor de costos lo
 * reparte después a los ítems; mientras tanto el costo de la obra queda completo.
 */
export const DISTRIBUTION_ROOT_PATH = "SYS-DIST";
export type DistributionPool = "STOCK" | "TIEMPO";

const POOLS: Record<DistributionPool, { code: string; name: string }> = {
  STOCK: { code: "DIST.STOCK", name: "Materiales comunes en stock de obra (a distribuir por ACU)" },
  TIEMPO: { code: "DIST.TIEMPO", name: "Equipos, personal y gastos por tiempo (a distribuir por horas)" },
};

export async function ensureDistributionPools(tx: Prisma.TransactionClient, projectId: number) {
  const root = await tx.budgetItem.upsert({
    where: { projectId_path: { projectId, path: DISTRIBUTION_ROOT_PATH } },
    update: {},
    create: {
      projectId,
      code: "DIST",
      name: "Costos a distribuir",
      category: "COSTOS A DISTRIBUIR",
      path: DISTRIBUTION_ROOT_PATH,
      nodeKind: "RUBRO",
      hierarchyLevel: 0,
      sortOrder: 1_100_000,
      isSystem: true,
    },
  });
  const ids = {} as Record<DistributionPool, number>;
  for (const [idx, [pool, item]] of (Object.entries(POOLS) as [DistributionPool, { code: string; name: string }][]).entries()) {
    const created = await tx.budgetItem.upsert({
      where: { projectId_path: { projectId, path: `${DISTRIBUTION_ROOT_PATH}/${item.code}` } },
      update: {},
      create: {
        projectId,
        code: item.code,
        name: item.name,
        category: "COSTOS A DISTRIBUIR",
        unit: "gl",
        path: `${DISTRIBUTION_ROOT_PATH}/${item.code}`,
        parentId: root.id,
        nodeKind: "ITEM",
        hierarchyLevel: 1,
        sortOrder: 1_100_001 + idx,
        isSystem: true,
      },
    });
    ids[pool] = created.id;
  }
  return ids;
}

export async function distributionPoolId(tx: Prisma.TransactionClient, projectId: number, pool: DistributionPool) {
  const existing = await tx.budgetItem.findUnique({
    where: { projectId_path: { projectId, path: `${DISTRIBUTION_ROOT_PATH}/${POOLS[pool].code}` } },
    select: { id: true },
  });
  return existing?.id ?? (await ensureDistributionPools(tx, projectId))[pool];
}
