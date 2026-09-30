import { Prisma, type BudgetMovementSource, type BudgetMovementStage } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { toDecimal, type MoneyLike } from "../lib/money";
import { assertOpenPeriod } from "./progress";
import { today } from "./prices";

/**
 * Libro mayor presupuestario.
 *
 * Toda operación que descuenta del presupuesto pasa por aquí: se inserta una fila en
 * BudgetMovement y se actualiza el caché de la partida en la misma transacción.
 * Anular nunca borra filas: crea reversos enlazados.
 *
 * Para conectar una fuente de gasto nueva:
 *   1. agregar el valor a `BudgetMovementSource` en schema.prisma;
 *   2. llamar a postCost()/postMovement() cuando el documento se confirma;
 *   3. llamar a reverseMovements() cuando se anula.
 */

type Tx = Prisma.TransactionClient;

export interface BudgetWarning {
  budgetItemId: number;
  code: string;
  name: string;
  kind: "COST_OVER_BUDGET" | "QUANTITY_OVER_CONTRACT";
  message: string;
}

export interface PostMovementInput {
  projectId: number;
  budgetItemId: number;
  /** Insumo del hecho, si se conoce (obra + ítem + insumo + fecha). */
  insumoId?: number | null;
  source: BudgetMovementSource;
  stage: BudgetMovementStage;
  amount: MoneyLike;
  quantity?: MoneyLike | null;
  sourceType: string;
  sourceId: number;
  sourceNumber?: string;
  note?: string;
  createdBy?: string;
  /** Fecha del hecho; por defecto hoy. */
  fecha?: Date;
}

const COST_SOURCES: BudgetMovementSource[] = [
  "PURCHASE_ORDER",
  "SUBCONTRACT",
  "PETTY_CASH",
  "MANUAL_ADJUSTMENT",
  "INVOICE",
];

export function isCostSource(source: BudgetMovementSource) {
  return COST_SOURCES.includes(source);
}

/** Traduce un movimiento a incrementos sobre las columnas caché de BudgetItem. */
function cacheDelta(
  source: BudgetMovementSource,
  stage: BudgetMovementStage,
  amount: Prisma.Decimal,
  quantity: Prisma.Decimal | null
): Prisma.BudgetItemUpdateInput {
  if (source === "CLIENT_CERTIFICATE") {
    return {
      certifiedAmount: { increment: amount },
      ...(quantity ? { certifiedQuantity: { increment: quantity } } : {}),
    };
  }
  const data: Prisma.BudgetItemUpdateInput =
    stage === "COMMITTED"
      ? { costCommittedAmount: { increment: amount } }
      : { costActualAmount: { increment: amount } };
  if (source === "SUBCONTRACT" && stage === "ACTUAL" && quantity) {
    data.subcontractQuantity = { increment: quantity };
  }
  return data;
}

/** Valida que la partida exista, sea de la obra y sea una hoja imputable. */
export async function assertImputableItem(tx: Tx, projectId: number, budgetItemId: number) {
  const item = await tx.budgetItem.findUnique({ where: { id: budgetItemId } });
  if (!item) throw new NotFoundError("Partida presupuestaria", budgetItemId);
  if (item.projectId !== projectId) {
    throw new DomainError(
      "BUDGET_ITEM_MISMATCH",
      `La partida ${item.code} no pertenece a la obra seleccionada`,
      422
    );
  }
  if (item.nodeKind !== "ITEM") {
    throw new DomainError(
      "BUDGET_ITEM_NOT_LEAF",
      `"${item.code} ${item.name}" es un rubro; se debe imputar a un ítem`,
      422
    );
  }
  return item;
}

export async function postMovement(tx: Tx, input: PostMovementInput) {
  const item = await assertImputableItem(tx, input.projectId, input.budgetItemId);
  // Lo cerrado no se edita. El certificado al cliente es la excepción: se aprueba después de
  // cerrar el período de su medición.
  if (input.source !== "CLIENT_CERTIFICATE") {
    await assertOpenPeriod(tx, input.projectId, input.fecha ?? today(), "El movimiento contable");
  }
  const amount = toDecimal(input.amount);
  const quantity =
    input.quantity === undefined || input.quantity === null ? null : toDecimal(input.quantity);

  const warnings: BudgetWarning[] = [];
  if (isCostSource(input.source) && input.stage === "COMMITTED" && amount.gt(0)) {
    const available = toDecimal(item.originalAmount).minus(toDecimal(item.costCommittedAmount));
    if (amount.gt(available)) {
      warnings.push({
        budgetItemId: item.id,
        code: item.code,
        name: item.name,
        kind: "COST_OVER_BUDGET",
        message: `Partida ${item.code} excedida: se imputan ${amount.toFixed(2)} y el saldo era ${available.toFixed(2)}`,
      });
    }
  }
  if (input.source === "CLIENT_CERTIFICATE" && quantity && quantity.gt(0)) {
    const remainingQty = toDecimal(item.totalQuantity).minus(toDecimal(item.certifiedQuantity));
    if (quantity.gt(remainingQty)) {
      warnings.push({
        budgetItemId: item.id,
        code: item.code,
        name: item.name,
        kind: "QUANTITY_OVER_CONTRACT",
        message: `Partida ${item.code}: se certifican ${quantity.toString()} y quedaban ${remainingQty.toString()} del contrato`,
      });
    }
  }

  const movement = await tx.budgetMovement.create({
    data: {
      projectId: input.projectId,
      budgetItemId: item.id,
      insumoId: input.insumoId ?? null,
      source: input.source,
      stage: input.stage,
      amount,
      quantity,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      overBudget: warnings.length > 0,
      note: input.note,
      createdBy: input.createdBy,
      // Sin fecha del hecho: hoy en Paraguay (el default de la base truncaría en UTC)
      fecha: input.fecha ?? today(),
    },
  });
  await tx.budgetItem.update({
    where: { id: item.id },
    data: cacheDelta(input.source, input.stage, amount, quantity),
  });

  return { movement, warnings };
}

/**
 * Costo que se compromete e incurre en el mismo acto (caja chica, certificado de
 * subcontratista, ajuste manual): registra COMMITTED y ACTUAL.
 */
export async function postCost(tx: Tx, input: Omit<PostMovementInput, "stage">) {
  const committed = await postMovement(tx, { ...input, stage: "COMMITTED" });
  await postMovement(tx, { ...input, stage: "ACTUAL" });
  return committed.warnings;
}

/** Revierte los movimientos vigentes de un documento (opcionalmente solo una etapa). */
export async function reverseMovements(
  tx: Tx,
  params: {
    sourceType: string;
    sourceId: number;
    stage?: BudgetMovementStage;
    note?: string;
    createdBy?: string;
  }
) {
  const movements = await tx.budgetMovement.findMany({
    where: {
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      reversalOfId: null,
      ...(params.stage ? { stage: params.stage } : {}),
    },
  });
  const alreadyReversed = new Set(
    (
      await tx.budgetMovement.findMany({
        where: { reversalOfId: { in: movements.map((m) => m.id) } },
        select: { reversalOfId: true },
      })
    ).map((m) => m.reversalOfId)
  );

  let count = 0;
  for (const m of movements) {
    if (alreadyReversed.has(m.id)) continue;
    const amount = toDecimal(m.amount).negated();
    const quantity = m.quantity === null ? null : toDecimal(m.quantity).negated();
    await tx.budgetMovement.create({
      data: {
        projectId: m.projectId,
        budgetItemId: m.budgetItemId,
        insumoId: m.insumoId,
        source: m.source,
        stage: m.stage,
        amount,
        quantity,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        sourceNumber: m.sourceNumber,
        reversalOfId: m.id,
        fecha: today(),
        note: params.note ?? `Reverso de movimiento ${m.id}`,
        createdBy: params.createdBy,
      },
    });
    await tx.budgetItem.update({
      where: { id: m.budgetItemId },
      data: cacheDelta(m.source, m.stage, amount, quantity),
    });
    count++;
  }
  return count;
}

export async function hasMovements(tx: Tx, where: { projectId?: number; budgetItemId?: number }) {
  return (await tx.budgetMovement.count({ where })) > 0;
}

/** Recalcula el caché de todas las partidas de la obra sumando el libro mayor. */
export async function rebuildItemCache(tx: Tx, projectId: number) {
  const items = await tx.budgetItem.findMany({ where: { projectId }, select: { id: true } });
  const movements = await tx.budgetMovement.findMany({ where: { projectId } });

  const zero = () => ({
    costCommittedAmount: toDecimal(0),
    costActualAmount: toDecimal(0),
    subcontractQuantity: toDecimal(0),
    certifiedQuantity: toDecimal(0),
    certifiedAmount: toDecimal(0),
  });
  const totals = new Map(items.map((i) => [i.id, zero()]));

  for (const m of movements) {
    const t = totals.get(m.budgetItemId);
    if (!t) continue;
    const amount = toDecimal(m.amount);
    const qty = m.quantity === null ? null : toDecimal(m.quantity);
    if (m.source === "CLIENT_CERTIFICATE") {
      t.certifiedAmount = t.certifiedAmount.plus(amount);
      if (qty) t.certifiedQuantity = t.certifiedQuantity.plus(qty);
    } else if (m.stage === "COMMITTED") {
      t.costCommittedAmount = t.costCommittedAmount.plus(amount);
    } else {
      t.costActualAmount = t.costActualAmount.plus(amount);
      if (m.source === "SUBCONTRACT" && qty) t.subcontractQuantity = t.subcontractQuantity.plus(qty);
    }
  }

  for (const [id, data] of totals) {
    await tx.budgetItem.update({ where: { id }, data });
  }
  return { items: items.length, movements: movements.length };
}
