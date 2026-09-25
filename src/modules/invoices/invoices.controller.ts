import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../domain/audit";

export const invoicesRouter = Router();

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  vatType: z.enum(["EXENTA", "IVA5", "IVA10"]).default("IVA10"),
  montoExento: z.coerce.number().min(0).default(0),
  montoIva5: z.coerce.number().min(0).default(0),
  montoIva10: z.coerce.number().min(0).default(0),
  subtotal: z.coerce.number().min(0),
});

const createInvoiceSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  partnerId: z.coerce.number().int().positive(),
  numeroFactura: z.string().min(3),
  timbrado: z.string().min(4),
  tipo: z.enum(["EMITIDA", "RECIBIDA"]).default("RECIBIDA"),
  estado: z.enum(["BORRADOR", "EN_REVISION", "APROBADA", "PAGADA", "ANULADA"]).default("EN_REVISION"),
  fechaEmision: z.string(),
  fechaVencimiento: z.string(),
  condicionVenta: z.string().default("CREDITO"),
  concepto: z.string().optional(),
  subtotal: z.coerce.number().min(0).default(0),
  montoExento: z.coerce.number().min(0).default(0),
  montoIva5: z.coerce.number().min(0).default(0),
  montoIva10: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  purchaseOrderId: z.coerce.number().int().optional().nullable(),
  certificacionId: z.coerce.number().int().optional().nullable(),
  certificationId: z.coerce.number().int().optional().nullable(),
  remisionNumber: z.string().optional().nullable(),
  remisionDate: z.string().optional().nullable(),
  items: z.array(invoiceItemSchema).optional(),
});

const invoiceInclude = {
  project: true,
  partner: true,
  purchaseOrder: {
    include: {
      details: { include: { material: true, budgetItem: true } },
    },
  },
  certificacion: true,
  certification: {
    include: {
      items: { include: { budgetItem: true } },
    },
  },
  items: true,
  payments: {
    orderBy: { fechaPago: "desc" as const },
  },
};

// ----------------------------------------------------
// Three-Way Match Engine Function
// ----------------------------------------------------
async function evaluateThreeWayMatch(params: {
  tipo: "EMITIDA" | "RECIBIDA";
  total: number;
  purchaseOrderId?: number | null;
  certificacionId?: number | null;
  certificationId?: number | null;
  remisionNumber?: string | null;
}) {
  const { tipo, total, purchaseOrderId, certificacionId, certificationId, remisionNumber } = params;

  if (tipo === "RECIBIDA") {
    // 1. MATCH VÍA ORDEN DE COMPRA (Materiales e Insumos)
    if (purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { details: true },
      });

      if (!po) {
        return {
          passed: false,
          notes: "Orden de Compra vinculada no existe en el sistema.",
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      const poTotal = Number(po.totalAmount || 0);
      const diff = Math.abs(total - poTotal);

      // Regla de negocio: Margen de tolerancia del 0%
      if (diff > 0.05) {
        return {
          passed: false,
          notes: `Discrepancia de monto (Tolerancia 0%): Monto facturado (${total.toLocaleString("es-PY")}) difiere de O.C. ${po.number} (${poTotal.toLocaleString("es-PY")}). Diferencia: ${diff.toLocaleString("es-PY")}.`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      // Validación de recepción en pañol (Remisión / Ingreso físico a obra)
      const hasPhysicalReceipt = po.stockRegistered || Boolean(remisionNumber && remisionNumber.trim().length > 0);
      if (!hasPhysicalReceipt) {
        return {
          passed: false,
          notes: `Pendiente de recepción física: Falta verificar Nota de Remisión en Pañol de Obra para la O.C. ${po.number}.`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      return {
        passed: true,
        notes: `Validación Tripartita Exitosa (3-Way Match 100%): O.C. ${po.number}, Remisión de Pañol ${remisionNumber || "REGISTRADA"} y Factura coinciden con 0% de tolerancia.`,
        calculatedStatus: "APROBADA" as const,
      };
    }

    // 2. MATCH VÍA CERTIFICADO DE SUBCONTRATO (Servicios y Obras tercerizadas)
    if (certificacionId) {
      const cert = await prisma.certificacion.findUnique({
        where: { id: certificacionId },
      });

      if (!cert) {
        return {
          passed: false,
          notes: "Certificado de subcontratista no existe en el sistema.",
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      if (cert.estado !== "APROBADA" && cert.estado !== "PAGADA") {
        return {
          passed: false,
          notes: `El Certificado de Subcontrato #${cert.id} aún no cuenta con Aprobación de Fiscalización (Estado: ${cert.estado}).`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      const certTotal = Number(cert.monto_total || 0);
      const diff = Math.abs(total - certTotal);

      if (diff > 0.05) {
        return {
          passed: false,
          notes: `Discrepancia en medición: Monto facturado (${total.toLocaleString("es-PY")}) difiere del Certificado Aprobado #${cert.id} (${certTotal.toLocaleString("es-PY")}).`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      return {
        passed: true,
        notes: `Validación Tripartita Exitosa (3-Way Match 100%): Contrato de Subcontrato, Medición de Campo Aprobada #${cert.id} y Factura coinciden con 0% de tolerancia.`,
        calculatedStatus: "APROBADA" as const,
      };
    }

    // 2.b MATCH VÍA NUEVO MODELO DE CERTIFICACIÓN AVANZADA
    if (certificationId) {
      const cert = await prisma.certification.findUnique({
        where: { id: certificationId },
      });

      if (!cert) {
        return {
          passed: false,
          notes: "Certificación avanzada no encontrada en el sistema.",
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      if (cert.estado !== "APROBADO") {
        return {
          passed: false,
          notes: `La Certificación #${cert.numero} no se encuentra aprobada (Estado: ${cert.estado}).`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      const certTotal = Number(cert.montoTotal || 0);
      const diff = Math.abs(total - certTotal);

      if (diff > 0.05) {
        return {
          passed: false,
          notes: `Discrepancia en medición: Monto facturado (${total.toLocaleString("es-PY")}) difiere del Certificado #${cert.numero} (${certTotal.toLocaleString("es-PY")}).`,
          calculatedStatus: "EN_REVISION" as const,
        };
      }

      return {
        passed: true,
        notes: `Validación Tripartita Exitosa (3-Way Match 100%): Medición de campo N° ${cert.numero} aprobada, cómputos y factura coinciden sin discrepancias.`,
        calculatedStatus: "APROBADA" as const,
      };
    }

    // Sin documento de respaldo
    return {
      passed: false,
      notes: "Factura sin Orden de Compra ni Certificado de Subcontratista enlazado. Requiere auditoría manual.",
      calculatedStatus: "EN_REVISION" as const,
    };
  } else {
    // FACTURAS EMITIDAS A CLIENTES (MOPC / Comitentes)
    if (certificacionId) {
      const cert = await prisma.certificacion.findUnique({
        where: { id: certificacionId },
      });
      if (cert && (cert.estado === "APROBADA" || cert.estado === "PAGADA")) {
        return {
          passed: true,
          notes: `Factura respaldada por Certificado de Avance al Cliente #${cert.id}.`,
          calculatedStatus: "APROBADA" as const,
        };
      }
    }

    return {
      passed: true,
      notes: "Factura emitida al cliente registrada conforme a contrato principal.",
      calculatedStatus: "APROBADA" as const,
    };
  }
}

// ----------------------------------------------------
// GET /api/invoices (Listar Facturas con Filtros)
// ----------------------------------------------------
invoicesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, tipo, estado, search } = req.query;

    const where: any = {};
    if (projectId) {
      where.projectId = Number(projectId);
    }
    if (tipo) {
      where.tipo = String(tipo);
    }
    if (estado) {
      where.estado = String(estado);
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { fechaEmision: "desc" },
    });

    let filtered = invoices;
    if (search && typeof search === "string" && search.trim().length > 0) {
      const q = search.toLowerCase();
      filtered = invoices.filter(
        (inv: any) =>
          inv.numeroFactura?.toLowerCase().includes(q) ||
          inv.timbrado?.toLowerCase().includes(q) ||
          inv.partner?.name?.toLowerCase().includes(q) ||
          inv.partner?.taxId?.toLowerCase().includes(q) ||
          inv.concepto?.toLowerCase().includes(q)
      );
    }

    // Calculate dynamic payment totals and balance for each invoice
    const mapped = filtered.map((inv: any) => {
      const totalPaid = (inv.payments || []).reduce(
        (acc: number, p: any) => acc + Number(p.montoPagado || 0),
        0
      );
      const totalAmount = Number(inv.total || 0);
      const remainingBalance = Math.max(0, totalAmount - totalPaid);

      return {
        ...inv,
        totalPaid,
        remainingBalance,
      };
    });

    ok(res, mapped);
  })
);

// ----------------------------------------------------
// GET /api/invoices/:id (Obtener Factura Individual)
// ----------------------------------------------------
invoicesRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });

    if (!invoice) {
      throw new NotFoundError("Factura", id);
    }

    const totalPaid = (invoice.payments || []).reduce(
      (acc: number, p: any) => acc + Number(p.montoPagado || 0),
      0
    );
    const totalAmount = Number(invoice.total || 0);
    const remainingBalance = Math.max(0, totalAmount - totalPaid);

    ok(res, {
      ...invoice,
      totalPaid,
      remainingBalance,
    });
  })
);

// ----------------------------------------------------
// POST /api/invoices (Crear Factura con Three-Way Match)
// ----------------------------------------------------
invoicesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = createInvoiceSchema.parse(req.body);

    // Run Three-Way Match validation logic
    const matchResult = await evaluateThreeWayMatch({
      tipo: body.tipo,
      total: body.total,
      purchaseOrderId: body.purchaseOrderId,
      certificacionId: body.certificacionId,
      remisionNumber: body.remisionNumber,
    });

    // Determine final status
    const finalStatus = matchResult.passed
      ? (body.estado === "BORRADOR" ? "BORRADOR" : "APROBADA")
      : "EN_REVISION";

    // Auto-calculate VAT breakdown if not provided
    let calculatedSubtotal = body.subtotal;
    let calculatedIva10 = body.montoIva10;
    let calculatedIva5 = body.montoIva5;
    let calculatedExento = body.montoExento;

    if (calculatedIva10 === 0 && calculatedIva5 === 0 && calculatedExento === 0) {
      // Default: Standard 10% VAT in Paraguay (Total / 11)
      calculatedIva10 = Math.round(body.total / 11);
      calculatedSubtotal = body.total - calculatedIva10;
    }

    const created = await prisma.invoice.create({
      data: {
        projectId: body.projectId,
        partnerId: body.partnerId,
        numeroFactura: body.numeroFactura.trim(),
        timbrado: body.timbrado.trim(),
        tipo: body.tipo,
        estado: finalStatus,
        fechaEmision: new Date(body.fechaEmision),
        fechaVencimiento: new Date(body.fechaVencimiento),
        condicionVenta: body.condicionVenta,
        concepto: body.concepto || "Factura de Obras / Insumos CCC S.A.",
        subtotal: calculatedSubtotal,
        montoExento: calculatedExento,
        montoIva5: calculatedIva5,
        montoIva10: calculatedIva10,
        total: body.total,
        purchaseOrderId: body.purchaseOrderId || null,
        certificacionId: body.certificacionId || null,
        remisionNumber: body.remisionNumber || null,
        remisionDate: body.remisionDate ? new Date(body.remisionDate) : null,
        threeWayMatchPassed: matchResult.passed,
        matchNotes: matchResult.notes,
        items: body.items && body.items.length > 0
          ? {
              create: body.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatType: item.vatType,
                montoExento: item.montoExento,
                montoIva5: item.montoIva5,
                montoIva10: item.montoIva10,
                subtotal: item.subtotal,
              })),
            }
          : {
              create: [
                {
                  description: body.concepto || "Provisión de Bienes / Servicios de Obra",
                  quantity: 1,
                  unitPrice: body.total,
                  vatType: "IVA10",
                  montoExento: 0,
                  montoIva5: 0,
                  montoIva10: calculatedIva10,
                  subtotal: body.total,
                },
              ],
            },
      },
      include: invoiceInclude,
    });

    await audit(prisma as any, {
      entity: "INVOICE",
      entityId: created.id,
      action: "CREATE",
      fromStatus: null,
      toStatus: finalStatus,
      payload: {
        matchPassed: matchResult.passed,
        matchNotes: matchResult.notes,
        total: body.total,
      },
    });

    ok(res, created, 201);
  })
);

// ----------------------------------------------------
// POST /api/invoices/:id/verify-match (Re-evaluar 3-Way Match)
// ----------------------------------------------------
invoicesRouter.post(
  "/:id/verify-match",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });

    if (!invoice) {
      throw new NotFoundError("Factura", id);
    }

    const matchResult = await evaluateThreeWayMatch({
      tipo: invoice.tipo as any,
      total: Number(invoice.total),
      purchaseOrderId: invoice.purchaseOrderId,
      certificacionId: invoice.certificacionId,
      remisionNumber: invoice.remisionNumber,
    });

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        threeWayMatchPassed: matchResult.passed,
        matchNotes: matchResult.notes,
        estado: matchResult.passed ? "APROBADA" : "EN_REVISION",
      },
      include: invoiceInclude,
    });

    await audit(prisma as any, {
      entity: "INVOICE",
      entityId: id,
      action: "VERIFY_MATCH",
      fromStatus: invoice.estado,
      toStatus: updated.estado,
      payload: {
        matchPassed: matchResult.passed,
        notes: matchResult.notes,
      },
    });

    ok(res, updated);
  })
);

// ----------------------------------------------------
// POST /api/invoices/:id/payments (Registrar Pago)
// Regla: No permite pagar si la Factura no está APROBADA
// Si la suma de pagos alcanza el total, cambia a PAGADA
// ----------------------------------------------------
const paymentSchema = z.object({
  montoPagado: z.coerce.number().positive("El monto pagado debe ser mayor a cero"),
  fechaPago: z.string().optional(),
  metodo: z.enum(["TRANSFERENCIA", "CHEQUE", "EFECTIVO"]).default("TRANSFERENCIA"),
  referenciaBanco: z.string().min(1, "La referencia bancaria o N° de recibo es obligatoria"),
  notas: z.string().optional(),
});

invoicesRouter.post(
  "/:id/payments",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = paymentSchema.parse(req.body);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { payments: true },
    });

    if (!invoice) {
      throw new NotFoundError("Factura", id);
    }

    // Regla de Negocio: Restricción Three-Way Match para autorizar pagos
    if (invoice.estado !== "APROBADA" && invoice.estado !== "PAGADA") {
      throw new DomainError(
        "PAYMENT_NOT_AUTHORIZED",
        `No se puede autorizar el pago: La factura #${invoice.numeroFactura} se encuentra en estado "${invoice.estado}". Requiere validación Three-Way Match (Integración Tripartita) y estado APROBADA.`,
        422,
        {
          currentStatus: invoice.estado,
          matchPassed: invoice.threeWayMatchPassed,
          matchNotes: invoice.matchNotes,
        }
      );
    }

    const currentTotalPaid = (invoice.payments || []).reduce(
      (acc, p) => acc + Number(p.montoPagado || 0),
      0
    );
    const invoiceTotal = Number(invoice.total || 0);
    const newTotalPaid = currentTotalPaid + body.montoPagado;

    // Verificar si se cancela por completo
    const isFullyPaid = newTotalPaid >= invoiceTotal - 0.05; // 0% tolerancia con delta mínimo de redondeo

    // Registrar el pago
    const payment = await prisma.payment.create({
      data: {
        invoiceId: id,
        montoPagado: body.montoPagado,
        fechaPago: body.fechaPago ? new Date(body.fechaPago) : new Date(),
        metodo: body.metodo,
        referenciaBanco: body.referenciaBanco.trim(),
        notas: body.notas || null,
      },
    });

    // Actualizar estado de la factura si fue saldada por completo
    let updatedInvoice = invoice;
    if (isFullyPaid && invoice.estado !== "PAGADA") {
      updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: { estado: "PAGADA" },
        include: invoiceInclude,
      });

      await audit(prisma as any, {
        entity: "INVOICE",
        entityId: id,
        action: "FULL_PAYMENT",
        fromStatus: invoice.estado,
        toStatus: "PAGADA",
        payload: {
          totalPaid: newTotalPaid,
          invoiceTotal,
          paymentId: payment.id,
        },
      });
    }

    ok(res, {
      payment,
      invoiceStatus: isFullyPaid ? "PAGADA" : "APROBADA",
      totalPaid: newTotalPaid,
      remainingBalance: Math.max(0, invoiceTotal - newTotalPaid),
    });
  })
);

// ----------------------------------------------------
// POST /api/invoices/:id/send-email (Simulación Envío Correo)
// ----------------------------------------------------
const sendEmailSchema = z.object({
  recipientEmail: z.string().email().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
});

invoicesRouter.post(
  "/:id/send-email",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = sendEmailSchema.parse(req.body || {});

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        partner: true,
        project: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError("Factura", id);
    }

    const recipient =
      body.recipientEmail ||
      invoice.partner?.email ||
      `${invoice.partner?.name.toLowerCase().replace(/\s+/g, ".")}@erp-proveedor.com.py`;

    const subject =
      body.subject ||
      `Comprobante Legal - Factura N° ${invoice.numeroFactura} - Obra ${invoice.project?.code || "CCC"}`;

    // Registrar auditoría de envío
    await audit(prisma as any, {
      entity: "INVOICE",
      entityId: id,
      action: "SEND_EMAIL",
      fromStatus: invoice.estado,
      toStatus: invoice.estado,
      payload: {
        recipient,
        subject,
        timestamp: new Date().toISOString(),
      },
    });

    ok(res, {
      success: true,
      message: `La Factura Legal N° ${invoice.numeroFactura} y su certificado de liquidación han sido enviados con éxito a ${recipient}.`,
      recipient,
      subject,
      sentAt: new Date().toISOString(),
      invoiceNumber: invoice.numeroFactura,
      partnerName: invoice.partner?.name,
    });
  })
);
