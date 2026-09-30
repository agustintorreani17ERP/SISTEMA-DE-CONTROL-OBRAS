/**
 * Genera los asientos contables que falten para los documentos ya confirmados de todas las
 * obras (equivalente a rebuildProjectLedger para el libro mayor, pero para el libro diario).
 * Idempotente: un documento que ya tiene asiento vigente no se vuelve a contabilizar.
 *
 *   npx tsx prisma/scripts/rebuild-contabilidad.ts             # todas las obras
 *   npx tsx prisma/scripts/rebuild-contabilidad.ts --obra 3     # una sola obra
 */
import { PrismaClient } from "@prisma/client";
import { rebuildProjectAccounting } from "../../src/domain/contabilidad";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const obraId = arg("--obra") ? Number(arg("--obra")) : undefined;
  const projects = await prisma.project.findMany({
    where: obraId ? { id: obraId } : undefined,
    select: { id: true, code: true, name: true },
  });

  for (const p of projects) {
    const result = await prisma.$transaction((tx) => rebuildProjectAccounting(tx, p.id), { timeout: 120_000 });
    console.log(`${p.code} — ${p.name}: ${result.postedDocuments} asiento(s) generado(s)`);
    if (result.skipped.length) {
      console.log(`  omitidos (${result.skipped.length}):`);
      for (const s of result.skipped) console.log(`    - ${s}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
