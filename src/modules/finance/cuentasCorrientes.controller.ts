import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber, toDecimal } from "../../lib/money";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";
import { agruparPorBucketAntiguedad, saldoPendiente } from "../../domain/ingresosEgresosMath";
import { crearAnticipo } from "../../domain/fondos";
import { usuarioDe } from "../../http/usuario";

/**
 * Cuentas corrientes de la obra: facturas a cobrar/pagar con saldo y antigüedad, pagos (parciales
 * o en lote contra varias facturas), anticipos y retenciones/fondo de reparo como saldos
 * pendientes por tercero, y el estado de cuenta consolidado de un tercero.
 */
export const cuentasCorrientesRouter = Router();

// ----------------------------------------------------
// GET /api/cuentas-corrientes/facturas — saldo + antigüedad (A cobrar / A pagar)
// ----------------------------------------------------
cuentasCorrientesRouter.get(
  "/facturas",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    }
    const tipo = req.query.tipo === "EMITIDA" ? "EMITIDA" : "RECIBIDA";
    const incluirSaldadas = req.query.all === "1";

    const invoices = await prisma.invoice.findMany({
      where: { projectId, tipo, estado: { not: "ANULADA" } },
      include: { partner: { select: { id: true, name: true, taxId: true } }, payments: true },
      orderBy: { fechaVencimiento: "asc" },
    });

    const hoy = new Date();
    const buckets: Record<string, number> = { A_VENCER: 0, "0-30": 0, "31-60": 0, "61-90": 0, "+90": 0 };
    let totalSaldo = 0;

    const data = invoices
      .map((inv) => {
        const totalPagado = inv.payments.reduce((acc, p) => acc + moneyNumber(p.montoPagado), 0);
        const total = moneyNumber(inv.total);
        const retenido = moneyNumber(inv.montoRetenido);
        const saldo = saldoPendiente({ total, montoRetenido: retenido, totalPagado });
        const { bucket, diasVencido } = agruparPorBucketAntiguedad(inv.fechaVencimiento, hoy);
        return {
          id: inv.id,
          numeroFactura: inv.numeroFactura,
          tipo: inv.tipo,
          estado: inv.estado,
          partner: inv.partner,
          fechaEmision: inv.fechaEmision,
          fechaVencimiento: inv.fechaVencimiento,
          total,
          montoRetenido: retenido,
          totalPagado,
          saldo,
          bucket,
          diasVencido,
        };
      })
      .filter((row) => incluirSaldadas || row.saldo > 0.5);

    for (const row of data) {
      buckets[row.bucket] = (buckets[row.bucket] ?? 0) + row.saldo;
      totalSaldo += row.saldo;
    }

    ok(res, { facturas: data, buckets, totalSaldo });
  })
);

// ----------------------------------------------------
// POST /api/cuentas-corrientes/pagos-multiples — un pago que cancela/abona varias facturas
// ----------------------------------------------------
const pagoMultipleSchema = z.object({
  cuentaFinancieraId: z.coerce.number().int().positive(),
  fecha: z.string().optional(),
  metodo: z.enum(["TRANSFERENCIA", "CHEQUE", "EFECTIVO"]).default("TRANSFERENCIA"),
  referenciaBanco: z.string().min(1, "La referencia bancaria o N° de recibo es obligatoria"),
  notas: z.string().optional(),
  aplicaciones: z
    .array(z.object({ invoiceId: z.coerce.number().int().positive(), monto: z.coerce.number().positive() }))
    .min(2, "Un pago múltiple debe aplicarse a dos o más facturas"),
});

cuentasCorrientesRouter.post(
  "/pagos-multiples",
  asyncHandler(async (req, res) => {
    const body = pagoMultipleSchema.parse(req.body);
    const fecha = body.fecha ? new Date(body.fecha) : new Date();
    const grupoPagoId = randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      const cuenta = await tx.cuentaFinanciera.findUnique({ where: { id: body.cuentaFinancieraId } });
      if (!cuenta) throw new NotFoundError("Cuenta financiera", body.cuentaFinancieraId);

      const pagos = [];
      for (const ap of body.aplicaciones) {
        const invoice = await tx.invoice.findUnique({ where: { id: ap.invoiceId }, include: { payments: true } });
        if (!invoice) throw new NotFoundError("Factura", ap.invoiceId);
        if (invoice.projectId !== cuenta.projectId) {
          throw new DomainError("ACCOUNT_PROJECT_MISMATCH", `La cuenta financiera no pertenece a la obra de la factura ${invoice.numeroFactura}`, 422);
        }
        if (invoice.estado !== "APROBADA" && invoice.estado !== "PAGADA") {
          throw new DomainError("PAYMENT_NOT_AUTHORIZED", `La factura ${invoice.numeroFactura} no está APROBADA`, 422);
        }
        const totalPagado = invoice.payments.reduce((acc, p) => acc + moneyNumber(p.montoPagado), 0);
        const saldo = moneyNumber(invoice.total) - moneyNumber(invoice.montoRetenido) - totalPagado;
        if (ap.monto > saldo + 0.5) {
          throw new DomainError("OVERPAYMENT", `El monto supera el saldo de la factura ${invoice.numeroFactura} (saldo ${saldo})`, 422);
        }

        const created = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            cuentaFinancieraId: cuenta.id,
            montoPagado: ap.monto,
            fechaPago: fecha,
            metodo: body.metodo,
            referenciaBanco: body.referenciaBanco.trim(),
            notas: body.notas || null,
            grupoPagoId,
          },
        });

        if (body.metodo !== "CHEQUE") {
          await tx.movimientoCuentaFinanciera.create({
            data: {
              cuentaFinancieraId: cuenta.id,
              fecha,
              tipo: invoice.tipo === "RECIBIDA" ? "EGRESO" : "INGRESO",
              monto: ap.monto,
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
          fecha,
          debe: [{ monto: ap.monto, partnerId: invoice.partnerId }],
          haber: [{ monto: ap.monto }],
        });

        const newTotalPagado = totalPagado + ap.monto;
        const facturaSaldada = newTotalPagado >= moneyNumber(invoice.total) - moneyNumber(invoice.montoRetenido) - 0.5;
        if (facturaSaldada && invoice.estado !== "PAGADA") {
          await tx.invoice.update({ where: { id: invoice.id }, data: { estado: "PAGADA" } });
        }

        pagos.push({ ...created, montoPagado: moneyNumber(created.montoPagado), invoiceNumero: invoice.numeroFactura });
      }
      return pagos;
    });

    ok(res, { grupoPagoId, pagos: result }, 201);
  })
);

// ----------------------------------------------------
// Anticipos
// ----------------------------------------------------
cuentasCorrientesRouter.get(
  "/anticipos",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
    const anticipos = await prisma.anticipo.findMany({
      where: { projectId, ...(partnerId ? { partnerId } : {}) },
      include: { partner: { select: { id: true, name: true } } },
      orderBy: { fecha: "desc" },
    });
    ok(
      res,
      anticipos.map((a) => ({
        ...a,
        monto: moneyNumber(a.monto),
        saldoAplicado: moneyNumber(a.saldoAplicado),
        saldoPendiente: moneyNumber(a.monto) - moneyNumber(a.saldoAplicado),
      }))
    );
  })
);

const anticipoSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  partnerId: z.coerce.number().int().positive().nullish(),
  tipo: z.enum(["OTORGADO", "RECIBIDO"]),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date(),
  concepto: z.string().trim().optional(),
});

cuentasCorrientesRouter.post(
  "/anticipos",
  asyncHandler(async (req, res) => {
    const body = anticipoSchema.parse(req.body);
    // El OTORGADO genera su solicitud de fondos en la misma transacción.
    const { anticipo: created } = await prisma.$transaction((tx) => crearAnticipo(tx, body, usuarioDe(req)));
    ok(res, { ...created, monto: moneyNumber(created.monto), saldoAplicado: 0, saldoPendiente: moneyNumber(created.monto) }, 201);
  })
);

const aplicarAnticipoSchema = z.object({
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date().optional(),
  sourceType: z.string().min(1),
  sourceId: z.coerce.number().int().positive(),
});

cuentasCorrientesRouter.post(
  "/anticipos/:id/aplicar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = aplicarAnticipoSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const anticipo = await tx.anticipo.findUnique({ where: { id } });
      if (!anticipo) throw new NotFoundError("Anticipo", id);
      if (anticipo.anuladoAt) throw new DomainError("ANTICIPO_ANULADO", "El anticipo está anulado", 409);
      const saldoPendiente = moneyNumber(anticipo.monto) - moneyNumber(anticipo.saldoAplicado);
      if (body.monto > saldoPendiente + 0.5) {
        throw new DomainError("OVERAPPLY", `El monto supera el saldo pendiente del anticipo (${saldoPendiente})`, 422);
      }
      await tx.aplicacionAnticipo.create({
        data: { anticipoId: id, monto: body.monto, fecha: body.fecha ?? new Date(), sourceType: body.sourceType, sourceId: body.sourceId },
      });
      const nuevoAplicado = toDecimal(anticipo.saldoAplicado).plus(body.monto);
      const nuevoSaldo = toDecimal(anticipo.monto).minus(nuevoAplicado);
      const estado = nuevoSaldo.lte(0.5) ? "LIBERADO" : "PARCIAL";
      const updated = await tx.anticipo.update({ where: { id }, data: { saldoAplicado: nuevoAplicado, estado } });
      return { ...updated, monto: moneyNumber(updated.monto), saldoAplicado: moneyNumber(updated.saldoAplicado), saldoPendiente: moneyNumber(nuevoSaldo) };
    });
    ok(res, result);
  })
);

// ----------------------------------------------------
// Retenciones / fondo de reparo
// ----------------------------------------------------
cuentasCorrientesRouter.get(
  "/retenciones",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
    const retenciones = await prisma.retencionFondo.findMany({
      where: { projectId, ...(partnerId ? { partnerId } : {}) },
      include: { partner: { select: { id: true, name: true } } },
      orderBy: { fecha: "desc" },
    });
    ok(
      res,
      retenciones.map((r) => ({
        ...r,
        monto: moneyNumber(r.monto),
        saldoLiberado: moneyNumber(r.saldoLiberado),
        saldoPendiente: moneyNumber(r.monto) - moneyNumber(r.saldoLiberado),
      }))
    );
  })
);

const liberarRetencionSchema = z.object({
  monto: z.coerce.number().positive(),
});

cuentasCorrientesRouter.post(
  "/retenciones/:id/liberar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = liberarRetencionSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const retencion = await tx.retencionFondo.findUnique({ where: { id } });
      if (!retencion) throw new NotFoundError("Retención", id);
      const saldoPendiente = moneyNumber(retencion.monto) - moneyNumber(retencion.saldoLiberado);
      if (body.monto > saldoPendiente + 0.5) {
        throw new DomainError("OVERRELEASE", `El monto supera el saldo pendiente de la retención (${saldoPendiente})`, 422);
      }
      const nuevoLiberado = toDecimal(retencion.saldoLiberado).plus(body.monto);
      const nuevoSaldo = toDecimal(retencion.monto).minus(nuevoLiberado);
      const estado = nuevoSaldo.lte(0.5) ? "LIBERADO" : "PARCIAL";
      const updated = await tx.retencionFondo.update({ where: { id }, data: { saldoLiberado: nuevoLiberado, estado } });
      return { ...updated, monto: moneyNumber(updated.monto), saldoLiberado: moneyNumber(updated.saldoLiberado), saldoPendiente: moneyNumber(nuevoSaldo) };
    });
    ok(res, result);
  })
);

// ----------------------------------------------------
// Config de porcentajes (fondo de reparo / retención de garantía / anticipo)
// ----------------------------------------------------
cuentasCorrientesRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const config = await prisma.configRetencionesAnticipos.upsert({
      where: { projectId },
      update: {},
      create: { projectId },
    });
    ok(res, {
      ...config,
      pctFondoReparo: moneyNumber(config.pctFondoReparo),
      pctRetencionGarantia: moneyNumber(config.pctRetencionGarantia),
      pctAnticipo: moneyNumber(config.pctAnticipo),
    });
  })
);

const configSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  pctFondoReparo: z.coerce.number().min(0).max(100).optional(),
  pctRetencionGarantia: z.coerce.number().min(0).max(100).optional(),
  pctAnticipo: z.coerce.number().min(0).max(100).optional(),
});

cuentasCorrientesRouter.put(
  "/config",
  asyncHandler(async (req, res) => {
    const body = configSchema.parse(req.body);
    const { projectId, ...data } = body;
    const config = await prisma.configRetencionesAnticipos.upsert({
      where: { projectId },
      update: data,
      create: { projectId, ...data },
    });
    ok(res, {
      ...config,
      pctFondoReparo: moneyNumber(config.pctFondoReparo),
      pctRetencionGarantia: moneyNumber(config.pctRetencionGarantia),
      pctAnticipo: moneyNumber(config.pctAnticipo),
    });
  })
);

// ----------------------------------------------------
// Estado de cuenta por tercero
// ----------------------------------------------------
cuentasCorrientesRouter.get(
  "/estado-cuenta",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = req.query.partnerId ? Number(req.query.partnerId) : null;

    const [facturas, anticipos, retenciones] = await Promise.all([
      prisma.invoice.findMany({
        where: { projectId, partnerId, estado: { not: "ANULADA" } },
        include: { payments: true },
        orderBy: { fechaEmision: "desc" },
      }),
      prisma.anticipo.findMany({ where: { projectId, partnerId }, orderBy: { fecha: "desc" } }),
      prisma.retencionFondo.findMany({ where: { projectId, partnerId }, orderBy: { fecha: "desc" } }),
    ]);

    const hoy = new Date();
    const facturasConSaldo = facturas.map((inv) => {
      const totalPagado = inv.payments.reduce((acc, p) => acc + moneyNumber(p.montoPagado), 0);
      const total = moneyNumber(inv.total);
      const retenido = moneyNumber(inv.montoRetenido);
      const saldo = saldoPendiente({ total, montoRetenido: retenido, totalPagado });
      return {
        id: inv.id,
        numeroFactura: inv.numeroFactura,
        tipo: inv.tipo,
        estado: inv.estado,
        fechaEmision: inv.fechaEmision,
        fechaVencimiento: inv.fechaVencimiento,
        total,
        montoRetenido: retenido,
        totalPagado,
        saldo,
        ...(saldo > 0.5 ? agruparPorBucketAntiguedad(inv.fechaVencimiento, hoy) : { bucket: null, diasVencido: 0 }),
      };
    });

    const anticiposConSaldo = anticipos.map((a) => ({
      ...a,
      monto: moneyNumber(a.monto),
      saldoAplicado: moneyNumber(a.saldoAplicado),
      saldoPendiente: moneyNumber(a.monto) - moneyNumber(a.saldoAplicado),
    }));
    const retencionesConSaldo = retenciones.map((r) => ({
      ...r,
      monto: moneyNumber(r.monto),
      saldoLiberado: moneyNumber(r.saldoLiberado),
      saldoPendiente: moneyNumber(r.monto) - moneyNumber(r.saldoLiberado),
    }));

    const saldoFacturasPendientes = facturasConSaldo.reduce((acc, f) => acc + f.saldo, 0);
    const saldoAnticiposPendientes = anticiposConSaldo.reduce((acc, a) => acc + a.saldoPendiente, 0);
    const saldoRetencionesPendientes = retencionesConSaldo.reduce((acc, r) => acc + r.saldoPendiente, 0);

    ok(res, {
      facturas: facturasConSaldo,
      anticipos: anticiposConSaldo,
      retenciones: retencionesConSaldo,
      totales: { saldoFacturasPendientes, saldoAnticiposPendientes, saldoRetencionesPendientes },
    });
  })
);
