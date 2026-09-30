/**
 * Migración de compras y stock a la regla de imputación (DIRECTO / COMÚN / TIEMPO).
 *
 * Pasos (en orden; ninguno toca el libro mayor ya asentado):
 *   1. npx tsx prisma/scripts/migrar-imputacion.ts --fechas
 *        Solo si la base se actualizó con `db push`: completa las fechas nuevas con la fecha real de
 *        cada documento (db push les pone la de hoy). Con la SQL de prisma/sql/ no hace falta.
 *   2. npx tsx prisma/scripts/migrar-imputacion.ts
 *        Reporte (solo lectura): clasifica los insumos que hoy tienen rubro asignado y escribe
 *        prisma/scripts/out/clasificacion_insumos.csv con un tipo sugerido.
 *   3. Revisar el CSV y corregir la columna tipo_final.
 *   4. npx tsx prisma/scripts/migrar-imputacion.ts --aplicar-tipos prisma/scripts/out/clasificacion_insumos.csv
 *        Fija el tipo de cada insumo y adapta las OC que todavía no descontaron presupuesto.
 *   5. npx tsx prisma/scripts/migrar-imputacion.ts --conciliar-stock --fecha 2026-09-30
 *        Si el stock guardado no coincide con la suma de movimientos, registra un ajuste
 *        "Saldo inicial (migración)" con esa fecha para que el libro de stock lo explique.
 */
import { InsumoTipo, PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { refreshStockCache } from "../../src/domain/stock";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const OUT = join(__dirname, "out", "clasificacion_insumos.csv");

const DIRECTO_RE = /hormig|h[°º]\s?a|\bh-?\s?\d{2}\b|fck|acero|varilla|hierro|malla|barra|premoldead|pilote|viga\s+pref/i;

function sugerir(m: { description: string; categoria: string }, itemsDistintos: number): { tipo: InsumoTipo; motivo: string } {
  if (m.categoria === "MANO_OBRA") return { tipo: "DIRECTO", motivo: "Mano de obra de contratista: viene con el ítem en el certificado" };
  if (m.categoria === "EQUIPO") return { tipo: "TIEMPO", motivo: "Equipo: se reparte por horas del parte diario" };
  if (DIRECTO_RE.test(m.description)) return { tipo: "DIRECTO", motivo: "Hormigón / acero / premoldeado: se controla por remito o planilla" };
  if (itemsDistintos > 1) return { tipo: "COMUN", motivo: `Se usó en ${itemsDistintos} ítems distintos: va al stock y se reparte por ACU` };
  return { tipo: "COMUN", motivo: "Material de uso general: revisar si siempre va a un único ítem" };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function reporte() {
  const [reqLines, poLines] = await Promise.all([
    prisma.materialRequestDetail.findMany({
      where: { budgetItemId: { not: null } },
      select: { materialId: true, budgetItemId: true, request: { select: { projectId: true, status: true } } },
    }),
    prisma.purchaseOrderDetail.findMany({
      where: { budgetItemId: { not: null } },
      select: { materialId: true, budgetItemId: true, subtotal: true, order: { select: { projectId: true, status: true } } },
    }),
  ]);
  const ids = [...new Set([...reqLines, ...poLines].map((l) => l.materialId))];
  const materials = await prisma.material.findMany({ where: { id: { in: ids } }, orderBy: { code: "asc" } });

  const rows = materials.map((m) => {
    const lines = [...reqLines.filter((l) => l.materialId === m.id), ...poLines.filter((l) => l.materialId === m.id)];
    const items = new Set(lines.map((l) => l.budgetItemId));
    const obras = new Set([...reqLines.filter((l) => l.materialId === m.id).map((l) => l.request.projectId), ...poLines.filter((l) => l.materialId === m.id).map((l) => l.order.projectId)]);
    const monto = poLines.filter((l) => l.materialId === m.id && l.order.status !== "ANULADO").reduce((a, l) => a + Number(l.subtotal), 0);
    const s = sugerir(m, items.size);
    return { m, lineas: lines.length, items: items.size, obras: obras.size, monto, ...s };
  });

  mkdirSync(dirname(OUT), { recursive: true });
  const header = "id;codigo;descripcion;unidad;categoria;tipo_actual;tipo_sugerido;motivo;lineas_con_rubro;items_distintos;obras;monto_oc_gs;tipo_final";
  writeFileSync(
    OUT,
    "﻿" +
      [
        header,
        ...rows.map((r) =>
          [r.m.id, r.m.code, r.m.description, r.m.unit, r.m.categoria, r.m.tipo, r.tipo, r.motivo, r.lineas, r.items, r.obras, Math.round(r.monto), r.tipo]
            .map(csvCell)
            .join(";")
        ),
      ].join("\n")
  );

  const abiertasOC = await prisma.purchaseOrder.count({ where: { status: { in: ["BORRADOR", "APROBADO_PARA_COMPRA"] } } });
  const emitidas = await prisma.purchaseOrder.count({ where: { status: "EMITIDA" } });
  const recibidas = await prisma.purchaseOrder.count({ where: { status: "RECIBIDO" } });
  const pedidosAbiertos = await prisma.materialRequest.count({ where: { status: { in: ["BORRADOR", "APROBADO_PARA_COMPRA"] } } });

  const stock = await prisma.warehouseStock.findMany();
  let descuadres = 0;
  for (const s of stock) {
    const agg = await prisma.stockMovement.aggregate({ where: { projectId: s.projectId, materialId: s.materialId }, _sum: { quantity: true } });
    if (Math.abs(Number(s.quantityOnHand) - Number(agg._sum.quantity ?? 0)) > 0.0001) descuadres++;
  }

  const cuenta = (t: InsumoTipo) => rows.filter((r) => r.tipo === t).length;
  console.log(`
Insumos con rubro asignado en pedidos u OC: ${rows.length}
  sugeridos DIRECTO ${cuenta("DIRECTO")} · COMÚN ${cuenta("COMUN")} · TIEMPO ${cuenta("TIEMPO")}
  → ${OUT}

Qué pasa con cada documento al aplicar los tipos:
  OC recibidas (${recibidas}) y emitidas (${emitidas}): NO cambian. Su compromiso y su costo ya están en el
    ítem del libro mayor y quedan como historia anterior al corte. Sus líneas quedan como DIRECTO: una
    emitida, al recibirse, carga el costo al mismo ítem y registra entrada + salida directa de stock.
  OC en borrador o aprobadas (${abiertasOC}): todavía no descontaron nada. Sus líneas toman el tipo nuevo;
    las de insumos COMUNES pierden el ítem y al emitirse van a "Costos a distribuir › stock de obra".
  Pedidos abiertos (${pedidosAbiertos}): el rubro de las líneas COMUNES se conserva como referencia pero la OC lo ignora.

Stock: ${descuadres} saldo(s) guardados no coinciden con la suma de movimientos (paso --conciliar-stock).
`);
}

async function aplicarTipos(file: string) {
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(";");
  const iId = header.indexOf("id");
  const iTipo = header.indexOf("tipo_final");
  if (iId < 0 || iTipo < 0) throw new Error("El CSV necesita las columnas id y tipo_final");
  const tipos = new Map<number, InsumoTipo>();
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^;]*)(;|$)/g)!.map((c) => c.replace(/;$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    const tipo = cells[iTipo]?.trim().toUpperCase().replace("Ú", "U") as InsumoTipo;
    if (!["DIRECTO", "COMUN", "TIEMPO"].includes(tipo)) throw new Error(`Tipo inválido "${cells[iTipo]}" para el insumo ${cells[iId]}`);
    tipos.set(Number(cells[iId]), tipo);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      let insumos = 0;
      let lineasOC = 0;
      for (const [id, tipo] of tipos) {
        await tx.material.update({ where: { id }, data: { tipo } });
        insumos++;
        // Solo OC que todavía no asentaron nada en el libro mayor.
        const r = await tx.purchaseOrderDetail.updateMany({
          where: { materialId: id, order: { status: { in: ["BORRADOR", "APROBADO_PARA_COMPRA"] } } },
          data: tipo === "COMUN" ? { tipo, budgetItemId: null } : { tipo },
        });
        lineasOC += r.count;
      }
      return { insumos, lineasOC };
    },
    { timeout: 120_000 }
  );
  console.log(`Tipos aplicados a ${result.insumos} insumos; ${result.lineasOC} líneas de OC abiertas actualizadas.`);
}

async function conciliarStock(fecha: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Indicá --fecha AAAA-MM-DD");
  const day = new Date(`${fecha}T00:00:00Z`);
  const stock = await prisma.warehouseStock.findMany({ include: { material: { select: { code: true } } } });
  let n = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const s of stock) {
        const agg = await tx.stockMovement.aggregate({ where: { projectId: s.projectId, materialId: s.materialId }, _sum: { quantity: true } });
        const diff = Number(s.quantityOnHand) - Number(agg._sum.quantity ?? 0);
        if (Math.abs(diff) <= 0.0001) continue;
        const m = await tx.stockMovement.create({
          data: {
            projectId: s.projectId,
            materialId: s.materialId,
            kind: "ADJUSTMENT",
            quantity: diff,
            fecha: day,
            sourceType: "MigracionSaldoInicial",
            sourceId: 0,
            note: "Saldo inicial (migración): stock guardado sin movimientos que lo expliquen",
          },
        });
        await tx.stockMovement.update({ where: { id: m.id }, data: { sourceId: m.id } });
        await refreshStockCache(tx, s.projectId, s.materialId);
        console.log(`  obra ${s.projectId} · ${s.material.code}: ajuste ${diff > 0 ? "+" : ""}${diff}`);
        n++;
      }
    },
    { timeout: 120_000 }
  );
  console.log(`${n} saldo(s) conciliados al ${fecha}.`);
}

/** Completa las fechas nuevas de los registros creados antes de la migración (solo tras db push). */
async function fechas() {
  const corte = arg("--corte") ? new Date(arg("--corte")!) : new Date();
  const r = await prisma.$transaction([
    prisma.$executeRaw`UPDATE "PurchaseOrder" SET "fecha" = COALESCE("issueDate", "createdAt")::date WHERE "createdAt" < ${corte}`,
    prisma.$executeRaw`UPDATE "PurchaseOrder" po SET "receivedDate" = sm.d
      FROM (SELECT "sourceId", MIN("createdAt")::date AS d FROM "StockMovement"
            WHERE "sourceType" = 'PurchaseOrder' AND "kind" = 'RECEIPT' AND "createdAt" < ${corte} GROUP BY "sourceId") sm
      WHERE po."id" = sm."sourceId" AND po."status" = 'RECIBIDO' AND po."receivedDate" IS NULL`,
    prisma.$executeRaw`UPDATE "StockMovement" sm SET "fecha" = COALESCE(po."receivedDate", sm."createdAt"::date)
      FROM "PurchaseOrder" po WHERE sm."sourceType" = 'PurchaseOrder' AND sm."sourceId" = po."id" AND sm."createdAt" < ${corte}`,
    prisma.$executeRaw`UPDATE "StockMovement" SET "fecha" = "createdAt"::date WHERE "sourceType" <> 'PurchaseOrder' AND "createdAt" < ${corte}`,
    prisma.$executeRaw`UPDATE "BudgetMovement" SET "fecha" = "createdAt"::date WHERE "createdAt" < ${corte}`,
    prisma.$executeRaw`UPDATE "BudgetMovement" bm SET "fecha" = CASE WHEN bm."stage" = 'ACTUAL' THEN COALESCE(po."receivedDate", po."fecha") ELSE po."fecha" END
      FROM "PurchaseOrder" po WHERE bm."sourceType" = 'PurchaseOrder' AND bm."sourceId" = po."id" AND bm."reversalOfId" IS NULL AND bm."createdAt" < ${corte}`,
  ]);
  console.log(`Fechas completadas (registros anteriores a ${corte.toISOString()}): ${r.join(" / ")} filas.`);
}

async function main() {
  if (has("--fechas")) return fechas();
  if (has("--aplicar-tipos")) return aplicarTipos(arg("--aplicar-tipos") || OUT);
  if (has("--conciliar-stock")) return conciliarStock(arg("--fecha") || "");
  return reporte();
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
