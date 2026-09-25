import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { CertificationStatus } from "@prisma/client";

export const advancedCertificationsRouter = Router();

// ----------------------------------------------------
// Validation Schemas
// ----------------------------------------------------
const auxiliaryCalculationSchema = z.object({
  id: z.number().optional(),
  descripcion: z.string().trim().min(1, "La descripción del cómputo es obligatoria"),
  largo: z.coerce.number().min(0).default(0),
  ancho: z.coerce.number().min(0).default(0),
  alto: z.coerce.number().min(0).default(0),
  factor_repeticion: z.coerce.number().min(0).default(1),
  subtotal: z.coerce.number().min(0).optional(),
});

const itemPhotoSchema = z.object({
  id: z.number().optional(),
  url: z.string().url("URL de imagen inválida"),
  comentario: z.string().optional().nullable(),
  fechaCaptura: z.string().optional().nullable(),
});

const certificationItemInputSchema = z.object({
  budgetItemId: z.coerce.number().int().positive("El rubro presupuestario es obligatorio"),
  cantidadAnterior: z.coerce.number().min(0).default(0),
  cantidadPresente: z.coerce.number().min(0).default(0),
  precioUnitario: z.coerce.number().min(0).optional(),
  auxiliaryCalculations: z.array(auxiliaryCalculationSchema).optional().default([]),
  photos: z.array(itemPhotoSchema).optional().default([]),
});

const createCertificationSchema = z.object({
  projectId: z.coerce.number().int().positive("La obra es obligatoria"),
  partnerId: z.coerce.number().int().positive().optional().nullable(),
  fecha: z.string().optional(),
  notes: z.string().optional().nullable(),
  items: z.array(certificationItemInputSchema).min(1, "Debe incluir al menos un rubro para medir"),
});

const certificationInclude = {
  project: true,
  partner: true,
  items: {
    include: {
      budgetItem: true,
      auxiliaryCalculations: true,
      photos: true,
    },
    orderBy: { id: "asc" as const },
  },
  invoices: {
    include: {
      payments: true,
    },
  },
};

// ----------------------------------------------------
// Helper: Autonumeración Inteligente
// ----------------------------------------------------
async function getNextCertificationNumber(projectId: number, partnerId?: number | null): Promise<number> {
  const whereClause: any = { projectId };
  if (partnerId && partnerId > 0) {
    whereClause.partnerId = partnerId;
  } else {
    whereClause.partnerId = null;
  }

  const latest = await prisma.certification.findFirst({
    where: whereClause,
    orderBy: { numero: "desc" },
  });

  return (latest?.numero || 0) + 1;
}

// ----------------------------------------------------
// GET /api/certifications/next-number (Consulta previa de autonumeración)
// ----------------------------------------------------
advancedCertificationsRouter.get(
  "/next-number",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de obra es requerido");
    }

    const rawPartnerId = req.query.partnerId;
    const partnerId = rawPartnerId && rawPartnerId !== "null" && rawPartnerId !== "undefined"
      ? Number(rawPartnerId)
      : null;

    const nextNumber = await getNextCertificationNumber(projectId, partnerId);
    ok(res, {
      projectId,
      partnerId,
      tipo: partnerId ? "SUBCONTRATISTA" : "OBRA_CLIENTE",
      nextNumber,
      displayLabel: `Medición N° ${String(nextNumber).padStart(2, "0")}`,
    });
  })
);

// ----------------------------------------------------
// GET /api/certifications/rubros-disponibles
// Retorna rubros con sus cantidades anteriores acumuladas automáticamente
// ----------------------------------------------------
advancedCertificationsRouter.get(
  "/rubros-disponibles",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de obra es requerido");
    }

    const rawPartnerId = req.query.partnerId;
    const partnerId = rawPartnerId && rawPartnerId !== "null" && rawPartnerId !== "undefined"
      ? Number(rawPartnerId)
      : null;

    // Obtener rubros de la obra
    const budgetItems = await prisma.budgetItem.findMany({
      where: { projectId },
      orderBy: [{ hierarchyLevel: "asc" }, { code: "asc" }],
    });

    // Obtener certificaciones previas para calcular el acumulado anterior
    const prevWhere: any = { projectId };
    if (partnerId && partnerId > 0) {
      prevWhere.partnerId = partnerId;
    } else {
      prevWhere.partnerId = null;
    }

    const previousCerts = await prisma.certification.findMany({
      where: prevWhere,
      include: {
        items: true,
      },
      orderBy: { numero: "asc" },
    });

    // Sumar cantidad acumulada histórica por budgetItemId
    const historyMap = new Map<number, number>();
    for (const cert of previousCerts) {
      for (const item of cert.items) {
        const prev = historyMap.get(item.budgetItemId) || 0;
        historyMap.set(item.budgetItemId, prev + Number(item.cantidadPresente || 0));
      }
    }

    const enrichedRubros = budgetItems.map((bi) => {
      const cantidadAnterior = historyMap.get(bi.id) || 0;
      return {
        id: bi.id,
        code: bi.code,
        name: bi.name,
        category: bi.category,
        unit: bi.unit || "un",
        unitPrice: Number(bi.unitPrice || 0),
        totalContractQuantity: Number(bi.totalQuantity || 0),
        cantidadAnterior,
        montoAnterior: Math.round(cantidadAnterior * Number(bi.unitPrice || 0)),
      };
    });

    ok(res, enrichedRubros);
  })
);

// ----------------------------------------------------
// GET /api/certifications (Listar Mediciones y Certificados)
// ----------------------------------------------------
advancedCertificationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, partnerId, estado } = req.query;
    const where: any = {};

    if (projectId) {
      where.projectId = Number(projectId);
    }
    if (partnerId !== undefined && partnerId !== "") {
      if (partnerId === "null" || partnerId === "0") {
        where.partnerId = null;
      } else {
        where.partnerId = Number(partnerId);
      }
    }
    if (estado) {
      where.estado = String(estado);
    }

    const certifications = await prisma.certification.findMany({
      where,
      include: certificationInclude,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    });

    ok(res, certifications);
  })
);

// ----------------------------------------------------
// GET /api/certifications/:id (Detalle Completo)
// ----------------------------------------------------
advancedCertificationsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: certificationInclude,
    });

    if (!cert) throw new NotFoundError("Certificación", id);
    ok(res, cert);
  })
);

// ----------------------------------------------------
// POST /api/certifications (Creación con Autonumeración Inteligente)
// ----------------------------------------------------
advancedCertificationsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = createCertificationSchema.parse(req.body);

    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);

    if (body.partnerId) {
      const partner = await prisma.partner.findUnique({ where: { id: body.partnerId } });
      if (!partner) throw new NotFoundError("Subcontratista", body.partnerId);
    }

    // Regla de Negocio: Autonumeración inteligente
    const nextNumero = await getNextCertificationNumber(body.projectId, body.partnerId);
    const fecha = body.fecha ? new Date(body.fecha) : new Date();

    const created = await prisma.$transaction(async (tx) => {
      // 1. Crear encabezado de Certificación en estado MEDICION_BORRADOR
      const cert = await tx.certification.create({
        data: {
          projectId: body.projectId,
          partnerId: body.partnerId || null,
          numero: nextNumero,
          fecha,
          estado: CertificationStatus.MEDICION_BORRADOR,
          montoTotal: 0,
          notes: body.notes || null,
        },
      });

      let certTotal = 0;

      // 2. Procesar cada rubro e insertar items, cómputos auxiliares y fotos
      for (const itemInput of body.items) {
        const budgetItem = await tx.budgetItem.findUnique({ where: { id: itemInput.budgetItemId } });
        if (!budgetItem) throw new NotFoundError("Rubro presupuestario", itemInput.budgetItemId);

        const unitPrice = itemInput.precioUnitario !== undefined && itemInput.precioUnitario >= 0
          ? Number(itemInput.precioUnitario)
          : Number(budgetItem.unitPrice || 0);

        // Si tiene cómputos auxiliares, la cantidad presente es la suma exacta de sus subtotales
        let presentQty = Number(itemInput.cantidadPresente || 0);
        const auxCalcs = itemInput.auxiliaryCalculations || [];

        if (auxCalcs.length > 0) {
          presentQty = auxCalcs.reduce((sum, ac) => {
            const l = Number(ac.largo || 0);
            const a = Number(ac.ancho || 0);
            const h = Number(ac.alto || 0);
            const f = Number(ac.factor_repeticion || 1);
            const sub = l * a * h * f;
            return sum + sub;
          }, 0);
        }

        const prevQty = Number(itemInput.cantidadAnterior || 0);
        const accumQty = prevQty + presentQty;
        const itemMonto = Math.round(presentQty * unitPrice);
        certTotal += itemMonto;

        const createdItem = await tx.certificationItem.create({
          data: {
            certificationId: cert.id,
            budgetItemId: itemInput.budgetItemId,
            cantidadAnterior: prevQty,
            cantidadPresente: presentQty,
            cantidadAcumulada: accumQty,
            precioUnitario: unitPrice,
            montoTotal: itemMonto,
          },
        });

        // Insertar cómputos auxiliares tipo "Google Sheets"
        if (auxCalcs.length > 0) {
          for (const ac of auxCalcs) {
            const l = Number(ac.largo || 0);
            const a = Number(ac.ancho || 0);
            const h = Number(ac.alto || 0);
            const f = Number(ac.factor_repeticion || 1);
            const sub = ac.subtotal !== undefined ? Number(ac.subtotal) : l * a * h * f;

            await tx.auxiliaryCalculation.create({
              data: {
                certificationItemId: createdItem.id,
                descripcion: ac.descripcion,
                largo: l,
                ancho: a,
                alto: h,
                factor_repeticion: f,
                subtotal: sub,
              },
            });
          }
        }

        // Insertar fotos de evidencia
        if (itemInput.photos && itemInput.photos.length > 0) {
          for (const photo of itemInput.photos) {
            await tx.itemPhoto.create({
              data: {
                certificationItemId: createdItem.id,
                url: photo.url,
                comentario: photo.comentario || null,
                fechaCaptura: photo.fechaCaptura ? new Date(photo.fechaCaptura) : new Date(),
              },
            });
          }
        }
      }

      // Actualizar monto total en la cabecera
      const updatedCert = await tx.certification.update({
        where: { id: cert.id },
        data: { montoTotal: certTotal },
        include: certificationInclude,
      });

      return updatedCert;
    });

    ok(res, created, 201);
  })
);

// ----------------------------------------------------
// PUT /api/certifications/:id (Actualizar Borrador de Medición)
// ----------------------------------------------------
advancedCertificationsRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundError("Certificación", id);

    if (cert.estado !== CertificationStatus.MEDICION_BORRADOR) {
      throw new DomainError(
        "MEASUREMENT_LOCKED",
        "La medición ya ha sido cerrada o aprobada y no puede ser modificada.",
        400
      );
    }

    const body = createCertificationSchema.partial().parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      if (body.items && body.items.length > 0) {
        // Eliminar items previos y volver a crearlos
        await tx.certificationItem.deleteMany({ where: { certificationId: id } });

        let certTotal = 0;
        for (const itemInput of body.items) {
          const budgetItem = await tx.budgetItem.findUnique({ where: { id: itemInput.budgetItemId } });
          if (!budgetItem) throw new NotFoundError("Rubro presupuestario", itemInput.budgetItemId);

          const unitPrice = itemInput.precioUnitario !== undefined
            ? Number(itemInput.precioUnitario)
            : Number(budgetItem.unitPrice || 0);

          let presentQty = Number(itemInput.cantidadPresente || 0);
          const auxCalcs = itemInput.auxiliaryCalculations || [];
          if (auxCalcs.length > 0) {
            presentQty = auxCalcs.reduce((sum, ac) => {
              const l = Number(ac.largo || 0);
              const a = Number(ac.ancho || 0);
              const h = Number(ac.alto || 0);
              const f = Number(ac.factor_repeticion || 1);
              return sum + l * a * h * f;
            }, 0);
          }

          const prevQty = Number(itemInput.cantidadAnterior || 0);
          const accumQty = prevQty + presentQty;
          const itemMonto = Math.round(presentQty * unitPrice);
          certTotal += itemMonto;

          const createdItem = await tx.certificationItem.create({
            data: {
              certificationId: id,
              budgetItemId: itemInput.budgetItemId,
              cantidadAnterior: prevQty,
              cantidadPresente: presentQty,
              cantidadAcumulada: accumQty,
              precioUnitario: unitPrice,
              montoTotal: itemMonto,
            },
          });

          for (const ac of auxCalcs) {
            const l = Number(ac.largo || 0);
            const a = Number(ac.ancho || 0);
            const h = Number(ac.alto || 0);
            const f = Number(ac.factor_repeticion || 1);
            await tx.auxiliaryCalculation.create({
              data: {
                certificationItemId: createdItem.id,
                descripcion: ac.descripcion,
                largo: l,
                ancho: a,
                alto: h,
                factor_repeticion: f,
                subtotal: l * a * h * f,
              },
            });
          }

          if (itemInput.photos) {
            for (const photo of itemInput.photos) {
              await tx.itemPhoto.create({
                data: {
                  certificationItemId: createdItem.id,
                  url: photo.url,
                  comentario: photo.comentario || null,
                  fechaCaptura: photo.fechaCaptura ? new Date(photo.fechaCaptura) : new Date(),
                },
              });
            }
          }
        }

        await tx.certification.update({
          where: { id },
          data: {
            montoTotal: certTotal,
            notes: body.notes !== undefined ? body.notes : cert.notes,
          },
        });
      }

      return tx.certification.findUnique({
        where: { id },
        include: certificationInclude,
      });
    });

    ok(res, updated);
  })
);

// ----------------------------------------------------
// POST /api/certifications/:id/close-measurement
// Cierra la medición, bloquea edición física y genera CERTIFICADO_BORRADOR
// ----------------------------------------------------
advancedCertificationsRouter.post(
  "/:id/close-measurement",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            auxiliaryCalculations: true,
          },
        },
      },
    });

    if (!existing) throw new NotFoundError("Certificación", id);

    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError("ALREADY_APPROVED", "La certificación ya se encuentra aprobada.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      let grandTotal = 0;

      // Recalcular con precisión estricta todos los montos de cada rubro
      for (const item of existing.items) {
        let presentQty = Number(item.cantidadPresente || 0);

        if (item.auxiliaryCalculations && item.auxiliaryCalculations.length > 0) {
          presentQty = item.auxiliaryCalculations.reduce((sum, ac) => {
            const sub = Number(ac.largo) * Number(ac.ancho) * Number(ac.alto) * Number(ac.factor_repeticion);
            return sum + sub;
          }, 0);
        }

        const prevQty = Number(item.cantidadAnterior || 0);
        const accumQty = prevQty + presentQty;
        const unitPrice = Number(item.precioUnitario || 0);
        const itemMonto = Math.round(presentQty * unitPrice);
        grandTotal += itemMonto;

        await tx.certificationItem.update({
          where: { id: item.id },
          data: {
            cantidadPresente: presentQty,
            cantidadAcumulada: accumQty,
            montoTotal: itemMonto,
          },
        });
      }

      const cert = await tx.certification.update({
        where: { id },
        data: {
          estado: CertificationStatus.CERTIFICADO_BORRADOR,
          montoTotal: grandTotal,
        },
        include: certificationInclude,
      });

      return cert;
    });

    ok(res, updated);
  })
);

// ----------------------------------------------------
// POST /api/certifications/:id/approve
// Aprueba el Certificado y ejecuta la Integración Contable Automática (Facturación Three-Way Match)
// ----------------------------------------------------
advancedCertificationsRouter.post(
  "/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: {
        project: true,
        partner: true,
        items: {
          include: {
            budgetItem: true,
          },
        },
        invoices: true,
      },
    });

    if (!cert) throw new NotFoundError("Certificación", id);

    if (cert.estado === CertificationStatus.APROBADO && cert.invoices.length > 0) {
      ok(res, {
        certification: cert,
        invoice: cert.invoices[0],
        message: "El certificado ya se encontraba aprobado y facturado.",
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Transicionar estado a APROBADO
      const approvedCert = await tx.certification.update({
        where: { id },
        data: { estado: CertificationStatus.APROBADO },
        include: certificationInclude,
      });

      // 2. Impactar avance físico y financiero en los rubros presupuestarios
      for (const item of cert.items) {
        if (item.budgetItemId) {
          await tx.budgetItem.update({
            where: { id: item.budgetItemId },
            data: {
              executedQuantity: { increment: Number(item.cantidadPresente || 0) },
              executedAmount: { increment: Number(item.montoTotal || 0) },
            },
          });
        }
      }

      // Recalcular métricas consolidadas de la obra
      await recalculateProjectFinancials(tx, cert.projectId);

      // 3. INTEGRACIÓN CONTABLE (Generación Automática de Factura Fiscal)
      const certTotal = Number(cert.montoTotal || 0);
      const isSubcontractor = Boolean(cert.partnerId);
      const invoiceType = isSubcontractor ? "RECIBIDA" : "EMITIDA";

      // Parámetros fiscales paraguayos (DNIT)
      const now = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // 30 días de crédito estándar

      const legalInvoiceNumber = isSubcontractor
        ? `001-002-${String(cert.numero).padStart(7, "0")}`
        : `001-001-${String(cert.numero).padStart(7, "0")}`;

      const timbrado = isSubcontractor ? "15894320" : "16240980";
      const iva10 = Math.round(certTotal / 11);
      const subtotalNeto = certTotal - iva10;

      const concepto = isSubcontractor
        ? `Certificado N° ${cert.numero} de Subcontratista ${cert.partner?.name || ""} en Obra ${cert.project.name}`
        : `Certificado N° ${cert.numero} de Avance de Obra al Cliente ${cert.project.clientName || cert.project.name}`;

      const matchNotes = isSubcontractor
        ? `Integración Tripartita Aprobada (Three-Way Match 100%): Medición de campo cerrada N° ${cert.numero} con cómputos auxiliares validados y certificación fiscalizada sin objeción.`
        : `Certificación de Obra al Cliente N° ${cert.numero} aprobada por Fiscalización. Cuenta por Cobrar generada automáticamente.`;

      // Crear o vincular Factura
      let invoice = cert.invoices.length > 0 ? cert.invoices[0] : null;

      if (!invoice) {
        invoice = await tx.invoice.create({
          data: {
            projectId: cert.projectId,
            partnerId: cert.partnerId || null,
            certificationId: cert.id,
            numeroFactura: legalInvoiceNumber,
            timbrado,
            tipo: invoiceType,
            estado: "APROBADA",
            fechaEmision: now,
            fechaVencimiento: dueDate,
            condicionVenta: "CREDITO",
            concepto,
            subtotal: subtotalNeto,
            montoExento: 0,
            montoIva5: 0,
            montoIva10: iva10,
            total: certTotal,
            threeWayMatchPassed: true,
            matchNotes,
            remisionNumber: `REM-CERT-${cert.numero}`,
            remisionDate: now,
          },
        });

        // Insertar items de la factura correspondiente a los rubros certificados
        for (const item of cert.items) {
          const itemMonto = Number(item.montoTotal || 0);
          const itemIva10 = Math.round(itemMonto / 11);
          const itemSubtotal = itemMonto - itemIva10;

          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              description: `${item.budgetItem.code} - ${item.budgetItem.name} (Cant: ${Number(item.cantidadPresente).toLocaleString("es-PY")} ${item.budgetItem.unit || "un"})`,
              quantity: Number(item.cantidadPresente || 1),
              unitPrice: Number(item.precioUnitario || 0),
              vatType: "IVA10",
              montoExento: 0,
              montoIva5: 0,
              montoIva10: itemIva10,
              subtotal: itemSubtotal,
            },
          });
        }
      }

      return {
        certification: approvedCert,
        invoice,
      };
    });

    ok(res, result, 201);
  })
);

// ----------------------------------------------------
// DELETE /api/certifications/:id
// ----------------------------------------------------
advancedCertificationsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({
      where: { id },
      include: { items: true, invoices: true },
    });

    if (!existing) throw new NotFoundError("Certificación", id);

    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError(
        "CANNOT_DELETE_APPROVED",
        "No se puede eliminar una certificación aprobada con factura contable vinculada.",
        400
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.certification.delete({ where: { id } });
    });

    ok(res, { deleted: true, id });
  })
);
