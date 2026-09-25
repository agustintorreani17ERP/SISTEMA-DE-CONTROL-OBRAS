import { Router } from "express";
import { Prisma, SubcontractStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { assertMutableSubcontract, assertSubTransition } from "../../domain/lifecycle";
import { audit, nextNumber } from "../../domain/audit";
import { commitBudget, executeBudget } from "../../domain/budget";
import { toDecimal } from "../../lib/money";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";

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
      const item = await tx.budgetItem.findUnique({ where: { id: body.budgetItemId } });
      if (!item || item.projectId !== body.projectId) {
        throw new DomainError("BUDGET_ITEM_MISMATCH", "La partida no pertenece a la obra");
      }
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

const certSchema = z.object({
  contractId: z.number().int(),
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
  physicalProgressPct: z.coerce.number().gt(0).lte(100),
  amount: z.coerce.number().positive(),
});

subcontractsRouter.post(
  "/certificados",
  asyncHandler(async (req, res) => {
    const body = certSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const contract = await tx.subcontractorContract.findUnique({ where: { id: body.contractId } });
      if (!contract) throw new NotFoundError("Contrato", body.contractId);
      assertMutableSubcontract("Contrato de subcontratista", contract.status);
      const number = await nextNumber(tx, "CERT", () => tx.subcontractorCertificate.count());
      return tx.subcontractorCertificate.create({
        data: {
          number,
          contractId: contract.id,
          periodFrom: new Date(body.periodFrom),
          periodTo: new Date(body.periodTo),
          physicalProgressPct: body.physicalProgressPct,
          amount: body.amount,
        },
      });
    });
    ok(res, created, 201);
  })
);

subcontractsRouter.post(
  "/certificados/:id/certificar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.$transaction(
      async (tx) => {
        const cert = await tx.subcontractorCertificate.findUnique({
          where: { id },
          include: { contract: true },
        });
        if (!cert) throw new NotFoundError("Certificado", id);
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

        await commitBudget(tx, {
          budgetItemId: cert.contract.budgetItemId,
          amount: cert.amount,
          kind: "SUBCONTRACT_CERTIFICATE",
          sourceType: "SubcontractorCertificate",
          sourceId: cert.id,
          note: `Certificado ${cert.number} / ${cert.contract.number}`,
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
          entity: "SubcontractorCertificate",
          entityId: id,
          action: "CERTIFY",
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

        await executeBudget(tx, cert.contract.budgetItemId, cert.amount);
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
          entity: "SubcontractorCertificate",
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
