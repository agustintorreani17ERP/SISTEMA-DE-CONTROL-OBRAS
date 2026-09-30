import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";

/**
 * Cuentas financieras (bancos y cajas) de la obra. Todo Payment usa una CuentaFinanciera.
 * El saldo nunca se guarda pre-sumado: se calcula como saldoInicial + movimientos confirmados
 * (MovimientoCuentaFinanciera) hasta la fecha. Los cheques diferidos solo generan movimiento
 * cuando pasan a ACREDITADO.
 */
export const cuentasFinancierasRouter = Router();

async function saldoHasta(cuentaId: number, hasta?: Date) {
  const where: any = { cuentaFinancieraId: cuentaId, confirmado: true };
  if (hasta) where.fecha = { lte: hasta };
  const [ingresos, egresos] = await Promise.all([
    prisma.movimientoCuentaFinanciera.aggregate({ where: { ...where, tipo: "INGRESO" }, _sum: { monto: true } }),
    prisma.movimientoCuentaFinanciera.aggregate({ where: { ...where, tipo: "EGRESO" }, _sum: { monto: true } }),
  ]);
  return moneyNumber(ingresos._sum.monto) - moneyNumber(egresos._sum.monto);
}

cuentasFinancierasRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    }
    const cuentas = await prisma.cuentaFinanciera.findMany({
      where: { projectId },
      include: { cuentaContable: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: { id: "asc" },
    });
    const data = await Promise.all(
      cuentas.map(async (c) => ({
        ...c,
        saldoInicial: moneyNumber(c.saldoInicial),
        saldoActual: moneyNumber(c.saldoInicial) + (await saldoHasta(c.id)),
      }))
    );
    ok(res, data);
  })
);

const cuentaSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  nombre: z.string().trim().min(2),
  tipo: z.enum(["BANCO", "CAJA"]).default("BANCO"),
  moneda: z.string().trim().default("PYG"),
  banco: z.string().trim().optional(),
  numeroCuenta: z.string().trim().optional(),
  cuentaContableId: z.coerce.number().int().positive().nullish(),
  saldoInicial: z.coerce.number().default(0),
});

cuentasFinancierasRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = cuentaSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    const cuenta = await prisma.cuentaFinanciera.create({ data: body });
    ok(res, { ...cuenta, saldoInicial: moneyNumber(cuenta.saldoInicial), saldoActual: moneyNumber(cuenta.saldoInicial) }, 201);
  })
);

cuentasFinancierasRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = cuentaSchema
      .partial()
      .omit({ projectId: true })
      .extend({ active: z.boolean().optional() })
      .parse(req.body);
    const cuenta = await prisma.cuentaFinanciera.findUnique({ where: { id } });
    if (!cuenta) throw new NotFoundError("Cuenta financiera", id);
    const updated = await prisma.cuentaFinanciera.update({ where: { id }, data: body });
    ok(res, { ...updated, saldoInicial: moneyNumber(updated.saldoInicial), saldoActual: moneyNumber(updated.saldoInicial) + (await saldoHasta(id)) });
  })
);

const rangoSchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

/** Saldo al inicio del rango, movimientos confirmados del rango y saldo al final. */
cuentasFinancierasRouter.get(
  "/:id/movimientos",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { desde, hasta } = rangoSchema.parse(req.query);
    const cuenta = await prisma.cuentaFinanciera.findUnique({ where: { id } });
    if (!cuenta) throw new NotFoundError("Cuenta financiera", id);

    const diaAnterior = desde ? new Date(desde.getTime() - 1) : undefined;
    const saldoInicialRango = moneyNumber(cuenta.saldoInicial) + (desde ? await saldoHasta(id, diaAnterior) : 0);

    const where: any = { cuentaFinancieraId: id };
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = desde;
      if (hasta) where.fecha.lte = hasta;
    }
    const movimientos = await prisma.movimientoCuentaFinanciera.findMany({ where, orderBy: [{ fecha: "asc" }, { id: "asc" }] });

    let acumulado = saldoInicialRango;
    const detalle = movimientos.map((m) => {
      if (m.confirmado) acumulado += m.tipo === "INGRESO" ? moneyNumber(m.monto) : -moneyNumber(m.monto);
      return { ...m, monto: moneyNumber(m.monto), saldoAcumulado: acumulado };
    });

    ok(res, {
      cuenta: { ...cuenta, saldoInicial: moneyNumber(cuenta.saldoInicial) },
      saldoInicialRango,
      movimientos: detalle,
      saldoFinalRango: acumulado,
    });
  })
);

const transferSchema = z.object({
  cuentaOrigenId: z.coerce.number().int().positive(),
  cuentaDestinoId: z.coerce.number().int().positive(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date(),
  concepto: z.string().trim().optional(),
});

cuentasFinancierasRouter.post(
  "/transferencias",
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    if (body.cuentaOrigenId === body.cuentaDestinoId) {
      throw new DomainError("SAME_ACCOUNT", "La cuenta de origen y destino no pueden ser la misma", 422);
    }
    const [origen, destino] = await Promise.all([
      prisma.cuentaFinanciera.findUnique({ where: { id: body.cuentaOrigenId } }),
      prisma.cuentaFinanciera.findUnique({ where: { id: body.cuentaDestinoId } }),
    ]);
    if (!origen) throw new NotFoundError("Cuenta financiera", body.cuentaOrigenId);
    if (!destino) throw new NotFoundError("Cuenta financiera", body.cuentaDestinoId);

    const result = await prisma.$transaction(async (tx) => {
      const transferencia = await tx.transferenciaCuenta.create({ data: body });
      const concepto = body.concepto?.trim() || `Transferencia ${origen.nombre} → ${destino.nombre}`;
      await tx.movimientoCuentaFinanciera.create({
        data: {
          cuentaFinancieraId: origen.id,
          fecha: body.fecha,
          tipo: "EGRESO",
          monto: body.monto,
          concepto,
          confirmado: true,
          sourceType: "TransferenciaCuenta",
          sourceId: transferencia.id,
        },
      });
      await tx.movimientoCuentaFinanciera.create({
        data: {
          cuentaFinancieraId: destino.id,
          fecha: body.fecha,
          tipo: "INGRESO",
          monto: body.monto,
          concepto,
          confirmado: true,
          sourceType: "TransferenciaCuenta",
          sourceId: transferencia.id,
        },
      });
      return transferencia;
    });
    ok(res, result, 201);
  })
);

cuentasFinancierasRouter.get(
  "/cheques",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    }
    const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
    const cheques = await prisma.cheque.findMany({
      where: {
        cuenta: { projectId },
        ...(estado ? { estado: estado as any } : {}),
      },
      include: {
        cuenta: { select: { id: true, nombre: true } },
        partner: { select: { id: true, name: true } },
      },
      orderBy: { fechaPago: "asc" },
    });
    ok(res, cheques.map((c) => ({ ...c, monto: moneyNumber(c.monto) })));
  })
);

const estadoChequeSchema = z.object({
  estado: z.enum(["PENDIENTE", "DEPOSITADO", "ACREDITADO", "RECHAZADO", "ANULADO"]),
});

/**
 * Transición de estado de un cheque. Solo ACREDITADO mueve el saldo de la cuenta (a la fecha de
 * pago diferida del cheque); si un cheque ya acreditado pasa a RECHAZADO o ANULADO, se revierte.
 */
cuentasFinancierasRouter.patch(
  "/cheques/:id/estado",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { estado } = estadoChequeSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const cheque = await tx.cheque.findUnique({ where: { id } });
      if (!cheque) throw new NotFoundError("Cheque", id);
      if (cheque.estado === "ANULADO") {
        throw new DomainError("CHEQUE_ANULADO", "El cheque ya está anulado", 409);
      }
      const wasAcreditado = cheque.estado === "ACREDITADO";
      const willBeAcreditado = estado === "ACREDITADO";

      const updated = await tx.cheque.update({ where: { id }, data: { estado } });

      if (!wasAcreditado && willBeAcreditado) {
        await tx.movimientoCuentaFinanciera.create({
          data: {
            cuentaFinancieraId: cheque.cuentaFinancieraId,
            fecha: cheque.fechaPago,
            tipo: cheque.tipo === "EMITIDO" ? "EGRESO" : "INGRESO",
            monto: cheque.monto,
            concepto: `Cheque ${cheque.tipo === "EMITIDO" ? "emitido" : "recibido"} N° ${cheque.numero}`,
            confirmado: true,
            sourceType: "Cheque",
            sourceId: cheque.id,
          },
        });
      } else if (wasAcreditado && !willBeAcreditado) {
        await tx.movimientoCuentaFinanciera.deleteMany({ where: { sourceType: "Cheque", sourceId: cheque.id } });
      }
      return updated;
    });
    ok(res, { ...result, monto: moneyNumber(result.monto) });
  })
);
