import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { toDecimal, type MoneyLike } from "../lib/money";

export async function receiveStock(
  tx: Prisma.TransactionClient,
  params: {
    projectId: number;
    materialId: number;
    quantity: MoneyLike;
    sourceType: string;
    sourceId: number;
  }
) {
  const qty = toDecimal(params.quantity);
  await tx.warehouseStock.upsert({
    where: {
      projectId_materialId: {
        projectId: params.projectId,
        materialId: params.materialId,
      },
    },
    create: {
      projectId: params.projectId,
      materialId: params.materialId,
      quantityOnHand: qty,
    },
    update: { quantityOnHand: { increment: qty } },
  });

  await tx.stockMovement.create({
    data: {
      projectId: params.projectId,
      materialId: params.materialId,
      kind: "RECEIPT",
      quantity: qty,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    },
  });
}

export async function consumeStock(
  tx: Prisma.TransactionClient,
  params: {
    projectId: number;
    materialId: number;
    quantity: MoneyLike;
    sourceType: string;
    sourceId: number;
    note?: string;
  }
) {
  const qty = toDecimal(params.quantity);
  const stock = await tx.warehouseStock.findUnique({
    where: {
      projectId_materialId: {
        projectId: params.projectId,
        materialId: params.materialId,
      },
    },
  });
  if (!stock) throw new NotFoundError("Stock", `${params.projectId}/${params.materialId}`);
  if (toDecimal(stock.quantityOnHand).lt(qty)) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      `Stock insuficiente. Disponible ${stock.quantityOnHand.toString()}, solicitado ${qty.toString()}.`,
      409
    );
  }

  await tx.warehouseStock.update({
    where: { id: stock.id },
    data: { quantityOnHand: { decrement: qty } },
  });
  await tx.stockMovement.create({
    data: {
      projectId: params.projectId,
      materialId: params.materialId,
      kind: "CONSUMPTION",
      quantity: qty.negated(),
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      note: params.note,
    },
  });
}

export async function adjustStock(
  tx: Prisma.TransactionClient,
  params: {
    projectId: number;
    materialId: number;
    quantity: MoneyLike;
    sourceType: string;
    sourceId: number;
    note?: string;
  }
) {
  const qty = toDecimal(params.quantity);
  if (qty.isZero()) throw new DomainError("INVALID_ADJUSTMENT", "El ajuste no puede ser cero");
  const stock = await tx.warehouseStock.upsert({
    where: {
      projectId_materialId: {
        projectId: params.projectId,
        materialId: params.materialId,
      },
    },
    create: {
      projectId: params.projectId,
      materialId: params.materialId,
      quantityOnHand: qty,
    },
    update: { quantityOnHand: { increment: qty } },
  });
  if (toDecimal(stock.quantityOnHand).lt(0)) {
    throw new DomainError("NEGATIVE_STOCK", "El ajuste no puede dejar stock negativo", 409);
  }
  await tx.stockMovement.create({
    data: {
      projectId: params.projectId,
      materialId: params.materialId,
      kind: "ADJUSTMENT",
      quantity: qty,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      note: params.note,
    },
  });
}
