import { Router } from "express";
import { DocumentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError, TraceabilityError } from "../../errors/domain";
import { assertDocTransition, assertMutableDocument } from "../../domain/lifecycle";
import { audit, nextNumber } from "../../domain/audit";
import { postMovement, reverseMovements, type BudgetWarning } from "../../domain/budget";
import { recordStockMovement } from "../../domain/stock";
import { ledgerLines, resolveLineItem } from "../../domain/imputation";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";
import { toDay } from "../../domain/prices";
import { toDecimal } from "../../lib/money";
import { avisoTardio } from "../../domain/progress";
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

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

const createSchema = z.object({
  materialRequestId: z.number().int(),
  partnerId: z.number().int(),
  fecha: dateSchema,
  expectedDate: z.string().datetime().optional(),
  details: z
    .array(
      z.object({
        requestDetailId: z.number().int(),
        /** Ítem de destino (DIRECTO: obligatorio; si no viene se usa el del pedido). */
        budgetItemId: z.number().int().positive().nullish(),
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
        if (request.status !== DocumentStatus.APROBADO_PARA_COMPRA) {
          throw new TraceabilityError(
            "Ninguna OC puede emitirse sin un Pedido de Material aprobado para compra"
          );
        }

        // Una OC con fecha de un período cerrado se acepta: conserva su fecha y su costo entra el primer día abierto.
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
          const material = await tx.material.findUniqueOrThrow({ where: { id: reqLine.materialId } });
          const budgetItemId = await resolveLineItem(tx, {
            projectId: request.projectId,
            material,
            explicitItemId: line.budgetItemId,
            inheritedItemId: reqLine.budgetItemId,
          });
          const unitPrice = toDecimal(line.unitPrice);
          const subtotal = qty.times(unitPrice).toDecimalPlaces(2);
          total = total.plus(subtotal);
          lines.push({
            materialId: reqLine.materialId,
            requestDetailId: reqLine.id,
            budgetItemId,
            tipo: material.tipo,
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
            fecha: toDay(body.fecha),
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

        // DIRECTO (y TIEMPO con ítem) a su ítem; COMÚN y TIEMPO sin ítem al pozo "a distribuir".
        const lines = await ledgerLines(tx, order.projectId, order.details);
        const budgetWarnings: BudgetWarning[] = [];
        const avisos: string[] = [];
        for (const { budgetItemId, insumoId, amount } of lines) {
          const { warnings, desplazado } = await postMovement(tx, {
            projectId: order.projectId,
            budgetItemId,
            insumoId,
            amount,
            source: "PURCHASE_ORDER",
            stage: "COMMITTED",
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            sourceNumber: order.number,
            note: `Compromiso OC ${order.number}`,
            fecha: order.fecha,
          });
          budgetWarnings.push(...warnings);
          if (desplazado && !avisos.length) avisos.push(avisoTardio("La OC", desplazado));
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
          payload: budgetWarnings.length ? { budgetWarnings: budgetWarnings.map((w) => w.message) } : undefined,
        });
        return { ...next, budgetWarnings, avisos };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, updated);
  })
);

const receiveSchema = z.object({
  fecha: dateSchema,
  /** Número de remito / nota de remisión del proveedor. */
  remito: z.string().trim().max(60).optional(),
});

purchaseOrdersRouter.post(
  "/:id/recibir",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = receiveSchema.parse(req.body ?? {});
    const fecha = toDay(body.fecha);
    const updated = await prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { details: true },
        });
        if (!order) throw new NotFoundError("Orden de compra", id);
        assertDocTransition(order.status, DocumentStatus.RECIBIDO);
        if (fecha < order.fecha) {
          throw new DomainError("RECEIPT_BEFORE_ORDER", "La recepción no puede ser anterior a la fecha de la OC", 422);
        }

        for (const d of order.details) {
          if (d.tipo === "TIEMPO") continue; // servicios y alquileres: no pasan por el depósito
          const base = {
            projectId: order.projectId,
            materialId: d.materialId,
            fecha,
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            unitCost: d.unitPrice,
            note: body.remito ? `Remito ${body.remito}` : null,
            // Recepción tardía: si su fecha está cerrada, entra el primer día abierto.
            tardio: true,
          };
          await recordStockMovement(tx, { ...base, kind: "RECEIPT", quantity: d.quantity });
          // DIRECTO: entra y sale en el mismo acto hacia su ítem (hormigón por remito, acero, etc.).
          if (d.tipo === "DIRECTO") {
            await recordStockMovement(tx, {
              ...base,
              kind: "DIRECT_ISSUE",
              quantity: toDecimal(d.quantity).negated(),
              budgetItemId: d.budgetItemId,
            });
          }
        }
        const lines = await ledgerLines(tx, order.projectId, order.details);
        // El compromiso ya existe desde la emisión: aquí solo pasa a costo incurrido.
        const avisos: string[] = [];
        for (const { budgetItemId, insumoId, amount } of lines) {
          const { desplazado } = await postMovement(tx, {
            projectId: order.projectId,
            budgetItemId,
            insumoId,
            amount,
            source: "PURCHASE_ORDER",
            stage: "ACTUAL",
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            sourceNumber: order.number,
            note: `Recepción OC ${order.number}${body.remito ? ` · remito ${body.remito}` : ""}`,
            fecha,
          });
          if (desplazado && !avisos.length) avisos.push(avisoTardio("La recepción", desplazado));
        }
        const totalLines = lines.reduce((acc, l) => acc.plus(l.amount), toDecimal(0));
        if (totalLines.gt(0)) {
          await postAsientoDesdeRegla(tx, {
            evento: EVENTO.OC_RECIBIDA,
            projectId: order.projectId,
            concepto: `OC ${order.number} recibida${body.remito ? ` · remito ${body.remito}` : ""}`,
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            fecha,
            debe: lines.map((l) => ({ monto: l.amount, budgetItemId: l.budgetItemId })),
            haber: [{ monto: totalLines, partnerId: order.partnerId }],
          });
        }

        const next = await tx.purchaseOrder.update({
          where: { id },
          data: { status: DocumentStatus.RECIBIDO, stockRegistered: true, receivedDate: fecha, receiptNumber: body.remito || null },
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
        return { ...next, avisos };
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
          await reverseMovements(tx, {
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            note: `Liberación por anulación OC ${order.number}`,
          });
          await recalculateProjectFinancials(tx, order.projectId);
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
