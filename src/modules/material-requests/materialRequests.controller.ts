import { Router } from "express";
import { DocumentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { assertDocTransition, assertMutableDocument } from "../../domain/lifecycle";
import { audit, nextNumber } from "../../domain/audit";
import { toDecimal } from "../../lib/money";

export const materialRequestsRouter = Router();

materialRequestsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const data = await prisma.materialRequest.findMany({
      include: {
        project: true,
        workFront: true,
        requestedBy: true,
        details: { include: { material: true, budgetItem: true } },
        purchaseOrders: { select: { id: true, number: true, status: true } },
      },
      orderBy: { id: "desc" },
    });
    ok(res, data);
  })
);

const createSchema = z.object({
  projectId: z.number().int(),
  workFrontId: z.number().int(),
  requestedById: z.number().int(),
  requestedDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  details: z
    .array(
      z.object({
        materialId: z.number().int(),
        budgetItemId: z.number().int().optional(),
        quantity: z.coerce.number().positive(),
      })
    )
    .min(1),
});

materialRequestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      let front = await tx.workFront.findUnique({
        where: { id: body.workFrontId },
        include: { chief: true },
      });
      if (!front) {
        const firstFront = await tx.workFront.findFirst({
          where: { projectId: body.projectId },
          include: { chief: true },
        });
        if (firstFront) {
          front = firstFront;
        } else {
          throw new NotFoundError("Frente / Sector", body.workFrontId);
        }
      }
      if (!front) {
        throw new NotFoundError("Frente / Sector", body.workFrontId);
      }

      const requester = (await tx.personnel.findUnique({ where: { id: body.requestedById } })) ||
        (await tx.personnel.findFirst({ where: { active: true } }));
      if (!requester) throw new NotFoundError("Personal", body.requestedById);

      const defaultItem = await tx.budgetItem.findFirst({ where: { projectId: body.projectId } });

      const validatedDetails = [];
      for (const line of body.details) {
        const material = await tx.material.findUnique({ where: { id: line.materialId } });
        if (!material) {
          throw new NotFoundError("Material", line.materialId);
        }
        const resolvedBudgetItemId = line.budgetItemId || defaultItem?.id || 1;
        validatedDetails.push({
          materialId: line.materialId,
          budgetItemId: resolvedBudgetItemId,
          quantity: line.quantity,
        });
      }

      const number = await nextNumber(tx, "PM", () => tx.materialRequest.count());
      const request = await tx.materialRequest.create({
        data: {
          number,
          projectId: body.projectId,
          workFrontId: front.id,
          requestedById: requester.id,
          requestedDate: body.requestedDate || new Date(),
          notes: body.notes,
          details: {
            create: validatedDetails.map((d) => ({
              materialId: d.materialId,
              budgetItemId: d.budgetItemId,
              quantity: toDecimal(d.quantity),
            })),
          },
        },
        include: { details: true },
      });
      await audit(tx, {
        entity: "MaterialRequest",
        entityId: request.id,
        action: "CREATE",
        toStatus: DocumentStatus.BORRADOR,
      });
      return request;
    });

    ok(res, created, 201);
  })
);

materialRequestsRouter.post(
  "/:id/aprobar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(async (tx) => {
      const request = await tx.materialRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundError("Pedido de material", id);
      assertDocTransition(request.status, DocumentStatus.APROBADO_PARA_COMPRA);
      const next = await tx.materialRequest.update({
        where: { id },
        data: { status: DocumentStatus.APROBADO_PARA_COMPRA },
        include: { details: { include: { material: true } } },
      });
      await audit(tx, {
        entity: "MaterialRequest",
        entityId: id,
        action: "APPROVE",
        fromStatus: request.status,
        toStatus: next.status,
      });
      return next;
    });
    ok(res, updated);
  })
);

materialRequestsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const request = await tx.materialRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundError("Pedido de material", id);
      assertMutableDocument("Pedido de material", request.status);
      await tx.materialRequest.delete({ where: { id } });
      await audit(tx, {
        entity: "MaterialRequest",
        entityId: id,
        action: "DELETE",
        fromStatus: request.status,
      });
    });
    ok(res, { deleted: true });
  })
);
