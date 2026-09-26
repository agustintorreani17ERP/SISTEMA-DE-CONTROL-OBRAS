import { Router, Request, Response } from "express";
import { z } from "zod";
import { CertificationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { assertImputableItem, postCost, postMovement, type BudgetWarning } from "../../domain/budget";
import { moneyNumber } from "../../lib/money";
import { auxSubtotal, buildCertificate, measuredQuantity } from "./certMath";

/**
 * Mediciones y certificados.
 * Flujo: Medición (MEDICION_BORRADOR) → borrador de certificado (CERTIFICADO_BORRADOR) → APROBADO.
 * Destino: avance de obra al cliente (sin partner, precio de venta) o subcontratista
 * (partner, precio de la lista de mano de obra).
 */
export const advancedCertificationsRouter = Router();

const auxiliaryCalculationSchema = z.object({
  descripcion: z.string().trim().default(""),
  location: z.string().trim().max(200).optional().nullable(),
  largo: z.coerce.number().min(0).default(0),
  ancho: z.coerce.number().min(0).default(0),
  alto: z.coerce.number().min(0).default(0),
  factor_repeticion: z.coerce.number().min(0).default(1),
  isDeduction: z.coerce.boolean().default(false),
  needsReview: z.coerce.boolean().default(false),
});

const itemPhotoSchema = z.object({
  url: z.string().min(1),
  comentario: z.string().optional().nullable(),
  fechaCaptura: z.string().optional().nullable(),
});

const itemInputSchema = z.object({
  budgetItemId: z.coerce.number().int().positive("El rubro es obligatorio"),
  cantidadPresente: z.coerce.number().min(0).default(0),
  precioUnitario: z.coerce.number().min(0).optional(),
  priceSource: z.enum(["VENTA", "MANO_DE_OBRA"]).optional(),
  auxiliaryCalculations: z.array(auxiliaryCalculationSchema).default([]),
  photos: z.array(itemPhotoSchema).default([]),
});

const measurementSchema = z.object({
  projectId: z.coerce.number().int().positive("La obra es obligatoria"),
  partnerId: z.coerce.number().int().positive().optional().nullable(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
  fecha: z.string().optional(),
  periodFrom: z.string().optional().nullable(),
  periodTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(itemInputSchema).min(1, "Agregá al menos un rubro a la medición"),
});

const certificationInclude = {
  project: true,
  partner: true,
  contract: true,
  items: {
    include: { budgetItem: true, auxiliaryCalculations: true, photos: true },
    orderBy: { id: "asc" as const },
  },
  invoices: { include: { payments: true } },
} satisfies Prisma.CertificationInclude;

const parseOptionalId = (raw: unknown) => (raw && raw !== "null" && raw !== "undefined" ? Number(raw) : null);

async function nextNumber(projectId: number, partnerId: number | null) {
  const latest = await prisma.certification.findFirst({
    where: { projectId, partnerId },
    orderBy: { numero: "desc" },
  });
  return (latest?.numero || 0) + 1;
}

/** Acumulado anterior por rubro: solo certificados APROBADOS del mismo destino. */
async function approvedHistory(projectId: number, partnerId: number | null, excludeId?: number) {
  const certs = await prisma.certification.findMany({
    where: { projectId, partnerId, estado: CertificationStatus.APROBADO },
    include: { items: true },
  });
  const map = new Map<number, number>();
  for (const c of certs) {
    if (c.id === excludeId) continue;
    for (const i of c.items) map.set(i.budgetItemId, (map.get(i.budgetItemId) ?? 0) + moneyNumber(i.cantidadPresente));
  }
  return map;
}

/** Precio de mano de obra por rubro (lista de precios de la obra). */
async function laborPriceMap(projectId: number) {
  const prices = await prisma.laborPrice.findMany({ where: { projectId, budgetItemId: { not: null } } });
  return new Map(prices.map((p) => [p.budgetItemId as number, moneyNumber(p.unitPrice)]));
}

advancedCertificationsRouter.get(
  "/next-number",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = parseOptionalId(req.query.partnerId);
    const n = await nextNumber(projectId, partnerId);
    ok(res, {
      projectId,
      partnerId,
      tipo: partnerId ? "SUBCONTRATISTA" : "OBRA_CLIENTE",
      nextNumber: n,
      displayLabel: `Medición N° ${String(n).padStart(2, "0")}`,
    });
  })
);

/**
 * GET /api/certifications/rubros-disponibles?projectId&partnerId
 * Rubros medibles con cantidad contratada, acumulado aprobado del destino y precio:
 * venta (avance de obra) o mano de obra (subcontratista).
 */
advancedCertificationsRouter.get(
  "/rubros-disponibles",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = parseOptionalId(req.query.partnerId);

    const [items, history, labor] = await Promise.all([
      prisma.budgetItem.findMany({ where: { projectId, nodeKind: "ITEM", isSystem: false }, orderBy: { sortOrder: "asc" } }),
      approvedHistory(projectId, partnerId),
      partnerId ? laborPriceMap(projectId) : Promise.resolve(new Map<number, number>()),
    ]);

    ok(
      res,
      items.map((bi) => {
        const salePrice = moneyNumber(bi.unitPrice);
        const laborPrice = labor.get(bi.id) ?? null;
        const unitPrice = partnerId ? laborPrice ?? 0 : salePrice;
        const cantidadAnterior = history.get(bi.id) ?? 0;
        return {
          id: bi.id,
          code: bi.code,
          name: bi.name,
          category: bi.category,
          unit: bi.unit || "un",
          unitPrice,
          salePrice,
          laborPrice,
          priceSource: partnerId ? "MANO_DE_OBRA" : "VENTA",
          missingPrice: partnerId ? laborPrice === null : false,
          totalContractQuantity: moneyNumber(bi.totalQuantity),
          cantidadAnterior,
          montoAnterior: Math.round(cantidadAnterior * unitPrice),
        };
      })
    );
  })
);

advancedCertificationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, partnerId, estado } = req.query;
    const where: Prisma.CertificationWhereInput = {};
    if (projectId) where.projectId = Number(projectId);
    if (partnerId !== undefined && partnerId !== "") {
      where.partnerId = partnerId === "null" || partnerId === "0" ? null : Number(partnerId);
    }
    if (estado) where.estado = String(estado) as CertificationStatus;
    ok(
      res,
      await prisma.certification.findMany({
        where,
        include: certificationInclude,
        orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      })
    );
  })
);

/**
 * GET /api/certifications/:id/summary
 * Medición N y Cert N con acumulados, % de avance, saldo, fondo de reparo, neto y
 * verificaciones finales (formato de certificados de subcontratistas).
 */
advancedCertificationsRouter.get(
  "/:id/summary",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id }, include: certificationInclude });
    if (!cert) throw new NotFoundError("Certificación", id);
    const history = await approvedHistory(cert.projectId, cert.partnerId, cert.id);

    const rows = cert.items.map((i) => ({
      code: i.budgetItem.code,
      name: i.budgetItem.name,
      unit: i.budgetItem.unit || "un",
      contractedQuantity: moneyNumber(i.budgetItem.totalQuantity),
      previousQuantity: cert.estado === CertificationStatus.APROBADO ? moneyNumber(i.cantidadAnterior) : history.get(i.budgetItemId) ?? 0,
      periodQuantity: moneyNumber(i.cantidadPresente),
      unitPrice: moneyNumber(i.precioUnitario),
    }));
    const summary = buildCertificate(rows, moneyNumber(cert.retentionPct));
    const pendingReview = cert.items.flatMap((i) => i.auxiliaryCalculations.filter((a) => a.needsReview)).length;
    const itemsTotal = cert.items.reduce((acc, i) => acc + moneyNumber(i.montoTotal), 0);

    ok(res, {
      certification: cert,
      summary,
      checks: {
        measurementMatchesCertificate: Math.abs(itemsTotal - summary.periodAmount) < 1,
        previousMatchesHistory: rows.every((r, idx) => Math.abs(r.previousQuantity - moneyNumber(cert.items[idx].cantidadAnterior)) < 1e-6),
        noPendingReview: pendingReview === 0,
        pendingReview,
        overContract: summary.rows.filter((r) => r.overContract).map((r) => r.code),
      },
    });
  })
);

advancedCertificationsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id }, include: certificationInclude });
    if (!cert) throw new NotFoundError("Certificación", id);
    ok(res, cert);
  })
);

/** Guarda los ítems de una medición (con cálculo auxiliar y fotos) y devuelve el total. */
async function writeItems(
  tx: Prisma.TransactionClient,
  certificationId: number,
  projectId: number,
  partnerId: number | null,
  items: z.infer<typeof itemInputSchema>[]
) {
  const history = new Map<number, number>();
  for (const c of await tx.certification.findMany({
    where: { projectId, partnerId, estado: CertificationStatus.APROBADO },
    include: { items: true },
  })) {
    for (const i of c.items) history.set(i.budgetItemId, (history.get(i.budgetItemId) ?? 0) + moneyNumber(i.cantidadPresente));
  }
  const labor = partnerId
    ? new Map(
        (await tx.laborPrice.findMany({ where: { projectId, budgetItemId: { not: null } } })).map((p) => [
          p.budgetItemId as number,
          moneyNumber(p.unitPrice),
        ])
      )
    : new Map<number, number>();

  let total = 0;
  for (const input of items) {
    const budgetItem = await assertImputableItem(tx, projectId, input.budgetItemId);
    const priceSource = input.priceSource ?? (partnerId ? "MANO_DE_OBRA" : "VENTA");
    const unitPrice =
      input.precioUnitario !== undefined
        ? input.precioUnitario
        : priceSource === "MANO_DE_OBRA"
        ? labor.get(budgetItem.id) ?? 0
        : moneyNumber(budgetItem.unitPrice);
    const presentQty = input.auxiliaryCalculations.length ? measuredQuantity(input.auxiliaryCalculations) : input.cantidadPresente;
    const previous = history.get(budgetItem.id) ?? 0;
    const amount = Math.round(presentQty * unitPrice);
    total += amount;

    const created = await tx.certificationItem.create({
      data: {
        certificationId,
        budgetItemId: budgetItem.id,
        cantidadAnterior: previous,
        cantidadPresente: presentQty,
        cantidadAcumulada: previous + presentQty,
        precioUnitario: unitPrice,
        montoTotal: amount,
        priceSource,
      },
    });
    for (const ac of input.auxiliaryCalculations) {
      await tx.auxiliaryCalculation.create({
        data: {
          certificationItemId: created.id,
          descripcion: ac.descripcion || ac.location || "Medición",
          location: ac.location ?? null,
          largo: ac.largo,
          ancho: ac.ancho,
          alto: ac.alto,
          factor_repeticion: ac.factor_repeticion,
          isDeduction: ac.isDeduction,
          needsReview: ac.needsReview,
          subtotal: auxSubtotal(ac),
        },
      });
    }
    for (const photo of input.photos) {
      await tx.itemPhoto.create({
        data: {
          certificationItemId: created.id,
          url: photo.url,
          comentario: photo.comentario ?? null,
          fechaCaptura: photo.fechaCaptura ? new Date(photo.fechaCaptura) : new Date(),
        },
      });
    }
  }
  return total;
}

/** POST /api/certifications — crea la medición (borrador) con su planilla. */
advancedCertificationsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = measurementSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    const partnerId = body.partnerId ?? null;

    let retentionPct = 0;
    if (partnerId) {
      const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
      if (!partner) throw new NotFoundError("Subcontratista", partnerId);
      if (partner.kind === "SUPPLIER") throw new DomainError("INVALID_PARTNER", "Elegí un subcontratista", 422);
    }
    if (body.contractId) {
      const contract = await prisma.subcontractorContract.findUnique({ where: { id: body.contractId } });
      if (!contract || contract.partnerId !== partnerId) throw new NotFoundError("Contrato del subcontratista", body.contractId);
      retentionPct = moneyNumber(contract.retentionPct);
    }

    const numero = await nextNumber(body.projectId, partnerId);
    const created = await prisma.$transaction(
      async (tx) => {
        const cert = await tx.certification.create({
          data: {
            projectId: body.projectId,
            partnerId,
            contractId: body.contractId ?? null,
            numero,
            fecha: body.fecha ? new Date(body.fecha) : new Date(),
            periodFrom: body.periodFrom ? new Date(body.periodFrom) : null,
            periodTo: body.periodTo ? new Date(body.periodTo) : null,
            estado: CertificationStatus.MEDICION_BORRADOR,
            retentionPct,
            notes: body.notes ?? null,
          },
        });
        const total = await writeItems(tx, cert.id, body.projectId, partnerId, body.items);
        return tx.certification.update({
          where: { id: cert.id },
          data: { montoTotal: total, netAmount: total },
          include: certificationInclude,
        });
      },
      { timeout: 60_000 }
    );
    ok(res, created, 201);
  })
);

/** PUT /api/certifications/:id — edita la medición mientras está en borrador. */
advancedCertificationsRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundError("Certificación", id);
    if (cert.estado === CertificationStatus.APROBADO) {
      throw new DomainError("MEASUREMENT_LOCKED", "El certificado ya está aprobado y no se puede modificar", 409);
    }
    const body = measurementSchema.partial().parse(req.body);
    const updated = await prisma.$transaction(
      async (tx) => {
        const data: Prisma.CertificationUpdateInput = {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.periodFrom !== undefined ? { periodFrom: body.periodFrom ? new Date(body.periodFrom) : null } : {}),
          ...(body.periodTo !== undefined ? { periodTo: body.periodTo ? new Date(body.periodTo) : null } : {}),
        };
        if (body.items?.length) {
          await tx.certificationItem.deleteMany({ where: { certificationId: id } });
          const total = await writeItems(tx, id, cert.projectId, cert.partnerId, body.items);
          const retention = Math.round((total * moneyNumber(cert.retentionPct)) / 100);
          Object.assign(data, { montoTotal: total, retentionAmount: retention, netAmount: total - retention });
        }
        return tx.certification.update({ where: { id }, data, include: certificationInclude });
      },
      { timeout: 60_000 }
    );
    ok(res, updated);
  })
);

/** Fondo de reparo del certificado (solo en borrador; lo confirma el usuario). */
advancedCertificationsRouter.patch(
  "/:id/retention",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { retentionPct } = z.object({ retentionPct: z.coerce.number().min(0).max(30) }).parse(req.body);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundError("Certificación", id);
    if (cert.estado === CertificationStatus.APROBADO) {
      throw new DomainError("CERT_LOCKED", "El certificado ya está aprobado", 409);
    }
    const total = moneyNumber(cert.montoTotal);
    const retentionAmount = Math.round((total * retentionPct) / 100);
    ok(
      res,
      await prisma.certification.update({
        where: { id },
        data: { retentionPct, retentionAmount, netAmount: total - retentionAmount },
        include: certificationInclude,
      })
    );
  })
);

/** POST /api/certifications/:id/close-measurement — cierra la medición y crea el borrador del certificado. */
advancedCertificationsRouter.post(
  "/:id/close-measurement",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({
      where: { id },
      include: { items: { include: { auxiliaryCalculations: true } } },
    });
    if (!existing) throw new NotFoundError("Certificación", id);
    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError("ALREADY_APPROVED", "El certificado ya está aprobado", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const item of existing.items) {
        const qty = item.auxiliaryCalculations.length
          ? measuredQuantity(
              item.auxiliaryCalculations.map((a) => ({
                largo: moneyNumber(a.largo),
                ancho: moneyNumber(a.ancho),
                alto: moneyNumber(a.alto),
                factor_repeticion: moneyNumber(a.factor_repeticion),
                isDeduction: a.isDeduction,
              }))
            )
          : moneyNumber(item.cantidadPresente);
        const amount = Math.round(qty * moneyNumber(item.precioUnitario));
        total += amount;
        await tx.certificationItem.update({
          where: { id: item.id },
          data: {
            cantidadPresente: qty,
            cantidadAcumulada: moneyNumber(item.cantidadAnterior) + qty,
            montoTotal: amount,
          },
        });
      }
      const retentionAmount = Math.round((total * moneyNumber(existing.retentionPct)) / 100);
      return tx.certification.update({
        where: { id },
        data: {
          estado: CertificationStatus.CERTIFICADO_BORRADOR,
          montoTotal: total,
          retentionAmount,
          netAmount: total - retentionAmount,
        },
        include: certificationInclude,
      });
    });
    ok(res, updated);
  })
);

/**
 * POST /api/certifications/:id/approve
 * Aprueba el certificado: descuenta del presupuesto (libro mayor), actualiza el contrato del
 * subcontratista y genera la factura.
 */
advancedCertificationsRouter.post(
  "/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: { project: true, partner: true, items: { include: { budgetItem: true } }, invoices: true },
    });
    if (!cert) throw new NotFoundError("Certificación", id);

    // Ya aprobado: no se vuelve a descontar del presupuesto ni a facturar.
    if (cert.estado === CertificationStatus.APROBADO) {
      ok(res, { certification: cert, invoice: cert.invoices[0] ?? null, budgetWarnings: [], message: "El certificado ya se encontraba aprobado." });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const total = moneyNumber(cert.montoTotal);
      const retentionAmount = Math.round((total * moneyNumber(cert.retentionPct)) / 100);
      const approvedCert = await tx.certification.update({
        where: { id },
        data: { estado: CertificationStatus.APROBADO, retentionAmount, netAmount: total - retentionAmount },
        include: certificationInclude,
      });

      // Presupuesto: al cliente = avance real; de subcontratista = costo interno
      const budgetWarnings: BudgetWarning[] = [];
      for (const item of cert.items) {
        const base = {
          projectId: cert.projectId,
          budgetItemId: item.budgetItemId,
          amount: item.montoTotal,
          quantity: item.cantidadPresente,
          sourceType: "Certification",
          sourceId: cert.id,
          sourceNumber: `CERT-${String(cert.numero).padStart(2, "0")}${cert.partner ? ` ${cert.partner.name}` : ""}`,
        };
        if (cert.partnerId) {
          budgetWarnings.push(...(await postCost(tx, { ...base, source: "SUBCONTRACT" })));
        } else {
          const { warnings } = await postMovement(tx, { ...base, source: "CLIENT_CERTIFICATE", stage: "ACTUAL" });
          budgetWarnings.push(...warnings);
        }
      }
      if (cert.contractId) {
        await tx.subcontractorContract.update({
          where: { id: cert.contractId },
          data: { certifiedAmount: { increment: total } },
        });
      }
      await recalculateProjectFinancials(tx, cert.projectId);

      // Factura (recibida del subcontratista o emitida al cliente)
      const isSubcontractor = Boolean(cert.partnerId);
      const now = new Date();
      const dueDate = new Date(now.getTime() + 30 * 86400000);
      const iva10 = Math.round(total / 11);
      let invoice = cert.invoices[0] ?? null;
      if (!invoice) {
        invoice = await tx.invoice.create({
          data: {
            projectId: cert.projectId,
            partnerId: cert.partnerId || null,
            certificationId: cert.id,
            numeroFactura: `${isSubcontractor ? "001-002" : "001-001"}-${String(cert.numero).padStart(7, "0")}`,
            timbrado: "PENDIENTE",
            tipo: isSubcontractor ? "RECIBIDA" : "EMITIDA",
            estado: "APROBADA",
            fechaEmision: now,
            fechaVencimiento: dueDate,
            condicionVenta: "CREDITO",
            concepto: isSubcontractor
              ? `Cert. N° ${cert.numero} — ${cert.partner?.name ?? ""} — ${cert.project.name}`
              : `Certificado N° ${cert.numero} de avance de obra — ${cert.project.name}`,
            subtotal: total - iva10,
            montoExento: 0,
            montoIva5: 0,
            montoIva10: iva10,
            total,
            threeWayMatchPassed: true,
            matchNotes: retentionAmount
              ? `Fondo de reparo ${moneyNumber(cert.retentionPct)}%: ${retentionAmount.toLocaleString("es-PY")} Gs. Neto a pagar ${(total - retentionAmount).toLocaleString("es-PY")} Gs.`
              : "Certificado aprobado desde la medición.",
          },
        });
        for (const item of cert.items) {
          const amount = moneyNumber(item.montoTotal);
          const itemIva = Math.round(amount / 11);
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              description: `${item.budgetItem.code} - ${item.budgetItem.name}`,
              quantity: moneyNumber(item.cantidadPresente) || 1,
              unitPrice: moneyNumber(item.precioUnitario),
              vatType: "IVA10",
              montoExento: 0,
              montoIva5: 0,
              montoIva10: itemIva,
              subtotal: amount - itemIva,
            },
          });
        }
      }
      return { certification: approvedCert, invoice, budgetWarnings };
    });
    ok(res, result, 201);
  })
);

advancedCertificationsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Certificación", id);
    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError("CANNOT_DELETE_APPROVED", "No se puede borrar un certificado aprobado", 409);
    }
    await prisma.certification.delete({ where: { id } });
    ok(res, { deleted: true, id });
  })
);
