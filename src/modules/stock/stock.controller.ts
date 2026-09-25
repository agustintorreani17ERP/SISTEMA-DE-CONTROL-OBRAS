import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { adjustStock, consumeStock } from "../../domain/stock";
import { audit } from "../../domain/audit";

export const stockRouter = Router();

stockRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.warehouseStock.findMany({
        where: projectId ? { projectId } : undefined,
        include: { project: true, material: true },
        orderBy: [{ projectId: "asc" }, { materialId: "asc" }],
      })
    );
  })
);

const movementSchema = z.object({
  projectId: z.number().int(),
  materialId: z.number().int(),
  quantity: z.coerce.number().positive(),
  note: z.string().max(500).optional(),
});

async function validateStockReference(
  tx: Prisma.TransactionClient,
  projectId: number,
  materialId: number
) {
  const [project, material] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId } }),
    tx.material.findUnique({ where: { id: materialId } }),
  ]);
  if (!project) throw new NotFoundError("Obra", projectId);
  if (!material) throw new NotFoundError("Material", materialId);
}

stockRouter.post(
  "/:projectId/consumos",
  asyncHandler(async (req, res) => {
    const body = movementSchema.omit({ projectId: true }).parse(req.body);
    const projectId = Number(req.params.projectId);
    const created = await prisma.$transaction(
      async (tx) => {
        await validateStockReference(tx, projectId, body.materialId);
        const sourceId = Date.now();
        await consumeStock(tx, {
          ...body,
          projectId,
          sourceType: "ManualConsumption",
          sourceId,
        });
        await audit(tx, {
          entity: "StockMovement",
          entityId: sourceId,
          action: "CONSUMPTION",
          payload: { projectId, materialId: body.materialId, quantity: body.quantity },
        });
        return tx.warehouseStock.findUnique({
          where: { projectId_materialId: { projectId, materialId: body.materialId } },
          include: { material: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, created);
  })
);

const adjustmentSchema = z.object({
  projectId: z.number().int(),
  materialId: z.number().int(),
  quantity: z.coerce.number().refine((value) => value !== 0, "El ajuste no puede ser cero"),
  note: z.string().min(3).max(500),
});

stockRouter.post(
  "/ajustes",
  asyncHandler(async (req, res) => {
    const body = adjustmentSchema.parse(req.body);
    const created = await prisma.$transaction(
      async (tx) => {
        await validateStockReference(tx, body.projectId, body.materialId);
        const sourceId = Date.now();
        await adjustStock(tx, { ...body, sourceType: "ManualAdjustment", sourceId });
        await audit(tx, {
          entity: "StockMovement",
          entityId: sourceId,
          action: "ADJUSTMENT",
          payload: body,
        });
        return tx.warehouseStock.findUnique({
          where: {
            projectId_materialId: { projectId: body.projectId, materialId: body.materialId },
          },
          include: { material: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, created);
  })
);

stockRouter.get(
  "/movimientos",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    if (projectId !== undefined && Number.isNaN(projectId)) {
      throw new DomainError("INVALID_PROJECT", "projectId debe ser numérico");
    }
    ok(
      res,
      await prisma.stockMovement.findMany({
        where: projectId ? { projectId } : undefined,
        include: { project: true, material: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    );
  })
);