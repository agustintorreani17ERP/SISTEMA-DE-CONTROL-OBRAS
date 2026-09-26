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
  return root;
}
