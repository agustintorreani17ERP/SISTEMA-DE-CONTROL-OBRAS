import { Router } from "express";
import { Prisma, SubcontractStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { assertMutableSubcontract, assertSubTransition } from "../../domain/lifecycle";
import { audit, nextNumber } from "../../domain/audit";
import { assertImputableItem, postCost, reverseMovements, type BudgetWarning } from "../../domain/budget";
import { toDecimal } from "../../lib/money";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { subcontractOverMeasured } from "../../domain/progress";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";

export const subcontractsRouter = Router();

const contractInclude = {
  partner: true,
  project: true,
  budgetItem: true,
  certificates: true,
} satisfies Prisma.SubcontractorContractInclude;

subcontractsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(
      res,
      await prisma.subcontractorContract.findMany({
        include: contractInclude,
        orderBy: { id: "desc" },
      })
    );
  })
);

const contractSchema = z.object({
  projectId: z.number().int(),
  partnerId: z.number().int(),
  budgetItemId: z.number().int(),
  description: z.string().min(5),
  contractAmount: z.coerce.number().positive(),
  /** Fondo de reparo por defecto de sus certificados (%). */
  retentionPct: z.coerce.number().min(0).max(30).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

subcontractsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = contractSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({ where: { id: body.partnerId } });
      if (!partner) throw new NotFoundError("Subcontratista", body.partnerId);
      if (partner.kind === "SUPPLIER") {
        throw new DomainError("INVALID_PARTNER", "El partner debe ser subcontratista o mixto");
      }
      await assertImputableItem(tx, body.projectId, body.budgetItemId);
      const number = await nextNumber(tx, "SC", () => tx.subcontractorContract.count());
      const contract = await tx.subcontractorContract.create({
        data: {
          number,
          ...body,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
        },
        include: contractInclude,
      });
      await audit(tx, {
        entity: "SubcontractorContract",
        entityId: contract.id,
        action: "CREATE",
        toStatus: SubcontractStatus.BORRADOR,
      });
      return contract;
    });
    ok(res, created, 201);
  })
);

const certSchema = z
  .object({
    contractId: z.coerce.number().int().positive().optional(),
    subcontractId: z.coerce.number().int().positive().optional(),
    periodFrom: z.coerce.date().optional(),
    periodTo: z.coerce.date().optional(),
    physicalProgressPct: z.coerce.number().gt(0).lte(100).optional(),
    advancePercentage: z.coerce.number().gt(0).lte(100).optional(),
    /** Cantidad ejecutada por el subcontratista, en la unidad de la partida. */
    quantity: z.coerce.number().nonnegative().optional(),
    amount: z.coerce.number().positive(),
  })
  .refine((b) => b.contractId || b.subcontractId, { message: "El contrato es obligatorio" });

const SUB_CERT = "SubcontractorCertificate";

subcontractsRouter.post(
  "/certificados",
  asyncHandler(async (req, res) => {
    const body = certSchema.parse(req.body);
    const contractId = (body.contractId ?? body.subcontractId)!;
    const created = await prisma.$transaction(async (tx) => {
      const contract = await tx.subcontractorContract.findUnique({ where: { id: contractId } });
      if (!contract) throw new NotFoundError("Contrato", contractId);
      if (contract.status === SubcontractStatus.CERRADO) {
        throw new DomainError("CONTRACT_CLOSED", `El contrato ${contract.number} está cerrado`, 409);
      }
      const number = await nextNumber(tx, "CERT", () => tx.subcontractorCertificate.count());
      const now = new Date();
      return tx.subcontractorCertificate.create({
        data: {
          number,
          contractId: contract.id,
          periodFrom: body.periodFrom ?? now,
          periodTo: body.periodTo ?? now,
          physicalProgressPct: body.physicalProgressPct ?? body.advancePercentage ?? 0,
          quantity: body.quantity,
          amount: body.amount,
        },
      });
    });
    ok(res, created, 201);
  })
);

/** Certificar = aprobar el avance: descuenta costo (y cantidad) de la partida del contrato. */
async function certifyCertificate(id: number) {
  return prisma.$transaction(
    async (tx) => {
      const cert = await tx.subcontractorCertificate.findUnique({
        where: { id },
        include: { contract: true },
      });
      if (!cert) throw new NotFoundError("Certificado", id);
      if (cert.status === SubcontractStatus.CERTIFICADO) return { ...cert, budgetWarnings: [] as BudgetWarning[] };
      assertSubTransition(cert.status, SubcontractStatus.CERTIFICADO);

      const remainingContract = toDecimal(cert.contract.contractAmount).minus(
        toDecimal(cert.contract.certifiedAmount)
      );
      if (toDecimal(cert.amount).gt(remainingContract)) {
        throw new DomainError(
          "CONTRACT_CEILING_EXCEEDED",
          `El certificado ${cert.number} excede el saldo del contrato ${cert.contract.number}`
        );
      }

      // Control contra la medición oficial (antes de sumar esta cantidad al libro mayor).
      const measurementWarnings = cert.quantity
        ? await subcontractOverMeasured(tx, cert.contract.projectId, [
            { budgetItemId: cert.contract.budgetItemId, quantity: Number(cert.quantity) },
          ])
        : [];
      const budgetWarnings = await postCost(tx, {
        projectId: cert.contract.projectId,
        budgetItemId: cert.contract.budgetItemId,
        amount: cert.amount,
        quantity: cert.quantity,
        source: "SUBCONTRACT",
        sourceType: SUB_CERT,
        sourceId: cert.id,
        sourceNumber: `${cert.number} / ${cert.contract.number}`,
      });
      await postAsientoDesdeRegla(tx, {
        evento: EVENTO.CERTIFICADO_SUBCONTRATISTA_APROBADO,
        projectId: cert.contract.projectId,
        concepto: `Certificado ${cert.number} / ${cert.contract.number}`,
        sourceType: SUB_CERT,
        sourceId: cert.id,
        debe: [{ monto: cert.amount, budgetItemId: cert.contract.budgetItemId }],
        haber: [{ monto: cert.amount, partnerId: cert.contract.partnerId }],
      });

      const next = await tx.subcontractorCertificate.update({
        where: { id },
        data: { status: SubcontractStatus.CERTIFICADO, issuedAt: new Date() },
      });
      await tx.subcontractorContract.update({
        where: { id: cert.contractId },
        data: {
          status: SubcontractStatus.CERTIFICADO,
          certifiedAmount: { increment: cert.amount },
        },
      });
      await recalculateProjectFinancials(tx, cert.contract.projectId);
      await audit(tx, {
        entity: SUB_CERT,
        entityId: id,
        action: "CERTIFY",
        fromStatus: cert.status,
        toStatus: next.status,
      });
      return { ...next, budgetWarnings, measurementWarnings };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

subcontractsRouter.post(
  "/certificados/:id/certificar",
  asyncHandler(async (req, res) => {
    ok(res, await certifyCertificate(Number(req.params.id)));
  })
);

// La pantalla usa "aprobar" como paso previo al pago: equivale a certificar (idempotente).
subcontractsRouter.post(
  "/certificados/:id/aprobar",
  asyncHandler(async (req, res) => {
    ok(res, await certifyCertificate(Number(req.params.id)));
  })
);

subcontractsRouter.post(
  "/certificados/:id/anular",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(async (tx) => {
      const cert = await tx.subcontractorCertificate.findUnique({ where: { id }, include: { contract: true } });
      if (!cert) throw new NotFoundError("Certificado", id);
      assertSubTransition(cert.status, SubcontractStatus.ANULADO);

      if (cert.status === SubcontractStatus.CERTIFICADO) {
        await reverseMovements(tx, { sourceType: SUB_CERT, sourceId: id, note: `Anulación ${cert.number}` });
        await tx.subcontractorContract.update({
          where: { id: cert.contractId },
          data: { certifiedAmount: { decrement: cert.amount } },
        });
        await recalculateProjectFinancials(tx, cert.contract.projectId);
      }
      const next = await tx.subcontractorCertificate.update({
        where: { id },
        data: { status: SubcontractStatus.ANULADO },
      });
      await audit(tx, {
        entity: SUB_CERT,
        entityId: id,
        action: "VOID",
        fromStatus: cert.status,
        toStatus: next.status,
      });
      return next;
    });
    ok(res, updated);
  })
);

// El pago es tesorería: no vuelve a tocar el presupuesto (ya se descontó al certificar).
subcontractsRouter.post(
  "/certificados/:id/pagar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(
      async (tx) => {
        const cert = await tx.subcontractorCertificate.findUnique({
          where: { id },
          include: { contract: true },
        });
        if (!cert) throw new NotFoundError("Certificado", id);
        assertSubTransition(cert.status, SubcontractStatus.PAGADO);

        const next = await tx.subcontractorCertificate.update({
          where: { id },
          data: { status: SubcontractStatus.PAGADO, paidAt: new Date() },
        });
        await tx.subcontractorContract.update({
          where: { id: cert.contractId },
          data: {
            status: SubcontractStatus.PAGADO,
            paidAmount: { increment: cert.amount },
          },
        });
        await audit(tx, {
          entity: SUB_CERT,
          entityId: id,
          action: "PAY",
          fromStatus: cert.status,
          toStatus: next.status,
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    ok(res, updated);
  })
);

subcontractsRouter.post(
  "/:id/cerrar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(async (tx) => {
      const contract = await tx.subcontractorContract.findUnique({ where: { id } });
      if (!contract) throw new NotFoundError("Contrato", id);
      assertSubTransition(contract.status, SubcontractStatus.CERRADO);
      const next = await tx.subcontractorContract.update({
        where: { id },
        data: { status: SubcontractStatus.CERRADO },
        include: contractInclude,
      });
      await audit(tx, {
        entity: "SubcontractorContract",
        entityId: id,
        action: "CLOSE",
        fromStatus: contract.status,
        toStatus: next.status,
      });
      return next;
    });
    ok(res, updated);
  })
);

subcontractsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const contract = await tx.subcontractorContract.findUnique({ where: { id } });
      if (!contract) throw new NotFoundError("Contrato", id);
      assertMutableSubcontract("Contrato de subcontratista", contract.status);
      await tx.subcontractorContract.delete({ where: { id } });
    });
    ok(res, { deleted: true });
  })
);
