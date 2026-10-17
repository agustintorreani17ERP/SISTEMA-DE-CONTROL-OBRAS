import { Router } from "express";
import { DocumentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError, NotFoundError, TraceabilityError } from "../../../errors/domain";
import { assertDocTransition, assertMutableDocument } from "../../../core/domain/lifecycle";
import { audit, nextNumber } from "../../../core/domain/audit";
import { postMovement, reverseMovements, type BudgetWarning } from "../../../bridge/ledger";
import { recordStockMovement } from "../../../bridge/ledger";
import { ledgerLines, resolveLineItem } from "../../../bridge/ledger";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";
import { toDay } from "../../../core/domain/prices";
import { toDecimal } from "../../../lib/money";
import { recalculateProjectFinancials } from "../../../bridge/domain/projectFinancials";
import { actualizarEstadoRequisicion, avisarOcEmitida, avisarPedidoTomado, avisarRecepcion } from "../../domain/requisiciones";
import { validarRenglonesOC } from "../../domain/requisicionesMath";

export const purchaseOrdersRouter = Router();

const poInclude = {
  partner: true,
  project: true,
  materialRequest: true,
  requisicion: { select: { id: true, sistemaOrigen: true, numeroOrigen: true, maquinaTexto: true, obraTexto: true } },
  details: { include: { material: true, budgetItem: true, requestDetail: true, requisicionLinea: true } },
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

/** OC de un pedido del Taller: no tiene pedido de obra y su costo no entra al libro de ninguna obra. */
const esDelTaller = (o: { materialRequestId: number | null; requisicionId: number | null }) => o.materialRequestId == null && o.requisicionId != null;

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

        // La OC del pedido de obra queda enlazada a su requisición de la bandeja
        const requisicion = await tx.requisicion.findUnique({ where: { materialRequestId: request.id }, include: { lineas: true } });
        for (const l of lines) {
          (l as { requisicionLineaId?: number | null }).requisicionLineaId =
            requisicion?.lineas.find((rl) => rl.materialRequestDetailId === l.requestDetailId)?.id ?? null;
        }

        const number = await nextNumber(tx, "OC", () => tx.purchaseOrder.count());
        const order = await tx.purchaseOrder.create({
          data: {
            number,
            projectId: request.projectId,
            partnerId: body.partnerId,
            materialRequestId: request.id,
            requisicionId: requisicion?.id ?? null,
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
        if (order.requisicionId) await actualizarEstadoRequisicion(tx, order.requisicionId);
        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    ok(res, created, 201);
  })
);

// ─── OC desde un pedido del Taller (bandeja del ERP) ─────────────────────────

const createTallerSchema = z.object({
  requisicionId: z.number().int(),
  partnerId: z.number().int(),
  fecha: dateSchema,
  expectedDate: z.string().datetime().optional(),
  details: z
    .array(
      z.object({
        requisicionLineaId: z.number().int(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
      })
    )
    .min(1),
});

/**
 * Crea la OC de un pedido del Taller. El repuesto se pide en texto libre (sin insumo del catálogo)
 * y el costo no se imputa a ninguna obra: la OC no genera movimientos de presupuesto. El proveedor
 * se elige a mano.
 */
purchaseOrdersRouter.post(
  "/desde-requisicion",
  asyncHandler(async (req, res) => {
    const body = createTallerSchema.parse(req.body);
    const created = await prisma.$transaction(
      async (tx) => {
        const requisicion = await tx.requisicion.findUnique({ where: { id: body.requisicionId }, include: { lineas: true } });
        if (!requisicion) throw new NotFoundError("Requisición", body.requisicionId);
        if (requisicion.sistemaOrigen !== "TALLER") {
          throw new DomainError("USAR_PEDIDO_DE_OBRA", "Los pedidos de obra se compran desde su pedido (POST /compras con materialRequestId)", 422);
        }
        if (requisicion.estado === "RECHAZADA" || requisicion.estado === "ANULADA") {
          throw new DomainError("REQUISICION_CERRADA", `El pedido está ${requisicion.estado.toLowerCase()}`, 409);
        }
        const partner = await tx.partner.findUnique({ where: { id: body.partnerId } });
        if (!partner) throw new NotFoundError("Proveedor", body.partnerId);
        if (partner.kind === "SUBCONTRACTOR") throw new DomainError("INVALID_PARTNER", "El partner debe ser proveedor o mixto");

        // Lo que falta comprar de cada renglón: pedido menos lo que ya cubren las OC vigentes
        const ya = await tx.purchaseOrderDetail.groupBy({
          by: ["requisicionLineaId"],
          where: { requisicionLineaId: { in: requisicion.lineas.map((l) => l.id) }, order: { status: { not: DocumentStatus.ANULADO } } },
          _sum: { quantity: true },
        });
        const usado = new Map(ya.map((y) => [y.requisicionLineaId, Number(y._sum.quantity ?? 0)]));
        const pendientes = new Map(requisicion.lineas.map((l) => [l.id, Number(l.cantidad) - (usado.get(l.id) ?? 0)]));
        const problemas = validarRenglonesOC(body.details, pendientes);
        if (problemas.length) throw new DomainError("OC_INVALIDA", problemas.join("; "), 422, problemas);

        const lines = body.details.map((d) => {
          const rl = requisicion.lineas.find((l) => l.id === d.requisicionLineaId)!;
          const qty = toDecimal(d.quantity);
          const unitPrice = toDecimal(d.unitPrice);
          return {
            requisicionLineaId: rl.id,
            descripcion: rl.nroParte ? `${rl.descripcion} (parte ${rl.nroParte})` : rl.descripcion,
            quantity: qty,
            unitPrice,
            subtotal: qty.times(unitPrice).toDecimalPlaces(2),
          };
        });
        const total = lines.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));
        const primera = (await tx.purchaseOrder.count({ where: { requisicionId: requisicion.id, status: { not: DocumentStatus.ANULADO } } })) === 0;

        const number = await nextNumber(tx, "OC", () => tx.purchaseOrder.count());
        const order = await tx.purchaseOrder.create({
          data: {
            number,
            projectId: requisicion.projectId,
            partnerId: body.partnerId,
            requisicionId: requisicion.id,
            fecha: toDay(body.fecha),
            expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
            totalAmount: total,
            details: { create: lines },
          },
          include: poInclude,
        });
        await audit(tx, { entity: "PurchaseOrder", entityId: order.id, action: "CREATE", toStatus: DocumentStatus.BORRADOR, payload: { requisicionId: requisicion.id } });
        await actualizarEstadoRequisicion(tx, requisicion.id);
        // El Taller deja de comprar este pedido apenas el ERP lo toma
        if (primera) await avisarPedidoTomado(tx, requisicion.id, order.number);
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
        assertDocTransition(order.status, DocumentStatus.EMITIDA);
        if (esDelTaller(order)) {
          // Pedido del Taller: no compromete presupuesto de ninguna obra
          const next = await tx.purchaseOrder.update({ where: { id }, data: { status: DocumentStatus.EMITIDA, issueDate: new Date() }, include: poInclude });
          await audit(tx, { entity: "PurchaseOrder", entityId: id, action: "ISSUE", fromStatus: order.status, toStatus: next.status });
          await actualizarEstadoRequisicion(tx, order.requisicionId!);
          await avisarOcEmitida(tx, order.requisicionId!, order.number, order.fecha);
          return { ...next, budgetWarnings: [] as BudgetWarning[] };
        }
        if (!order.materialRequestId || !order.projectId || !order.materialRequest) {
          throw new TraceabilityError("La OC no está vinculada a un Pedido de Material");
        }

        // DIRECTO (y TIEMPO con ítem) a su ítem; COMÚN y TIEMPO sin ítem al pozo "a distribuir".
        const lines = await ledgerLines(tx, order.projectId, order.details);
        const budgetWarnings: BudgetWarning[] = [];
        for (const { budgetItemId, insumoId, amount } of lines) {
          const { warnings } = await postMovement(tx, {
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
        if (order.requisicionId) await actualizarEstadoRequisicion(tx, order.requisicionId);
        return { ...next, budgetWarnings };
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

        if (esDelTaller(order)) {
          // Pedido del Taller: no entra al stock ni al libro de una obra (el costo se define después)
          const next = await tx.purchaseOrder.update({
            where: { id },
            data: { status: DocumentStatus.RECIBIDO, receivedDate: fecha, receiptNumber: body.remito || null },
            include: poInclude,
          });
          await audit(tx, { entity: "PurchaseOrder", entityId: id, action: "RECEIVE", fromStatus: order.status, toStatus: next.status });
          await actualizarEstadoRequisicion(tx, order.requisicionId!);
          await avisarRecepcion(tx, order.requisicionId!, {
            number: order.number,
            receiptNumber: body.remito || null,
            fecha,
            detalles: order.details.map((d) => ({ requisicionLineaId: d.requisicionLineaId, quantity: d.quantity })),
          });
          return next;
        }
        if (!order.projectId || !order.materialRequestId) {
          throw new TraceabilityError("La OC no está vinculada a un Pedido de Material");
        }

        for (const d of order.details) {
          if (d.tipo === "TIEMPO") continue; // servicios y alquileres: no pasan por el depósito
          if (d.materialId == null) throw new TraceabilityError("Un renglón de la OC no tiene insumo del catálogo");
          const base = {
            projectId: order.projectId,
            materialId: d.materialId,
            fecha,
            sourceType: "PurchaseOrder",
            sourceId: order.id,
            unitCost: d.unitPrice,
            note: body.remito ? `Remito ${body.remito}` : null,
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
        for (const { budgetItemId, insumoId, amount } of lines) {
          await postMovement(tx, {
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
        if (order.requisicionId) await actualizarEstadoRequisicion(tx, order.requisicionId);
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

        if (order.status === DocumentStatus.EMITIDA && order.projectId && !esDelTaller(order)) {
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
        if (order.requisicionId) await actualizarEstadoRequisicion(tx, order.requisicionId);
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
      if (order.requisicionId) await actualizarEstadoRequisicion(tx, order.requisicionId);
    });
    ok(res, { deleted: true });
  })
);
