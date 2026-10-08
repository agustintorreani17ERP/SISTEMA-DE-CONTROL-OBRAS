/**
 * Sincroniza los frentes de trabajo con las Áreas del presupuesto en todas las obras.
 *
 *   npx tsx scripts/sync-frentes.ts
 *
 * Crea el frente de cada Área (código = número del Área, nombre sin "Área: N)"), actualiza los
 * existentes y deja intactos los frentes auxiliares.
 * IMPORTANTE: con el almacenamiento simulado (mock-db-store.json) frená el servidor antes de correrlo
 * y volvé a iniciarlo después, si no el servidor pisa lo que se guardó.
 */
import { prisma } from "../src/lib/prisma";
import { syncWorkFrontsFromAreas } from "../src/domain/workFrontSync";

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  for (const p of projects) {
    // Frentes manuales anteriores al campo tipo: se marcan auxiliares con su código.
    const sinTipo = await prisma.workFront.findMany({ where: { projectId: p.id, budgetItemId: null } });
    const r = await prisma.$transaction((tx) => syncWorkFrontsFromAreas(tx, p.id));
    const frentes = await prisma.workFront.findMany({ where: { projectId: p.id }, select: { codigo: true } });
    let next = Math.max(0, ...frentes.map((f) => Number(f.codigo)).filter((n) => Number.isInteger(n)));
    for (const f of sinTipo) {
      if (f.tipo === "AUXILIAR" && f.codigo) continue;
      const codigo = f.codigo ?? String(++next);
      await prisma.workFront.update({ where: { id: f.id }, data: { tipo: "AUXILIAR", codigo, orden: Number(codigo) || 0 } });
    }
    console.log(
      `Obra ${p.id} (${p.name}): ${r.creados} creados · ${r.actualizados} actualizados · ${r.desvinculados} desvinculados · ${r.borrados} borrados`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
