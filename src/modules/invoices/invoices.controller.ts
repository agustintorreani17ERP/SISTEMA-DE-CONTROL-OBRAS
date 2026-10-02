import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../domain/audit";
import { postCost } from "../../domain/budget";
import { resolveExpenseLine } from "../../domain/imputation";
import { fechaContable } from "../../domain/progress";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { recordStockMovement } from "../../domain/stock";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";
import { toDecimal } from "../../lib/money";
import { evaluateMatch, type MatchResult } from "../../domain/threeWayMatch";

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
  items: {
    include: {
      insumo: { select: { id: true, code: true, description: true, unit: true, tipo: true } },
      budgetItem: { select: { id: true, code: true, name: true } },
    },
  },
  payments: {
    orderBy: { fechaPago: "desc" as const },
  },
};

// ----------------------------------------------------
// Control de aprobación (ex "Three-Way Match"): wrapper delgado que carga los documentos
// relacionados y delega la decisión a la función pura `evaluateMatch` (src/domain/threeWayMatch.ts).
// Documentado en el plan: estado + threeWayMatchPassed se escriben siempre juntos vía applyMatchResult.
// ----------------------------------------------------
async function evaluateThreeWayMatch(params: {
  tipo: "EMITIDA" | "RECIBIDA";
  total: number;
  purchaseOrderId?: number | null;
  certificacionId?: number | null;
  certificationId?: number | null;
  remisionNumber?: string | null;
}): Promise<MatchResult> {
  const { tipo, total, purchaseOrderId, certificacionId, certificationId, remisionNumber } = params;

  let purchaseOrder: { number: string; totalAmount: number; stockRegistered: boolean } | null = null;
  if (purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!po) return { kind: "ORDEN_COMPRA", passed: false, notes: "Orden de Compra vinculada no existe en el sistema." };
    purchaseOrder = { number: po.number, totalAmount: Number(po.totalAmount || 0), stockRegistered: po.stockRegistered };
  }

  let certificado: { ref: string; estado: string; estadosAprobados: string[]; monto: number } | null = null;
  if (!purchaseOrder && certificacionId) {
    const cert = await prisma.certificacion.findUnique({ where: { id: certificacionId } });
    if (!cert) return { kind: "CERTIFICADO", passed: false, notes: "Certificado de subcontratista no existe en el sistema." };
    certificado = { ref: `#${cert.id}`, estado: cert.estado, estadosAprobados: ["APROBADA", "PAGADA"], monto: Number(cert.monto_total || 0) };
  } else if (!purchaseOrder && certificationId) {
    const cert = await prisma.certification.findUnique({ where: { id: certificationId } });
    if (!cert) return { kind: "CERTIFICADO", passed: false, notes: "Certificación avanzada no encontrada en el sistema." };
    certificado = { ref: `N° ${cert.numero}`, estado: cert.estado, estadosAprobados: ["APROBADO"], monto: Number(cert.montoTotal || 0) };
  }

  return evaluateMatch({ tipo, total, purchaseOrder, certificado, remisionNumber });
}

/** Escribe estado + threeWayMatchPassed + matchNotes juntos, siempre a partir del mismo MatchResult. */
function matchResultToInvoiceData(matchResult: MatchResult) {
  return {
    estado: matchResult.passed ? ("APROBADA" as const) : ("EN_REVISION" as const),
    threeWayMatchPassed: matchResult.passed,
    matchNotes: matchResult.notes,
  };
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
    const matchData = matchResultToInvoiceData(matchResult);
    const finalStatus = matchResult.passed && body.estado === "BORRADOR" ? "BORRADOR" : matchData.estado;

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
        threeWayMatchPassed: matchData.threeWayMatchPassed,
        matchNotes: matchData.matchNotes,
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
        matchKind: matchResult.kind,
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
      data: matchResultToInvoiceData(matchResult),
      include: invoiceInclude,
    });

    await audit(prisma as any, {
      entity: "INVOICE",
      entityId: id,
      action: "VERIFY_MATCH",
      fromStatus: invoice.estado,
      toStatus: updated.estado,
      payload: {
        matchKind: matchResult.kind,
        matchPassed: matchResult.passed,
        notes: matchResult.notes,
      },
    });

    ok(res, updated);
  })
);

// ----------------------------------------------------
// POST /api/invoices/:id/imputar — factura recibida sin OC ni certificado
// Cada renglón lleva insumo (e ítem si es DIRECTO); entra al libro mayor sin IVA con la fecha
// de la factura (o el primer día abierto si su período ya cerró). COMÚN entra al stock.
// ----------------------------------------------------
const INVOICE_SOURCE = "Invoice";
const VAT_RATE: Record<string, number> = { IVA10: 0.1, IVA5: 0.05, EXENTA: 0 };

const imputarSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.coerce.number().int().positive(),
        insumoId: z.coerce.number().int().positive(),
        budgetItemId: z.coerce.number().int().positive().nullish(),
      })
    )
    .min(1),
});

invoicesRouter.post(
  "/:id/imputar",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = imputarSchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
        if (!inv) throw new NotFoundError("Factura", id);
        if (inv.tipo !== "RECIBIDA") throw new DomainError("NOT_RECEIVED", "Solo se imputan facturas recibidas", 422);
        if (inv.purchaseOrderId || inv.certificationId || inv.certificacionId) {
          throw new DomainError("HAS_SOURCE_DOC", "La factura tiene OC o certificado: su costo entra por ese documento", 422);
        }
        if (inv.estado === "ANULADA") throw new DomainError("INVOICE_VOID", "La factura está anulada", 409);
        if (await tx.budgetMovement.count({ where: { sourceType: INVOICE_SOURCE, sourceId: id } })) {
          throw new DomainError("ALREADY_IMPUTED", "La factura ya está imputada", 409);
        }
        const porId = new Map(body.items.map((i) => [i.id, i]));
        const faltan = inv.items.filter((i) => !porId.has(i.id));
        if (faltan.length) throw new DomainError("LINES_MISSING", `Imputá todos los renglones (faltan ${faltan.length})`, 422);

        const fc = await fechaContable(tx, inv.projectId, inv.fechaEmision);
        const avisos: string[] = [];
        if (fc.desplazada) avisos.push(`La factura es de un período cerrado: su costo entra el ${fc.fecha.toISOString().slice(0, 10).split("-").reverse().join("/")}`);
        const debeAsiento: { monto: ReturnType<typeof toDecimal>; budgetItemId: number }[] = [];
        for (const line of inv.items) {
          const sel = porId.get(line.id)!;
          const insumo = await tx.material.findUnique({ where: { id: sel.insumoId } });
          if (!insumo) throw new NotFoundError("Insumo", sel.insumoId);
          const { itemId, ledgerItemId } = await resolveExpenseLine(tx, inv.projectId, insumo, sel.budgetItemId);
          const bruto = Number(line.quantity) * Number(line.unitPrice);
          const sinIva = Math.round(bruto / (1 + (VAT_RATE[line.vatType] ?? 0.1)));
          await tx.invoiceItem.update({ where: { id: line.id }, data: { insumoId: insumo.id, budgetItemId: itemId } });
          await postCost(tx, {
            projectId: inv.projectId,
            budgetItemId: ledgerItemId,
            insumoId: insumo.id,
            amount: sinIva,
            quantity: line.quantity,
            source: "INVOICE",
            sourceType: INVOICE_SOURCE,
            sourceId: inv.id,
            sourceNumber: inv.numeroFactura,
            note: line.description,
            fecha: fc.fecha,
          });
          debeAsiento.push({ monto: toDecimal(sinIva), budgetItemId: ledgerItemId });
          if (insumo.tipo === "COMUN") {
            await recordStockMovement(tx, {
              projectId: inv.projectId,
              materialId: insumo.id,
              kind: "RECEIPT",
              quantity: line.quantity,
              fecha: fc.fecha,
              sourceType: INVOICE_SOURCE,
              sourceId: inv.id,
              unitCost: Number(line.quantity) ? sinIva / Number(line.quantity) : 0,
              note: `Factura ${inv.numeroFactura}`,
            });
          }
        }
        const totalAsiento = debeAsiento.reduce((acc, l) => acc.plus(l.monto), toDecimal(0));
        if (totalAsiento.gt(0)) {
          await postAsientoDesdeRegla(tx, {
            evento: EVENTO.FACTURA_RECIBIDA,
            projectId: inv.projectId,
            concepto: `Factura ${inv.numeroFactura}`,
            sourceType: INVOICE_SOURCE,
            sourceId: inv.id,
            fecha: fc.fecha,
            debe: debeAsiento,
            haber: [{ monto: totalAsiento, partnerId: inv.partnerId }],
          });
        }
        // Imputar por renglón ES la aprobación manual de una factura sin OC ni certificado: debe
        // dejar threeWayMatchPassed sincronizado con estado, igual que cualquier otro camino de
        // aprobación (ver evaluateMatch/matchResultToInvoiceData en threeWayMatch.ts).
        const next = await tx.invoice.update({
          where: { id },
          data: {
            estado: inv.estado === "PAGADA" ? "PAGADA" : "APROBADA",
            threeWayMatchPassed: true,
            matchNotes: "Aprobada manualmente por imputación de renglones (sin OC ni certificado).",
          },
          include: invoiceInclude,
        });
        await recalculateProjectFinancials(tx, inv.projectId);
        await audit(tx, { entity: "INVOICE", entityId: id, action: "IMPUTE", fromStatus: inv.estado, toStatus: next.estado, payload: { lineas: inv.items.length } });
        return { invoice: next, avisos };
      },
      { timeout: 60_000 }
    );
    ok(res, result);
  })
);

// ----------------------------------------------------
// POST /api/invoices/:id/payments (Registrar Pago)
// Regla: No permite pagar si la Factura no está APROBADA
// Si la suma de pagos alcanza el total, cambia a PAGADA
// ----------------------------------------------------
const paymentSchema = z.object({
  cuentaFinancieraId: z.coerce.number().int().positive({ message: "Elegí la cuenta financiera del pago" }),
  montoPagado: z.coerce.number().positive("El monto pagado debe ser mayor a cero"),
  fechaPago: z.string().optional(),
  metodo: z.enum(["TRANSFERENCIA", "CHEQUE", "EFECTIVO"]).default("TRANSFERENCIA"),
  referenciaBanco: z.string().min(1, "La referencia bancaria o N° de recibo es obligatoria"),
  notas: z.string().optional(),
  chequeNumero: z.string().trim().optional(),
  chequeFechaPago: z.string().optional(),
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

    const cuenta = await prisma.cuentaFinanciera.findUnique({ where: { id: body.cuentaFinancieraId } });
    if (!cuenta) throw new NotFoundError("Cuenta financiera", body.cuentaFinancieraId);
    if (cuenta.projectId !== invoice.projectId) {
      throw new DomainError("ACCOUNT_PROJECT_MISMATCH", "La cuenta financiera no pertenece a la obra de la factura", 422);
    }
    if (body.metodo === "CHEQUE" && (!body.chequeNumero || !body.chequeFechaPago)) {
      throw new DomainError("CHEQUE_DATA_REQUIRED", "Indicá el N° de cheque y su fecha de pago diferida", 422);
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

    // Registrar el pago y su asiento (debita Proveedores, acredita Bancos)
    const payment = await prisma.$transaction(async (tx) => {
      const fechaPago = body.fechaPago ? new Date(body.fechaPago) : new Date();
      const created = await tx.payment.create({
        data: {
          invoiceId: id,
          cuentaFinancieraId: cuenta.id,
          montoPagado: body.montoPagado,
          fechaPago,
          metodo: body.metodo,
          referenciaBanco: body.referenciaBanco.trim(),
          notas: body.notas || null,
        },
      });

      // El cheque diferido no mueve el saldo hasta acreditarse; los demás métodos mueven la
      // cuenta ya (egreso si pagamos una factura recibida, ingreso si cobramos una emitida).
      if (body.metodo === "CHEQUE") {
        await tx.cheque.create({
          data: {
            cuentaFinancieraId: cuenta.id,
            tipo: invoice.tipo === "RECIBIDA" ? "EMITIDO" : "RECIBIDO",
            numero: body.chequeNumero!.trim(),
            monto: body.montoPagado,
            fechaEmision: fechaPago,
            fechaPago: new Date(body.chequeFechaPago!),
            partnerId: invoice.partnerId,
            paymentId: created.id,
            notas: `Pago factura ${invoice.numeroFactura}`,
          },
        });
      } else {
        await tx.movimientoCuentaFinanciera.create({
          data: {
            cuentaFinancieraId: cuenta.id,
            fecha: fechaPago,
            tipo: invoice.tipo === "RECIBIDA" ? "EGRESO" : "INGRESO",
            monto: body.montoPagado,
            concepto: `Pago factura ${invoice.numeroFactura} — ${created.referenciaBanco}`,
            confirmado: true,
            sourceType: "Payment",
            sourceId: created.id,
          },
        });
      }

      await postAsientoDesdeRegla(tx, {
        evento: EVENTO.PAGO_FACTURA,
        projectId: invoice.projectId,
        concepto: `Pago factura ${invoice.numeroFactura} — ${created.referenciaBanco}`,
        sourceType: "Payment",
        sourceId: created.id,
        fecha: created.fechaPago,
        debe: [{ monto: created.montoPagado, partnerId: invoice.partnerId }],
        haber: [{ monto: created.montoPagado }],
      });
      return created;
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
