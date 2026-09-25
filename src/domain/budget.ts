import type { Prisma } from "@prisma/client";
import { BudgetCeilingError, NotFoundError } from "../errors/domain";
import { toDecimal, type MoneyLike } from "../lib/money";

export async function commitBudget(
  tx: Prisma.TransactionClient,
  params: {
    budgetItemId: number;
    amount: MoneyLike;
    kind: "PURCHASE_ORDER" | "SUBCONTRACT_CERTIFICATE";
    sourceType: string;
    sourceId: number;
    note?: string;
  }
) {
  const amount = toDecimal(params.amount);
  const item = await tx.budgetItem.findUnique({
    where: { id: params.budgetItemId },
  });
  if (!item) throw new NotFoundError("Partida presupuestaria", params.budgetItemId);

  const remaining = toDecimal(item.originalAmount).minus(toDecimal(item.committedAmount));
  if (amount.gt(remaining)) {
    throw new BudgetCeilingError(item.code, amount.toFixed(2), remaining.toFixed(2));
  }

  await tx.budgetItem.update({
    where: { id: item.id },
    data: { committedAmount: { increment: amount } },
  });

  await tx.budgetCommitment.create({
    data: {
      budgetItemId: item.id,
      kind: params.kind,
      amount,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      note: params.note,
    },
  });
}

export async function releaseBudget(
  tx: Prisma.TransactionClient,
  params: {
    budgetItemId: number;
    amount: MoneyLike;
    sourceType: string;
    sourceId: number;
    note?: string;
  }
) {
  const amount = toDecimal(params.amount);
  await tx.budgetItem.update({
    where: { id: params.budgetItemId },
    data: { committedAmount: { decrement: amount } },
  });
  await tx.budgetCommitment.create({
    data: {
      budgetItemId: params.budgetItemId,
      kind: "RELEASE",
      amount: amount.negated(),
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      note: params.note,
    },
  });
}

export async function executeBudget(
  tx: Prisma.TransactionClient,
  budgetItemId: number,
  amount: MoneyLike
) {
  await tx.budgetItem.update({
    where: { id: budgetItemId },
    data: { executedAmount: { increment: toDecimal(amount) } },
  });
}
