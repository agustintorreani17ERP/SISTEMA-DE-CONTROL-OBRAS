import { CertificacionEstado, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { assertImputableItem, postCost, postMovement, reverseMovements, type BudgetWarning } from "../../domain/budget";

/**
 * Actas de medición (modelo legado `Certificacion`).
 * Solo descuentan del presupuesto al quedar APROBADAS (o PAGADAS) y se revierten si
 * vuelven atrás, se rechazan o se borran.
 */
export const certificationsRouter = Router();

const SOURCE_TYPE = "Certificacion";
const COUNTED: CertificacionEstado[] = [CertificacionEstado.APROBADA, CertificacionEstado.PAGADA];

const certificationSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  partnerId: z.coerce.number().int().positive().optional(),
  budgetItemId: z.coerce.number().int().positive().optional(),
  subcontratista: z.string().trim().min(1).max(160).optional(),
  rubro: z.string().trim().min(1).max(240),
  unidad: z.string().trim().min(1).max(40).optional(),
  cantidad_medida: z.coerce.number().finite().nonnegative(),
  monto_total: z.coerce.number().finite().nonnegative(),
  estado: z.nativeEnum(CertificacionEstado).optional(),
  evidencia: z.string().trim().max(500).optional(),
  esAdenda: z.coerce.boolean().optional(),
});

const certificationInclude = {
  project: true,
  partner: true,
  budgetItem: true,
} satisfies Prisma.CertificacionInclude;

type CertRecord = Prisma.CertificacionGetPayload<{}>;

/** Aplica o revierte el descuento según el cambio de estado. */
async function syncLedger(
  tx: Prisma.TransactionClient,
  cert: CertRecord,
  previous: CertificacionEstado | null
): Promise<BudgetWarning[]> {
  if (!cert.budgetItemId) return [];
  const wasCounted = previous !== null && COUNTED.includes(previous);
  const isCounted = COUNTED.includes(cert.estado);

  if (!wasCounted && isCounted) {
    const base = {
      projectId: cert.projectId,
      budgetItemId: cert.budgetItemId,
      amount: cert.monto_total,
      quantity: cert.cantidad_medida,
      sourceType: SOURCE_TYPE,
      sourceId: cert.id,
      sourceNumber: `ACTA-${cert.id}`,
      note: cert.rubro,
    };
    if (cert.partnerId) {
      return postCost(tx, { ...base, source: "SUBCONTRACT" });
    }
    const { warnings } = await postMovement(tx, { ...base, source: "CLIENT_CERTIFICATE", stage: "ACTUAL" });
    return warnings;
  }
  if (wasCounted && !isCounted) {
    await reverseMovements(tx, {
      sourceType: SOURCE_TYPE,
      sourceId: cert.id,
      note: `Acta ${cert.id} pasó a ${cert.estado}`,
    });
  }
  return [];
}

certificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.certificacion.findMany({
        where: { projectId },
        include: certificationInclude,
        orderBy: { id: "desc" },
      })
    );
  })
);

certificationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = certificationSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: body.projectId } });
      if (!project) throw new NotFoundError("Obra", body.projectId);

      if (body.partnerId) {
        const partner = await tx.partner.findUnique({ where: { id: body.partnerId } });
        if (!partner) throw new NotFoundError("Subcontratista", body.partnerId);
        if (partner.kind === "SUPPLIER") {
          throw new DomainError("INVALID_PARTNER", "El partner debe ser subcontratista o mixto");
        }
      }
      if (body.budgetItemId) {
        await assertImputableItem(tx, body.projectId, body.budgetItemId);
      }

      const cert = await tx.certificacion.create({
        data: {
          projectId: body.projectId,
          partnerId: body.partnerId,
          budgetItemId: body.budgetItemId,
          subcontratista: body.subcontratista,
          rubro: body.rubro,
          unidad: body.unidad,
          cantidad_medida: body.cantidad_medida,
          monto_total: body.monto_total,
          estado: body.estado ?? CertificacionEstado.EN_REVISION,
          evidencia: body.evidencia,
          esAdenda: body.esAdenda ?? false,
        },
        include: certificationInclude,
      });

      const budgetWarnings = await syncLedger(tx, cert, null);
      await recalculateProjectFinancials(tx, cert.projectId);
      return { ...cert, budgetWarnings };
    });

    ok(res, created, 201);
  })
);

certificationsRouter.put(
  "/:id/estado",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { estado } = z.object({ estado: z.nativeEnum(CertificacionEstado) }).parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.certificacion.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Certificación", id);

      const cert = await tx.certificacion.update({
        where: { id },
        data: { estado },
        include: certificationInclude,
      });
      const budgetWarnings = await syncLedger(tx, cert, existing.estado);
      await recalculateProjectFinancials(tx, cert.projectId);
      return { ...cert, budgetWarnings };
    });

    ok(res, updated);
  })
);

certificationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.certificacion.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Certificación", id);
      await reverseMovements(tx, { sourceType: SOURCE_TYPE, sourceId: id, note: `Acta ${id} eliminada` });
      await tx.certificacion.delete({ where: { id } });
      await recalculateProjectFinancials(tx, existing.projectId);
    });

    ok(res, { deleted: true, id });
  })
);
