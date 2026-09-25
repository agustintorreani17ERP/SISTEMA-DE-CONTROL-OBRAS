import type { Prisma } from "@prisma/client";

export async function nextNumber(
  tx: Prisma.TransactionClient,
  prefix: string,
  countQuery: () => Promise<number>
) {
  const n = await countQuery();
  return `${prefix}-${String(n + 1).padStart(6, "0")}`;
}

export async function audit(
  tx: Prisma.TransactionClient,
  data: {
    entity: string;
    entityId: number;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    payload?: Prisma.InputJsonValue;
  }
) {
  await tx.documentAuditLog.create({ data });
}
