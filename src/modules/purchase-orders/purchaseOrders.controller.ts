import { Router } from "express";
import { DocumentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError, TraceabilityError } from "../../errors/domain";
import { assertDocTransition, assertMutableDocument } from "../../domain/lifecycle";
import { audit, nextNumber } from "../../domain/audit";
import { commitBudget, executeBudget, releaseBudget } from "../../domain/budget";
import { receiveStock } from "../../domain/stock";
import { toDecimal } from "../../lib/money";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";

export const purchaseOrdersRouter = Router();

const poInclude = {
  partner: true,
  project: true,
  materialRequest: true,
  details: { include: { material: true, budgetItem: true, requestDetail: true } },
} satisfies Prisma.PurchaseOrderInclude;

purchaseOrdersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(
      res,
      await prisma.purchaseOrder.findMany({
        include: poInclude,
        orderBy: { id: "desc" },
      })
    );
  })
);

const createSchema = z.object({
  materialRequestId: z.number().int(),
  partnerId: z.number().int(),
  expectedDate: z.string().datetime().optional(),
  details: z
    .array(
      z.object({
        requestDetailId: z.number().int(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().positive(),
      })
    )
    .min(1),
});

purchaseOrdersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    const created = await prisma.$transaction(
      async (tx) => {
        const request = await tx.materialRequest.findUnique({
          where: { id: body.materialRequestId },
          include: { details: true },
        });
        if (!request) throw new NotFoundError("Pedido de material", body.materialRequestId);
        if (!request.workFrontId || !request.requestedById) {
          throw new TraceabilityError("El pedido no tiene origen de campo");
        }
        if (request.status !== DocumentStatus.APROBADO_PARA_COMPRA) {
          throw new TraceabilityError(
            "Ninguna OC puede emitirse sin un Pedido de Material aprobado para compra"
          );
        }

        const partner = await tx.partner.findUnique({ where: { id: body.partnerId } });
        if (!partner) throw new NotFoundError("Proveedor", body.partnerId);
        if (partner.kind === "SUBCONTRACTOR") {
          throw new DomainError("INVALID_PARTNER", "El partner debe ser proveedor o mixto");
        }

        const lines = [];
        let total = toDecimal(0);
        for (const line of body.details) {
          const reqLine = request.details.find((d) => d.id === line.requestDetailId);
          if (!reqLine) {
            throw new TraceabilityError(
              `La línea ${line.requestDetailId} no pertenece al pedido ${request.number}`
            );
          }
          const alreadyOrdered = await tx.purchaseOrderDetail.aggregate({
            where: {
              requestDetailId: reqLine.id,
              order: { status: { not: DocumentStatus.ANULADO } },
            },
            _sum: { quantity: true },
          });
          const used = toDecimal(alreadyOrdered._sum.quantity ?? 0);
          const qty = toDecimal(line.quantity);
          if (used.plus(qty).gt(reqLine.quantity)) {
            throw new DomainError(
              "QTY_EXCEEDS_REQUEST",
              `Cantidad supera el pedido ${request.number} para el insumo ${reqLine.materialId}`
            );
          }
          const unitPrice = toDecimal(line.unitPrice);
          const subtotal = qty.times(unitPrice).toDecimalPlaces(2);
          total = total.plus(subtotal);
          lines.push({
            materialId: reqLine.materialId,
            requestDetailId: reqLine.id,
            budgetItemId: reqLine.budgetItemId,
            quantity: qty,
            unitPrice,
            subtotal,
          });
        }

        const number = await nextNumber(tx, "OC", () => tx.purchaseOrder.count());
        const order = await tx.purchaseOrder.create({
          data: {
            number,
            projectId: request.projectId,
            partnerId: body.partnerId,
            materialRequestId: request.id,
            expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
            totalAmount: total,
            details: { create: lines },
          },
          include: poInclude,
        });
        await audit(tx, {
          entity: "PurchaseOrder",
          entityId: order.id,
          action: "CREATE",
          toStatus: DocumentStatus.BORRADOR,
          payload: { materialRequestId: request.id },
        });
        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    ok(res, created, 201);
  })
);

purchaseOrdersRouter.post(
  "/:id/aprobar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundError("Orden de compra", id);
      assertDocTransition(order.status, DocumentStatus.APROBADO_PARA_COMPRA);
      const next = await tx.purchaseOrder.update({
        where: { id },
        data: { status: DocumentStatus.APROBADO_PARA_COMPRA },
        include: poInclude,
      });
      await audit(tx, {
        entity: "PurchaseOrder",
        entityId: id,
        action: "APPROVE",
        fromStatus: order.status,
        toStatus: next.status,
      });
      return next;
    });
    ok(res, updated);
  })
);

purchaseOrdersRouter.post(
  "/:id/emitir",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { details: true, materialRequest: true },
        });
        if (!order) throw new NotFoundError("Orden de compra", id);
        if (!order.materialRequestId) {
          throw new TraceabilityError("La OC no está vinculada a un Pedido de Material");
        }
        assertDocTransition(order.status, DocumentStatus.EMITIDA);

        const byItem = new Map<number, ReturnType<typeof toDecimal>>();
        for (const d of order.details) {
          const prev = byItem.get(d.budgetItemId) ?? toDecimal(0);
          byItem.set(d.budgetItemId, prev.plus(d.subtotal));
        }
        for (const [budgetItemId, amount] of byItem) {
          await commitBudget(tx, {
            budgetItemId,
            amount,
            kind: "PURCHASE_ORDER",
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            note: `Compromiso OC ${order.number}`,
          });
        }

        const next = await tx.purchaseOrder.update({
          where: { id },
          data: { status: DocumentStatus.EMITIDA, issueDate: new Date() },
          include: poInclude,
        });
        if (order.materialRequest.status === DocumentStatus.APROBADO_PARA_COMPRA) {
          await tx.materialRequest.update({
            where: { id: order.materialRequestId },
            data: { status: DocumentStatus.EMITIDA },
          });
        }
        await recalculateProjectFinancials(tx, order.projectId);
        await audit(tx, {
          entity: "PurchaseOrder",
          entityId: id,
          action: "ISSUE",
          fromStatus: order.status,
          toStatus: next.status,
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, updated);
  })
);

purchaseOrdersRouter.post(
  "/:id/recibir",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { details: true },
        });
        if (!order) throw new NotFoundError("Orden de compra", id);
        assertDocTransition(order.status, DocumentStatus.RECIBIDO);

        for (const d of order.details) {
          await receiveStock(tx, {
            projectId: order.projectId,
            materialId: d.materialId,
            quantity: d.quantity,
            sourceType: "PurchaseOrder",
            sourceId: order.id,
          });
          await executeBudget(tx, d.budgetItemId, d.subtotal);
        }

        const next = await tx.purchaseOrder.update({
          where: { id },
          data: { status: DocumentStatus.RECIBIDO, stockRegistered: true },
          include: poInclude,
        });
        await tx.materialRequest.update({
          where: { id: order.materialRequestId },
          data: { status: DocumentStatus.RECIBIDO },
        });
        await recalculateProjectFinancials(tx, order.projectId);
        await audit(tx, {
          entity: "PurchaseOrder",
          entityId: id,
          action: "RECEIVE",
          fromStatus: order.status,
          toStatus: next.status,
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, updated);
  })
);

purchaseOrdersRouter.post(
  "/:id/anular",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { details: true },
        });
        if (!order) throw new NotFoundError("Orden de compra", id);
        assertDocTransition(order.status, DocumentStatus.ANULADO);

        if (order.status === DocumentStatus.EMITIDA) {
          const byItem = new Map<number, ReturnType<typeof toDecimal>>();
          for (const d of order.details) {
            const prev = byItem.get(d.budgetItemId) ?? toDecimal(0);
            byItem.set(d.budgetItemId, prev.plus(d.subtotal));
          }
          for (const [budgetItemId, amount] of byItem) {
            await releaseBudget(tx, {
              budgetItemId,
              amount,
              sourceType: "PurchaseOrder",
              sourceId: order.id,
              note: `Liberación por anulación OC ${order.number}`,
            });
          }
        }

        const next = await tx.purchaseOrder.update({
          where: { id },
          data: { status: DocumentStatus.ANULADO },
          include: poInclude,
        });
        await audit(tx, {
          entity: "PurchaseOrder",
          entityId: id,
          action: "VOID",
          fromStatus: order.status,
          toStatus: next.status,
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, updated);
  })
);

purchaseOrdersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Orden de compra", id);
    assertMutableDocument("Orden de compra", order.status);
    throw new DomainError(
      "USE_REPLACE_FLOW",
      "En BORRADOR debe anularse y recrearse la OC para preservar trazabilidad de líneas"
    );
  })
);

purchaseOrdersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundError("Orden de compra", id);
      assertMutableDocument("Orden de compra", order.status);
      await tx.purchaseOrder.delete({ where: { id } });
      await audit(tx, {
        entity: "PurchaseOrder",
        entityId: id,
        action: "DELETE",
        fromStatus: order.status,
      });
    });
    ok(res, { deleted: true });
  })
);
