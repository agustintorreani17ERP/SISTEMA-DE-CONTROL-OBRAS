import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { esIngreso } from "../../domain/ingresosEgresosMath";

/**
 * Libros contables de la obra (o de todas): ingresos y egresos (devengado/percibido), diario,
 * mayor por cuenta e IVA compras/ventas. Todo filtrable por obra y por rango Desde/Hasta.
 */
export const librosRouter = Router();

const rangoSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

function fechaWhere(desde?: Date, hasta?: Date) {
  if (!desde && !hasta) return undefined;
  const w: any = {};
  if (desde) w.gte = desde;
  if (hasta) w.lte = hasta;
  return w;
}

// ----------------------------------------------------
// GET /api/libros/ingresos-egresos — devengado (facturas) o percibido/pagado (pagos)
// ----------------------------------------------------
librosRouter.get(
  "/ingresos-egresos",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const vista = req.query.vista === "PERCIBIDO" ? "PERCIBIDO" : "DEVENGADO";

    if (vista === "DEVENGADO") {
      const invoices = await prisma.invoice.findMany({
        where: {
          ...(projectId ? { projectId } : {}),
          estado: { not: "ANULADA" },
          fechaEmision: fechaWhere(desde, hasta),
        },
        include: { partner: { select: { name: true } }, project: { select: { code: true, name: true } } },
        orderBy: { fechaEmision: "asc" },
      });
      const ingresos = invoices
        .filter((i) => esIngreso(i.tipo))
        .map((i) => ({
          fecha: i.fechaEmision,
          obra: i.project.code,
          comprobante: i.numeroFactura,
          tercero: i.partner?.name ?? "Comitente",
          concepto: i.concepto ?? "Factura al cliente",
          monto: moneyNumber(i.total),
        }));
      const egresos = invoices
        .filter((i) => !esIngreso(i.tipo))
        .map((i) => ({
          fecha: i.fechaEmision,
          obra: i.project.code,
          comprobante: i.numeroFactura,
          tercero: i.partner?.name ?? "Proveedor",
          concepto: i.concepto ?? "Factura recibida",
          monto: moneyNumber(i.total),
        }));
      const totalIngresos = ingresos.reduce((a, r) => a + r.monto, 0);
      const totalEgresos = egresos.reduce((a, r) => a + r.monto, 0);
      return ok(res, { vista, ingresos, egresos, totalIngresos, totalEgresos, saldo: totalIngresos - totalEgresos });
    }

    const payments = await prisma.payment.findMany({
      where: {
        fechaPago: fechaWhere(desde, hasta),
        ...(projectId ? { invoice: { projectId } } : {}),
      },
      include: {
        invoice: { include: { partner: { select: { name: true } }, project: { select: { code: true } } } },
        cuentaFinanciera: { select: { nombre: true } },
      },
      orderBy: { fechaPago: "asc" },
    });
    const ingresos = payments
      .filter((p) => esIngreso(p.invoice.tipo))
      .map((p) => ({
        fecha: p.fechaPago,
        obra: p.invoice.project.code,
        comprobante: `${p.invoice.numeroFactura} · ${p.referenciaBanco}`,
        tercero: p.invoice.partner?.name ?? "Comitente",
        concepto: `Cobro factura ${p.invoice.numeroFactura} — ${p.cuentaFinanciera.nombre}`,
        monto: moneyNumber(p.montoPagado),
      }));
    const egresos = payments
      .filter((p) => !esIngreso(p.invoice.tipo))
      .map((p) => ({
        fecha: p.fechaPago,
        obra: p.invoice.project.code,
        comprobante: `${p.invoice.numeroFactura} · ${p.referenciaBanco}`,
        tercero: p.invoice.partner?.name ?? "Proveedor",
        concepto: `Pago factura ${p.invoice.numeroFactura} — ${p.cuentaFinanciera.nombre}`,
        monto: moneyNumber(p.montoPagado),
      }));
    const totalIngresos = ingresos.reduce((a, r) => a + r.monto, 0);
    const totalEgresos = egresos.reduce((a, r) => a + r.monto, 0);
    ok(res, { vista, ingresos, egresos, totalIngresos, totalEgresos, saldo: totalIngresos - totalEgresos });
  })
);

// ----------------------------------------------------
// GET /api/libros/diario — asientos con sus líneas
// ----------------------------------------------------
librosRouter.get(
  "/diario",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const asientos = await prisma.asiento.findMany({
      where: { ...(projectId ? { projectId } : {}), fecha: fechaWhere(desde, hasta) },
      include: {
        project: { select: { code: true } },
        lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } }, orderBy: { id: "asc" } },
      },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
    });
    const data = asientos.map((a) => ({
      id: a.id,
      fecha: a.fecha,
      obra: a.project.code,
      concepto: a.concepto,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      anulado: a.anulaDeId !== null,
      lineas: a.lineas.map((l) => ({
        cuentaCodigo: l.cuenta.codigo,
        cuentaNombre: l.cuenta.nombre,
        debe: moneyNumber(l.debe),
        haber: moneyNumber(l.haber),
      })),
    }));
    const totalDebe = data.reduce((acc, a) => acc + a.lineas.reduce((s, l) => s + l.debe, 0), 0);
    const totalHaber = data.reduce((acc, a) => acc + a.lineas.reduce((s, l) => s + l.haber, 0), 0);
    ok(res, { asientos: data, totalDebe, totalHaber });
  })
);

// ----------------------------------------------------
// GET /api/libros/mayor — resumen por cuenta, o detalle con saldo corrido si se pasa cuentaId
// ----------------------------------------------------
librosRouter.get(
  "/mayor",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const cuentaId = req.query.cuentaId ? Number(req.query.cuentaId) : undefined;

    if (!cuentaId) {
      const lineas = await prisma.lineaAsiento.findMany({
        where: { ...(projectId ? { projectId } : {}), asiento: { fecha: fechaWhere(desde, hasta) } },
        include: { cuenta: { select: { id: true, codigo: true, nombre: true } } },
      });
      const porCuenta = new Map<number, { cuenta: { id: number; codigo: string; nombre: string }; debe: number; haber: number }>();
      for (const l of lineas) {
        const acc = porCuenta.get(l.cuentaId) ?? { cuenta: l.cuenta, debe: 0, haber: 0 };
        acc.debe += moneyNumber(l.debe);
        acc.haber += moneyNumber(l.haber);
        porCuenta.set(l.cuentaId, acc);
      }
      const cuentas = Array.from(porCuenta.values())
        .map((c) => ({ ...c, saldo: c.debe - c.haber }))
        .sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo));
      ok(res, { cuentas });
      return;
    }

    const cuenta = await prisma.cuentaContable.findUnique({ where: { id: cuentaId }, select: { id: true, codigo: true, nombre: true } });
    if (!cuenta) throw new DomainError("NOT_FOUND", "Cuenta contable no encontrada", 404);

    const anteriores = desde
      ? await prisma.lineaAsiento.aggregate({
          where: { cuentaId, ...(projectId ? { projectId } : {}), asiento: { fecha: { lt: desde } } },
          _sum: { debe: true, haber: true },
        })
      : null;
    const saldoInicial = anteriores ? moneyNumber(anteriores._sum.debe) - moneyNumber(anteriores._sum.haber) : 0;

    const lineas = await prisma.lineaAsiento.findMany({
      where: { cuentaId, ...(projectId ? { projectId } : {}), asiento: { fecha: fechaWhere(desde, hasta) } },
      include: { asiento: { select: { fecha: true, concepto: true, sourceType: true, sourceId: true } } },
      orderBy: [{ asiento: { fecha: "asc" } }, { id: "asc" }],
    });

    let acumulado = saldoInicial;
    const detalle = lineas.map((l) => {
      const debe = moneyNumber(l.debe);
      const haber = moneyNumber(l.haber);
      acumulado += debe - haber;
      return { fecha: l.asiento.fecha, concepto: l.asiento.concepto, sourceType: l.asiento.sourceType, sourceId: l.asiento.sourceId, debe, haber, saldo: acumulado };
    });

    ok(res, { cuenta, saldoInicial, movimientos: detalle, saldoFinal: acumulado });
  })
);

// ----------------------------------------------------
// GET /api/libros/iva — libro IVA compras (RECIBIDA) o ventas (EMITIDA)
// ----------------------------------------------------
librosRouter.get(
  "/iva",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const tipo = req.query.tipo === "VENTAS" ? "EMITIDA" : "RECIBIDA";

    const invoices = await prisma.invoice.findMany({
      where: {
        tipo,
        estado: { not: "ANULADA" },
        ...(projectId ? { projectId } : {}),
        fechaEmision: fechaWhere(desde, hasta),
      },
      include: { partner: { select: { name: true, taxId: true } } },
      orderBy: { fechaEmision: "asc" },
    });

    const filas = invoices.map((inv) => {
      const iva10 = moneyNumber(inv.montoIva10);
      const iva5 = moneyNumber(inv.montoIva5);
      const exento = moneyNumber(inv.montoExento);
      return {
        fecha: inv.fechaEmision,
        ruc: inv.partner?.taxId ?? "—",
        razonSocial: inv.partner?.name ?? "Comitente",
        timbrado: inv.timbrado,
        numero: inv.numeroFactura,
        gravado10: iva10 > 0 ? iva10 / 0.1 : 0,
        iva10,
        gravado5: iva5 > 0 ? iva5 / 0.05 : 0,
        iva5,
        exento,
        ivaTotal: iva10 + iva5,
        total: moneyNumber(inv.total),
      };
    });

    const totales = filas.reduce(
      (acc, f) => ({
        gravado10: acc.gravado10 + f.gravado10,
        iva10: acc.iva10 + f.iva10,
        gravado5: acc.gravado5 + f.gravado5,
        iva5: acc.iva5 + f.iva5,
        exento: acc.exento + f.exento,
        ivaTotal: acc.ivaTotal + f.ivaTotal,
        total: acc.total + f.total,
      }),
      { gravado10: 0, iva10: 0, gravado5: 0, iva5: 0, exento: 0, ivaTotal: 0, total: 0 }
    );

    ok(res, { tipo, filas, totales });
  })
);
