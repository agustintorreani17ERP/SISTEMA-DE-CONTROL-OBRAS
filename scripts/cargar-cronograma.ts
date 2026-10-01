/**
 * Carga el cronograma (avance planificado) desde un archivo de texto, sin pasar por la pantalla.
 *
 *   npx tsx scripts/cargar-cronograma.ts <idObra> <archivo.txt> [REEMPLAZAR|COMBINAR]
 *
 * El archivo es el mismo formato que se pega en Centro de Costos → Avance → Cronograma:
 * primera fila con los períodos, primera columna la ruta (o el código si es único) del ítem.
 * IMPORTANTE: con el almacenamiento simulado (mock-db-store.json) frená el servidor antes de correrlo
 * y volvé a iniciarlo después, si no el servidor pisa lo que se guardó.
 */
import fs from "fs";
import { prisma } from "../src/lib/prisma";
import { parsePlanGrid } from "../src/domain/planImport";
import { guardarPlan } from "../src/domain/planSave";
import { audit } from "../src/domain/audit";
import { moneyNumber } from "../src/lib/money";

async function main() {
  const [idArg, file, modoArg] = process.argv.slice(2);
  const projectId = Number(idArg);
  const modo = (modoArg ?? "REEMPLAZAR").toUpperCase() as "REEMPLAZAR" | "COMBINAR";
  if (!projectId || !file || !["REEMPLAZAR", "COMBINAR"].includes(modo)) {
    console.error("Uso: npx tsx scripts/cargar-cronograma.ts <idObra> <archivo.txt> [REEMPLAZAR|COMBINAR]");
    process.exit(1);
  }
  const project = await prisma.project.findFirst({ where: { id: projectId } });
  if (!project) throw new Error(`No existe la obra ${projectId}`);

  const items = await prisma.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM", isSystem: false },
    select: { id: true, code: true, path: true, totalQuantity: true },
  });
  const r = parsePlanGrid(
    fs.readFileSync(file, "utf8"),
    items.map((i) => ({ id: i.id, code: i.code, path: i.path, contrato: moneyNumber(i.totalQuantity) }))
  );
  const validas = r.filas.filter((f) => !f.error && f.budgetItemId);
  const conError = r.filas.filter((f) => f.error);
  console.log(`Obra ${projectId} (${project.name}) · ${items.length} ítems en el presupuesto`);
  console.log(`Períodos: ${r.periodos.length} (${r.periodos[0]} → ${r.periodos[r.periodos.length - 1]}) · valores válidos: ${validas.length} · con error: ${conError.length}`);
  r.errores.forEach((e) => console.log("  aviso:", e));
  conError.slice(0, 10).forEach((f) => console.log(`  fila ${f.fila} ${f.codigo}: ${f.error}`));
  if (!validas.length) throw new Error("No hay valores válidos para guardar");

  const n = await prisma.$transaction(
    async (tx) => {
      const guardados = await guardarPlan(tx, projectId, modo, validas.map((f) => ({ budgetItemId: f.budgetItemId!, fecha: f.fecha, cantidad: f.cantidad })));
      await audit(tx, { entity: "AvancePlanificado", entityId: projectId, action: modo, payload: { lineas: guardados, origen: "script" } });
      return guardados;
    },
    { timeout: 120_000 }
  );
  console.log(`✔ Cronograma guardado: ${n} valores (${modo}).`);
}

main()
  .catch((e) => {
    console.error("✘", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
