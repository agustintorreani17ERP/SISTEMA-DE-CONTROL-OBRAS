import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { moneyNumber } from "../../lib/money";
import { costEngine } from "../../domain/costEngine";
import { esIngreso, saldoPendiente } from "../../domain/ingresosEgresosMath";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Reportes gerenciales: estado de resultados, balance a una fecha, flujo de caja (real y
 * proyectado), posición de IVA mensual y resumen por obra. Todo filtrable por obra (vacío =
 * consolidado) y por rango Desde/Hasta.
 */
export const reportesRouter = Router();

const rangoSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
});

async function proyectosDe(projectId?: number) {
  return prisma.project.findMany({ where: projectId ? { id: projectId } : undefined, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

// ----------------------------------------------------
// GET /api/reportes/estado-resultados — por obra y consolidado
// ----------------------------------------------------
reportesRouter.get(
  "/estado-resultados",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const hastaDate = hasta || todayIso();
    const desdeDate = desde || "2000-01-01";
    const proyectos = await proyectosDe(projectId);

    const porObra = await Promise.all(
      proyectos.map(async (p) => {
        const [ingresosAgg, engine] = await Promise.all([
          prisma.invoice.aggregate({
            where: { projectId: p.id, tipo: "EMITIDA", estado: { not: "ANULADA" }, fechaEmision: { gte: new Date(desdeDate), lte: new Date(hastaDate) } },
            _sum: { subtotal: true },
          }),
          costEngine(prisma, p.id, desdeDate, hastaDate).catch(() => null),
        ]);
        const ingresos = moneyNumber(ingresosAgg._sum.subtotal);
        const costos = engine?.totales.costoReal ?? 0;
        return { obra: p, ingresos, costos, resultado: ingresos - costos };
      })
    );

    const consolidado = porObra.reduce(
      (acc, r) => ({ ingresos: acc.ingresos + r.ingresos, costos: acc.costos + r.costos, resultado: acc.resultado + r.resultado }),
      { ingresos: 0, costos: 0, resultado: 0 }
    );

    ok(res, { desde: desdeDate, hasta: hastaDate, porObra, consolidado });
  })
);

// ----------------------------------------------------
// GET /api/reportes/balance — balance general a una fecha
// ----------------------------------------------------
reportesRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    const { projectId, hasta } = rangoSchema.parse(req.query);
    const hastaDate = hasta || todayIso();

    const lineas = await prisma.lineaAsiento.findMany({
      where: { ...(projectId ? { projectId } : {}), asiento: { fecha: { lte: new Date(hastaDate) } } },
      include: { cuenta: { select: { id: true, codigo: true, nombre: true, tipo: true } } },
    });

    const porCuenta = new Map<number, { cuenta: { id: number; codigo: string; nombre: string; tipo: string }; saldo: number }>();
    for (const l of lineas) {
      const acc = porCuenta.get(l.cuentaId) ?? { cuenta: l.cuenta, saldo: 0 };
      acc.saldo += moneyNumber(l.debe) - moneyNumber(l.haber);
      porCuenta.set(l.cuentaId, acc);
    }

    const cuentas = Array.from(porCuenta.values()).sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo));
    const activo = cuentas.filter((c) => c.cuenta.tipo === "ACTIVO");
    const pasivo = cuentas.filter((c) => c.cuenta.tipo === "PASIVO").map((c) => ({ ...c, saldo: -c.saldo }));
    const patrimonio = cuentas.filter((c) => c.cuenta.tipo === "PATRIMONIO").map((c) => ({ ...c, saldo: -c.saldo }));
    const resultadoDelEjercicio =
      cuentas.filter((c) => c.cuenta.tipo === "INGRESO").reduce((a, c) => a - c.saldo, 0) -
      cuentas.filter((c) => c.cuenta.tipo === "EGRESO").reduce((a, c) => a + c.saldo, 0);

    const totalActivo = activo.reduce((a, c) => a + c.saldo, 0);
    const totalPasivo = pasivo.reduce((a, c) => a + c.saldo, 0);
    const totalPatrimonio = patrimonio.reduce((a, c) => a + c.saldo, 0) + resultadoDelEjercicio;

    ok(res, { hasta: hastaDate, activo, pasivo, patrimonio, resultadoDelEjercicio, totalActivo, totalPasivo, totalPatrimonio, cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) < 1 });
  })
);

// ----------------------------------------------------
// GET /api/reportes/flujo-caja — real (movimientos confirmados) y proyectado 30/60/90
// ----------------------------------------------------
reportesRouter.get(
  "/flujo-caja",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const hoy = todayIso();
    const hastaDate = hasta || hoy;
    const desdeDate = desde || "2000-01-01";

    const movimientos = await prisma.movimientoCuentaFinanciera.findMany({
      where: {
        confirmado: true,
        fecha: { gte: new Date(desdeDate), lte: new Date(hastaDate) },
        ...(projectId ? { cuenta: { projectId } } : {}),
      },
      orderBy: { fecha: "asc" },
    });

    const porDia = new Map<string, { ingresos: number; egresos: number }>();
    for (const m of movimientos) {
      const key = m.fecha.toISOString().slice(0, 10);
      const acc = porDia.get(key) ?? { ingresos: 0, egresos: 0 };
      if (m.tipo === "INGRESO") acc.ingresos += moneyNumber(m.monto);
      else acc.egresos += moneyNumber(m.monto);
      porDia.set(key, acc);
    }
    let acumulado = 0;
    const real = Array.from(porDia.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, v]) => {
        acumulado += v.ingresos - v.egresos;
        return { fecha, ingresos: v.ingresos, egresos: v.egresos, neto: v.ingresos - v.egresos, saldoAcumulado: acumulado };
      });

    // Proyectado: saldo de facturas pendientes por su fecha de vencimiento, en ventanas 30/60/90.
    const addDays = (n: number) => new Date(Date.now() + n * 86_400_000);
    const pendientes = await prisma.invoice.findMany({
      where: { estado: { not: "ANULADA" }, ...(projectId ? { projectId } : {}) },
      include: { payments: true },
    });
    const ventanas = [30, 60, 90];
    const proyectado = ventanas.map((dias) => {
      const limite = addDays(dias);
      let ingresosEsperados = 0;
      let egresosEsperados = 0;
      for (const inv of pendientes) {
        if (inv.fechaVencimiento > limite) continue;
        const pagado = inv.payments.reduce((a, p) => a + moneyNumber(p.montoPagado), 0);
        const saldo = saldoPendiente({ total: moneyNumber(inv.total), montoRetenido: moneyNumber(inv.montoRetenido), totalPagado: pagado });
        if (saldo <= 0) continue;
        if (esIngreso(inv.tipo)) ingresosEsperados += saldo;
        else egresosEsperados += saldo;
      }
      return { dias, ingresosEsperados, egresosEsperados, neto: ingresosEsperados - egresosEsperados };
    });

    ok(res, { real, proyectado, hoy });
  })
);

// ----------------------------------------------------
// GET /api/reportes/iva-posicion — débito fiscal (ventas) vs crédito fiscal (compras) por mes
// ----------------------------------------------------
reportesRouter.get(
  "/iva-posicion",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const hastaDate = hasta || todayIso();
    const desdeDate = desde || "2000-01-01";

    const invoices = await prisma.invoice.findMany({
      where: {
        estado: { not: "ANULADA" },
        ...(projectId ? { projectId } : {}),
        fechaEmision: { gte: new Date(desdeDate), lte: new Date(hastaDate) },
      },
      select: { tipo: true, fechaEmision: true, montoIva5: true, montoIva10: true },
      orderBy: { fechaEmision: "asc" },
    });

    const porMes = new Map<string, { debitoFiscal: number; creditoFiscal: number }>();
    for (const inv of invoices) {
      const mes = inv.fechaEmision.toISOString().slice(0, 7);
      const acc = porMes.get(mes) ?? { debitoFiscal: 0, creditoFiscal: 0 };
      const iva = moneyNumber(inv.montoIva5) + moneyNumber(inv.montoIva10);
      if (esIngreso(inv.tipo)) acc.debitoFiscal += iva;
      else acc.creditoFiscal += iva;
      porMes.set(mes, acc);
    }

    const meses = Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ mes, debitoFiscal: v.debitoFiscal, creditoFiscal: v.creditoFiscal, posicion: v.debitoFiscal - v.creditoFiscal }));

    ok(res, { meses });
  })
);

// ----------------------------------------------------
// GET /api/reportes/resumen-obras — facturado/cobrado/pagado del rango + saldos a la fecha
// ----------------------------------------------------
reportesRouter.get(
  "/resumen-obras",
  asyncHandler(async (req, res) => {
    const { projectId, desde, hasta } = rangoSchema.parse(req.query);
    const hastaDate = hasta || todayIso();
    const desdeDate = desde || "2000-01-01";
    const proyectos = await proyectosDe(projectId);

    const filas = await Promise.all(
      proyectos.map(async (p) => {
        const [facturadoAgg, cobradoAgg, pagadoAgg, invoices, anticipos, retenciones] = await Promise.all([
          prisma.invoice.aggregate({
            where: { projectId: p.id, tipo: "EMITIDA", estado: { not: "ANULADA" }, fechaEmision: { gte: new Date(desdeDate), lte: new Date(hastaDate) } },
            _sum: { total: true },
          }),
          prisma.payment.aggregate({
            where: { invoice: { projectId: p.id, tipo: "EMITIDA" }, fechaPago: { gte: new Date(desdeDate), lte: new Date(hastaDate) } },
            _sum: { montoPagado: true },
          }),
          prisma.payment.aggregate({
            where: { invoice: { projectId: p.id, tipo: "RECIBIDA" }, fechaPago: { gte: new Date(desdeDate), lte: new Date(hastaDate) } },
            _sum: { montoPagado: true },
          }),
          prisma.invoice.findMany({ where: { projectId: p.id, estado: { not: "ANULADA" } }, include: { payments: true } }),
          prisma.anticipo.aggregate({ where: { projectId: p.id }, _sum: { monto: true, saldoAplicado: true } }),
          prisma.retencionFondo.aggregate({ where: { projectId: p.id }, _sum: { monto: true, saldoLiberado: true } }),
        ]);

        let porCobrar = 0;
        let porPagar = 0;
        for (const inv of invoices) {
          const pagado = inv.payments.reduce((a, pay) => a + moneyNumber(pay.montoPagado), 0);
          const saldo = saldoPendiente({ total: moneyNumber(inv.total), montoRetenido: moneyNumber(inv.montoRetenido), totalPagado: pagado });
          if (esIngreso(inv.tipo)) porCobrar += saldo;
          else porPagar += saldo;
        }
        const anticiposPendientes = moneyNumber(anticipos._sum.monto) - moneyNumber(anticipos._sum.saldoAplicado);
        const fondoReparoPendiente = moneyNumber(retenciones._sum.monto) - moneyNumber(retenciones._sum.saldoLiberado);

        return {
          obra: p,
          facturado: moneyNumber(facturadoAgg._sum.total),
          cobrado: moneyNumber(cobradoAgg._sum.montoPagado),
          porCobrar,
          anticipos: anticiposPendientes,
          fondoReparo: fondoReparoPendiente,
          pagado: moneyNumber(pagadoAgg._sum.montoPagado),
          porPagar,
        };
      })
    );

    ok(res, { desde: desdeDate, hasta: hastaDate, filas });
  })
);
