/**
 * Genera la SubPlanillaLinea de cada ítem de certificado de subcontratista que todavía no la tiene.
 *
 *   npx tsx scripts/migrar-planilla-sub.ts
 *
 * Frente = el del Área del rubro presupuestario. Rubro de la lista de MO = el del insumo del ítem
 * (MO-<código>), o el de la lista con el mismo código del rubro, o el que estaba asociado al rubro
 * (legado). Se numeran por (contratista, frente) en el orden de los certificados. Lo que no se pueda
 * asociar se informa y queda sin línea.
 * Correr antes scripts/sync-frentes.ts para que existan los frentes de las Áreas.
 */
import { prisma } from "../src/lib/prisma";
import { resolverLinea } from "../src/domain/subPlanilla";

async function main() {
  const items = await prisma.certificationItem.findMany({
    where: { planillaLineaId: null, certification: { partnerId: { not: null } } },
    include: { certification: true, budgetItem: true, insumo: true },
    orderBy: [{ certification: { numero: "asc" } }, { id: "asc" }],
  });
  const projectIds = [...new Set(items.map((i) => i.certification.projectId))];
  const nodos = await prisma.budgetItem.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, parentId: true } });
  const parent = new Map(nodos.map((n) => [n.id, n.parentId]));
  const areaOf = (id: number) => {
    let cur = id;
    for (let g = 0; g < 50 && parent.get(cur) != null; g++) cur = parent.get(cur) as number;
    return cur;
  };

  let ok = 0;
  const sinAsociar: string[] = [];
  for (const it of items) {
    const projectId = it.certification.projectId;
    const ref = `Cert ${it.certification.numero} (id ${it.certification.id}) ítem ${it.id}`;
    if (!it.budgetItemId || !it.budgetItem) {
      sinAsociar.push(`${ref}: sin rubro presupuestario`);
      continue;
    }
    const front = await prisma.workFront.findFirst({ where: { projectId, budgetItemId: areaOf(it.budgetItemId) } });
    const codeFromInsumo = it.insumo?.code.startsWith("MO-") ? it.insumo.code.slice(3) : null;
    const lp =
      (codeFromInsumo && (await prisma.laborPrice.findUnique({ where: { projectId_code: { projectId, code: codeFromInsumo } } }))) ||
      (await prisma.laborPrice.findUnique({ where: { projectId_code: { projectId, code: it.budgetItem.code } } })) ||
      (await prisma.laborPrice.findFirst({ where: { projectId, budgetItemId: it.budgetItemId } }));
    if (!front || !lp) {
      sinAsociar.push(`${ref} ${it.budgetItem.code} ${it.budgetItem.name}: ${!front ? "sin frente del Área" : "sin rubro en la lista de MO"}`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const linea = await resolverLinea(tx, projectId, it.certification.partnerId as number, {
        workFrontId: front.id,
        laborPriceId: lp.id,
        budgetItemId: it.budgetItemId,
      });
      await tx.certificationItem.update({ where: { id: it.id }, data: { planillaLineaId: linea.id } });
    });
    ok++;
  }
  console.log(`${ok} ítems con línea de planilla · ${sinAsociar.length} sin asociar`);
  for (const s of sinAsociar) console.log(`  - ${s}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
