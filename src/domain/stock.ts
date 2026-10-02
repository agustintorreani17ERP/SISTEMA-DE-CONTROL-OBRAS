import type { Prisma, StockMovementKind } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { toDecimal, type MoneyLike } from "../lib/money";
import { postCost } from "./budget";
import { distributionPoolId } from "./generalExpenses";
import { getPrecioVigente, toDay } from "./prices";
import { deriveCountAdjustments, firstNegativeDay, type StockMov } from "./stockMath";
import { assertOpenPeriod, fechaContable } from "./progress";

type Tx = Prisma.TransactionClient;

/**
 * Libro de stock por obra e insumo. Cada movimiento tiene fecha; el saldo a una fecha es la suma
 * de los movimientos hasta ese día inclusive. WarehouseStock es solo la caché del saldo total.
 * Los conteos de inventario son hechos: su ajuste se deriva y se recalcula si llega un
 * movimiento con fecha anterior o igual a un conteo.
 */

export const COUNT_SOURCE = "ConteoInventario";

export interface StockMovementInput {
  projectId: number;
  materialId: number;
  kind: StockMovementKind;
  /** Con signo: positivo entra, negativo sale. */
  quantity: MoneyLike;
  fecha: Date | string;
  sourceType: string;
  sourceId: number;
  budgetItemId?: number | null;
  counterpartProjectId?: number | null;
  unitCost?: MoneyLike;
  note?: string | null;
  createdBy?: string | null;
  /**
   * Documento que puede llegar tarde (recepción de OC, factura, caja chica): si su fecha está en
   * un período cerrado se registra el primer día abierto y guarda la fecha real en fechaDocumento.
   * Sin esto (salidas, transferencias, conteos) una fecha cerrada se rechaza.
   */
  tardio?: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDay = (d: Date | string) => (typeof d === "string" ? d : iso(d)).split("-").reverse().join("/");

async function loadMovs(tx: Tx, projectId: number, materialId: number, excludeCountIds: number[] = []): Promise<StockMov[]> {
  const rows = await tx.stockMovement.findMany({
    where: {
      projectId,
      materialId,
      ...(excludeCountIds.length ? { NOT: { sourceType: COUNT_SOURCE, sourceId: { in: excludeCountIds } } } : {}),
    },
    select: { fecha: true, quantity: true },
  });
  return rows.map((r) => ({ fecha: iso(r.fecha), quantity: Number(r.quantity) }));
}

export async function stockAt(tx: Tx, projectId: number, materialId: number, fecha: Date | string) {
  const agg = await tx.stockMovement.aggregate({
    where: { projectId, materialId, fecha: { lte: toDay(fecha) } },
    _sum: { quantity: true },
  });
  return toDecimal(agg._sum.quantity ?? 0);
}

export async function refreshStockCache(tx: Tx, projectId: number, materialId: number) {
  const agg = await tx.stockMovement.aggregate({ where: { projectId, materialId }, _sum: { quantity: true } });
  const qty = toDecimal(agg._sum.quantity ?? 0);
  await tx.warehouseStock.upsert({
    where: { projectId_materialId: { projectId, materialId } },
    create: { projectId, materialId, quantityOnHand: qty },
    update: { quantityOnHand: qty },
  });
  return qty;
}

/** El saldo al cierre de cada día no puede quedar negativo (dentro del día no importa el orden). */
export async function assertNoNegativeBalance(tx: Tx, projectId: number, materialId: number) {
  const neg = firstNegativeDay(await loadMovs(tx, projectId, materialId));
  if (neg) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      `Stock insuficiente: el ${fmtDay(neg.fecha)} el saldo quedaría en ${neg.saldo.toLocaleString("es-PY")}.`,
      409
    );
  }
}

/** Rehace los ajustes de los conteos desde `from` (inclusive), en orden de fecha. */
export async function recomputeCountAdjustments(tx: Tx, projectId: number, materialId: number, from: Date | string) {
  const counts = await tx.conteoInventario.findMany({
    where: { projectId, materialId, fecha: { gte: toDay(from) } },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  if (!counts.length) return;
  const ids = counts.map((c) => c.id);
  await tx.stockMovement.deleteMany({ where: { projectId, materialId, sourceType: COUNT_SOURCE, sourceId: { in: ids } } });
  const adjustments = deriveCountAdjustments(
    await loadMovs(tx, projectId, materialId, ids),
    counts.map((c) => ({ id: c.id, fecha: iso(c.fecha), cantidad: Number(c.cantidadContada) }))
  );
  const byId = new Map(counts.map((c) => [c.id, c]));
  for (const a of adjustments) {
    if (a.diferencia === 0) continue;
    const c = byId.get(a.countId)!;
    await tx.stockMovement.create({
      data: {
        projectId,
        materialId,
        kind: "INVENTORY_ADJUSTMENT",
        quantity: a.diferencia,
        fecha: c.fecha,
        sourceType: COUNT_SOURCE,
        sourceId: c.id,
        note: `Conteo: teórico ${a.teorico}, contado ${Number(c.cantidadContada)}`,
        createdBy: c.createdBy,
      },
    });
  }
}

export async function recordStockMovement(tx: Tx, input: StockMovementInput) {
  const quantity = toDecimal(input.quantity);
  if (quantity.isZero()) throw new DomainError("INVALID_QUANTITY", "La cantidad no puede ser cero");
  let fecha = toDay(input.fecha);
  let fechaDocumento: Date | null = null;
  if (input.tardio) {
    const fc = await fechaContable(tx, input.projectId, fecha);
    if (fc.desplazada) [fechaDocumento, fecha] = [fecha, fc.fecha];
  } else {
    await assertOpenPeriod(tx, input.projectId, fecha, "El movimiento de stock");
  }
  const movement = await tx.stockMovement.create({
    data: {
      projectId: input.projectId,
      materialId: input.materialId,
      kind: input.kind,
      quantity,
      fecha,
      fechaDocumento,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      budgetItemId: input.budgetItemId ?? null,
      counterpartProjectId: input.counterpartProjectId ?? null,
      unitCost: input.unitCost === undefined || input.unitCost === null ? null : toDecimal(input.unitCost),
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    },
  });
  await recomputeCountAdjustments(tx, input.projectId, input.materialId, fecha);
  if (quantity.isNegative()) await assertNoNegativeBalance(tx, input.projectId, input.materialId);
  await refreshStockCache(tx, input.projectId, input.materialId);
  return movement;
}

async function assertRefs(tx: Tx, projectId: number, materialId: number) {
  const [project, material] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { id: true } }),
    tx.material.findUnique({ where: { id: materialId } }),
  ]);
  if (!project) throw new NotFoundError("Obra", projectId);
  if (!material) throw new NotFoundError("Insumo", materialId);
  return material;
}

/** Transferencia entre obras: salida en origen, entrada en destino y traspaso del valor. */
export async function transferStock(
  tx: Tx,
  params: {
    fromProjectId: number;
    toProjectId: number;
    materialId: number;
    quantity: MoneyLike;
    fecha: Date | string;
    note?: string | null;
    createdBy?: string | null;
  }
) {
  if (params.fromProjectId === params.toProjectId) {
    throw new DomainError("SAME_PROJECT", "La obra de origen y la de destino son la misma", 400);
  }
  const material = await assertRefs(tx, params.fromProjectId, params.materialId);
  await assertRefs(tx, params.toProjectId, params.materialId);
  const qty = toDecimal(params.quantity);
  if (!qty.isPositive()) throw new DomainError("INVALID_QUANTITY", "La cantidad a transferir debe ser positiva");
  const fecha = toDay(params.fecha);
  const precio = await getPrecioVigente(tx, params.materialId, fecha);

  const out = await recordStockMovement(tx, {
    projectId: params.fromProjectId,
    materialId: params.materialId,
    kind: "TRANSFER_OUT",
    quantity: qty.negated(),
    fecha,
    sourceType: "StockTransfer",
    sourceId: 0,
    counterpartProjectId: params.toProjectId,
    unitCost: precio?.price,
    note: params.note,
    createdBy: params.createdBy,
  });
  await tx.stockMovement.update({ where: { id: out.id }, data: { sourceId: out.id } });
  const inn = await recordStockMovement(tx, {
    projectId: params.toProjectId,
    materialId: params.materialId,
    kind: "TRANSFER_IN",
    quantity: qty,
    fecha,
    sourceType: "StockTransfer",
    sourceId: out.id,
    counterpartProjectId: params.fromProjectId,
    unitCost: precio?.price,
    note: params.note,
    createdBy: params.createdBy,
  });

  // El valor del material viaja con él: sale del pozo de stock de una obra y entra al de la otra.
  const warnings: string[] = [];
  if (precio && !precio.price.isZero()) {
    const amount = qty.times(precio.price).toDecimalPlaces(2);
    const base = {
      source: "STOCK_TRANSFER" as const,
      insumoId: params.materialId,
      sourceType: "StockTransfer",
      sourceId: out.id,
      sourceNumber: `TR-${out.id}`,
      fecha,
      createdBy: params.createdBy ?? undefined,
    };
    await postCost(tx, {
      ...base,
      projectId: params.fromProjectId,
      budgetItemId: await distributionPoolId(tx, params.fromProjectId, "STOCK"),
      amount: amount.negated(),
      note: `Transferencia de ${material.code} a otra obra`,
    });
    await postCost(tx, {
      ...base,
      projectId: params.toProjectId,
      budgetItemId: await distributionPoolId(tx, params.toProjectId, "STOCK"),
      amount,
      note: `Transferencia de ${material.code} desde otra obra`,
    });
  } else {
    warnings.push(`${material.code} no tiene precio vigente al ${fmtDay(fecha)}: se transfirió la cantidad sin valor`);
  }
  return { out, in: inn, warnings };
}

export async function registerCount(
  tx: Tx,
  params: {
    projectId: number;
    materialId: number;
    fecha: Date | string;
    cantidadContada: MoneyLike;
    fotoUrl?: string | null;
    nota?: string | null;
    createdBy?: string | null;
  }
) {
  await assertRefs(tx, params.projectId, params.materialId);
  const fecha = toDay(params.fecha);
  await assertOpenPeriod(tx, params.projectId, fecha, "El conteo");
  const contada = toDecimal(params.cantidadContada);
  if (contada.isNegative()) throw new DomainError("INVALID_QUANTITY", "La cantidad contada no puede ser negativa");
  const conteo = await tx.conteoInventario.create({
    data: {
      projectId: params.projectId,
      materialId: params.materialId,
      fecha,
      cantidadContada: contada,
      fotoUrl: params.fotoUrl || null,
      nota: params.nota || null,
      createdBy: params.createdBy || null,
    },
  });
  await recomputeCountAdjustments(tx, params.projectId, params.materialId, fecha);
  await refreshStockCache(tx, params.projectId, params.materialId);
  const ajuste = await tx.stockMovement.findFirst({ where: { sourceType: COUNT_SOURCE, sourceId: conteo.id } });
  const diferencia = toDecimal(ajuste?.quantity ?? 0);
  return { conteo, stockTeorico: contada.minus(diferencia), diferencia };
}

export async function deleteCount(tx: Tx, id: number) {
  const conteo = await tx.conteoInventario.findUnique({ where: { id } });
  if (!conteo) throw new NotFoundError("Conteo", id);
  await assertOpenPeriod(tx, conteo.projectId, conteo.fecha, "El conteo");
  await tx.stockMovement.deleteMany({ where: { sourceType: COUNT_SOURCE, sourceId: id } });
  await tx.conteoInventario.delete({ where: { id } });
  await recomputeCountAdjustments(tx, conteo.projectId, conteo.materialId, conteo.fecha);
  await assertNoNegativeBalance(tx, conteo.projectId, conteo.materialId);
  await refreshStockCache(tx, conteo.projectId, conteo.materialId);
  return conteo;
}
