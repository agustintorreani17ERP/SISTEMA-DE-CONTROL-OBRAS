import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { toDecimal } from "../../lib/money";
import { postCost, postMovement } from "../../domain/budget";
import { assertOpenPeriod, fechaContable } from "../../domain/progress";
import { today } from "../../domain/prices";
import { invalidateCostCache } from "../../domain/costCache";
import { costoHoraEmpleados } from "../../domain/labor";
import { cargasPct } from "../../domain/laborCost";
import { EVENTO, postAsientoDesdeRegla } from "../../domain/contabilidad";

export const rrhhRouter = Router();

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function getConfig(projectId?: number) {
  const cfg = projectId
    ? await prisma.rRHHConfig.findUnique({ where: { projectId } })
    : null;
  if (cfg) return cfg;
  // fallback: defaults
  return {
    pctIpsObrero: toDecimal(9),
    pctIpsPatronal: toDecimal(16.5),
    factorHoraExtra: toDecimal(1.5),
    horasDiasLaborales: toDecimal(8),
    bonificacionFamiliar: toDecimal(0),
    aguinaldoMeses: toDecimal(12),
    pctVacaciones: toDecimal(4.17),
    pctOtrasCargas: toDecimal(0),
    diasLaboralesMes: toDecimal(26),
  };
}

function calcLiquidacion(params: {
  salarioBase: number;
  diasTrabajados: number;
  horasNormales: number;
  horasExtra: number;
  bonificacionFamiliar: number;
  otrosBonos: number;
  anticipos: number;
  otrosDescuentos: number;
  pctIpsObrero: number;
  pctIpsPatronal: number;
  factorHoraExtra: number;
  horasDiasLaborales: number;
  aguinaldoMeses: number;
}) {
  const {
    salarioBase,
    diasTrabajados,
    horasNormales,
    horasExtra,
    bonificacionFamiliar,
    otrosBonos,
    anticipos,
    otrosDescuentos,
    pctIpsObrero,
    pctIpsPatronal,
    factorHoraExtra,
    horasDiasLaborales,
    aguinaldoMeses,
  } = params;

  // Valor de hora normal = salario / 30 / horasDiasLaborales
  const valorHoraNormal = salarioBase / 30 / horasDiasLaborales;
  const valorHoraExtra = valorHoraNormal * factorHoraExtra;
  const montoHorasExtra = Math.round(horasExtra * valorHoraExtra);

  // Salario proporcional si trabaja menos de 30 días
  const salarioProporcional = Math.round((salarioBase * diasTrabajados) / 30);

  const subTotal = salarioProporcional + montoHorasExtra + bonificacionFamiliar + otrosBonos;

  const ipsObrero = Math.round(subTotal * (pctIpsObrero / 100));
  const ipsPatronal = Math.round(subTotal * (pctIpsPatronal / 100));
  const aguinaldo = Math.round(subTotal / aguinaldoMeses);

  const netoAPagar = subTotal - ipsObrero - anticipos - otrosDescuentos;
  const costoTotal = subTotal + ipsPatronal; // costo empresa

  return {
    valorHoraExtra: Math.round(valorHoraExtra * 10000) / 10000,
    montoHorasExtra,
    salarioProporcional,
    subTotal,
    ipsObrero,
    ipsPatronal,
    aguinaldo,
    netoAPagar,
    costoTotal,
  };
}

// ──────────────────────────────────────────────
// Empleados
// ──────────────────────────────────────────────

rrhhRouter.get(
  "/rrhh/empleados",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.empleado.findMany({
        where: projectId ? { projectId } : undefined,
        include: { project: { select: { id: true, name: true, code: true } } },
        orderBy: { fullName: "asc" },
      })
    );
  })
);

rrhhRouter.get(
  "/rrhh/empleados/:id",
  asyncHandler(async (req, res) => {
    const e = await prisma.empleado.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        project: { select: { id: true, name: true, code: true } },
        documentos: true,
      },
    });
    if (!e) throw new NotFoundError("Empleado", Number(req.params.id) || 0);
    ok(res, e);
  })
);

const EmpleadoSchema = z.object({
  fullName: z.string().min(2),
  ci: z.string().min(3),
  oficio: z.string().min(2),
  tipo: z.enum(["MENSUALERO", "JORNALERO", "DESTAJISTA"]),
  fechaIngreso: z.string(),
  salarioBase: z.number().positive(),
  nroIPS: z.string().optional().nullable(),
  banco: z.string().optional().nullable(),
  cuentaBanco: z.string().optional().nullable(),
  activo: z.boolean().optional(),
  notas: z.string().optional().nullable(),
  projectId: z.number().int().optional().nullable(),
  personnelId: z.number().int().optional().nullable(),
  costoHoraManual: z.number().positive().optional().nullable(),
});

rrhhRouter.post(
  "/rrhh/empleados",
  asyncHandler(async (req, res) => {
    const body = EmpleadoSchema.parse(req.body);
    const e = await prisma.empleado.create({
      data: {
        ...body,
        salarioBase: toDecimal(body.salarioBase),
        fechaIngreso: new Date(body.fechaIngreso),
      },
    });
    ok(res, e, 201);
  })
);

rrhhRouter.put(
  "/rrhh/empleados/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = EmpleadoSchema.partial().parse(req.body);
    const e = await prisma.empleado.update({
      where: { id },
      data: {
        ...body,
        ...(body.salarioBase !== undefined && { salarioBase: toDecimal(body.salarioBase) }),
        ...(body.fechaIngreso !== undefined && { fechaIngreso: new Date(body.fechaIngreso) }),
      },
    });
    invalidateCostCache();
    ok(res, e);
  })
);

/** Costo hora con cargas de los empleados (de la obra, o todos). */
rrhhRouter.get(
  "/rrhh/costo-hora",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    const emps = await prisma.empleado.findMany({
      where: projectId ? { projectId } : undefined,
      select: { id: true, fullName: true, tipo: true, salarioBase: true },
      orderBy: { fullName: "asc" },
    });
    const { cfg, map } = await costoHoraEmpleados(prisma, projectId, emps.map((e) => e.id));
    ok(res, {
      config: cfg,
      cargas: cargasPct(cfg),
      empleados: emps.map((e) => ({ id: e.id, fullName: e.fullName, tipo: e.tipo, salarioBase: Number(e.salarioBase), ...map.get(e.id)! })),
    });
  })
);

// ──────────────────────────────────────────────
// Documentos adjuntos
// ──────────────────────────────────────────────

rrhhRouter.post(
  "/rrhh/empleados/:id/documentos",
  asyncHandler(async (req, res) => {
    const empleadoId = Number(req.params.id);
    const { tipo, url, nombre } = z
      .object({ tipo: z.string(), url: z.string().url(), nombre: z.string() })
      .parse(req.body);
    const doc = await prisma.empleadoDoc.create({ data: { empleadoId, tipo, url, nombre } });
    ok(res, doc, 201);
  })
);

rrhhRouter.delete(
  "/rrhh/documentos/:id",
  asyncHandler(async (req, res) => {
    await prisma.empleadoDoc.delete({ where: { id: Number(req.params.id) } });
    ok(res, { deleted: true });
  })
);

// ──────────────────────────────────────────────
// Asistencia
// ──────────────────────────────────────────────

rrhhRouter.get(
  "/rrhh/asistencias",
  asyncHandler(async (req, res) => {
    const { projectId, fecha, empleadoId } = req.query;
    ok(
      res,
      await prisma.asistencia.findMany({
        where: {
          ...(projectId ? { projectId: Number(projectId) } : {}),
          ...(empleadoId ? { empleadoId: Number(empleadoId) } : {}),
          ...(fecha ? { fecha: new Date(fecha as string) } : {}),
        },
        include: {
          empleado: { select: { id: true, fullName: true, tipo: true, salarioBase: true } },
          budgetItem: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ fecha: "desc" }, { empleado: { fullName: "asc" } }],
      })
    );
  })
);

const AsistenciaSchema = z.object({
  empleadoId: z.number().int(),
  projectId: z.number().int(),
  budgetItemId: z.number().int().optional().nullable(),
  fecha: z.string(),
  estado: z.enum(["PRESENTE", "AUSENTE", "MEDIA_JORNADA", "FERIADO"]).default("PRESENTE"),
  horasNormales: z.number().min(0).default(8),
  horasExtra: z.number().min(0).default(0),
  jornal: z.number().min(0).default(0),
  notas: z.string().optional().nullable(),
});

rrhhRouter.post(
  "/rrhh/asistencias",
  asyncHandler(async (req, res) => {
    const body = AsistenciaSchema.parse(req.body);
    // La asistencia es llave de reparto del costo por tiempo: lo cerrado no se edita.
    await assertOpenPeriod(prisma, body.projectId, body.fecha, "La asistencia");
    const a = await prisma.asistencia.upsert({
      where: { empleadoId_projectId_fecha: { empleadoId: body.empleadoId, projectId: body.projectId, fecha: new Date(body.fecha) } },
      create: {
        ...body,
        horasNormales: toDecimal(body.horasNormales),
        horasExtra: toDecimal(body.horasExtra),
        jornal: toDecimal(body.jornal),
        fecha: new Date(body.fecha),
      },
      update: {
        estado: body.estado,
        horasNormales: toDecimal(body.horasNormales),
        horasExtra: toDecimal(body.horasExtra),
        jornal: toDecimal(body.jornal),
        budgetItemId: body.budgetItemId,
        notas: body.notas,
      },
    });
    ok(res, a, 201);
  })
);

// Batch upsert (para pegar planilla entera)
rrhhRouter.post(
  "/rrhh/asistencias/batch",
  asyncHandler(async (req, res) => {
    const rows = z.array(AsistenciaSchema).parse(req.body);
    for (const r of rows) await assertOpenPeriod(prisma, r.projectId, r.fecha, "La asistencia");
    const results = await prisma.$transaction(
      rows.map((body) =>
        prisma.asistencia.upsert({
          where: { empleadoId_projectId_fecha: { empleadoId: body.empleadoId, projectId: body.projectId, fecha: new Date(body.fecha) } },
          create: {
            ...body,
            horasNormales: toDecimal(body.horasNormales),
            horasExtra: toDecimal(body.horasExtra),
            jornal: toDecimal(body.jornal),
            fecha: new Date(body.fecha),
          },
          update: {
            estado: body.estado,
            horasNormales: toDecimal(body.horasNormales),
            horasExtra: toDecimal(body.horasExtra),
            jornal: toDecimal(body.jornal),
            budgetItemId: body.budgetItemId,
            notas: body.notas,
          },
        })
      )
    );
    ok(res, results);
  })
);

// ──────────────────────────────────────────────
// Liquidaciones
// ──────────────────────────────────────────────

rrhhRouter.get(
  "/rrhh/liquidaciones",
  asyncHandler(async (req, res) => {
    const { projectId, periodo, empleadoId } = req.query;
    ok(
      res,
      await prisma.liquidacionPersonal.findMany({
        where: {
          ...(projectId ? { projectId: Number(projectId) } : {}),
          ...(empleadoId ? { empleadoId: Number(empleadoId) } : {}),
          ...(periodo ? { periodo: periodo as string } : {}),
        },
        include: {
          empleado: { select: { id: true, fullName: true, ci: true, tipo: true } },
          project: { select: { id: true, name: true, code: true } },
          budgetItem: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ periodo: "desc" }, { empleado: { fullName: "asc" } }],
      })
    );
  })
);

rrhhRouter.get(
  "/rrhh/liquidaciones/:id",
  asyncHandler(async (req, res) => {
    const liq = await prisma.liquidacionPersonal.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        empleado: true,
        project: { select: { id: true, name: true, code: true } },
        budgetItem: { select: { id: true, code: true, name: true } },
      },
    });
    if (!liq) throw new NotFoundError("Liquidacion", Number(req.params.id));
    ok(res, liq);
  })
);

// Pre-calcula sin guardar (para preview en frontend)
rrhhRouter.post(
  "/rrhh/liquidaciones/calcular",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        empleadoId: z.number().int(),
        projectId: z.number().int(),
        periodo: z.string(),
        diasTrabajados: z.number().min(0),
        horasNormales: z.number().min(0),
        horasExtra: z.number().min(0),
        bonificacionFamiliar: z.number().min(0).default(0),
        otrosBonos: z.number().min(0).default(0),
        anticipos: z.number().min(0).default(0),
        otrosDescuentos: z.number().min(0).default(0),
      })
      .parse(req.body);

    const emp = await prisma.empleado.findUnique({ where: { id: body.empleadoId } });
    if (!emp) throw new NotFoundError("Empleado", Number(req.params.id) || 0);

    const cfg = await getConfig(body.projectId);
    const result = calcLiquidacion({
      salarioBase: Number(emp.salarioBase),
      diasTrabajados: body.diasTrabajados,
      horasNormales: body.horasNormales,
      horasExtra: body.horasExtra,
      bonificacionFamiliar: body.bonificacionFamiliar,
      otrosBonos: body.otrosBonos,
      anticipos: body.anticipos,
      otrosDescuentos: body.otrosDescuentos,
      pctIpsObrero: Number(cfg.pctIpsObrero),
      pctIpsPatronal: Number(cfg.pctIpsPatronal),
      factorHoraExtra: Number(cfg.factorHoraExtra),
      horasDiasLaborales: Number(cfg.horasDiasLaborales),
      aguinaldoMeses: Number(cfg.aguinaldoMeses),
    });

    ok(res, { empleado: emp, config: cfg, ...body, ...result });
  })
);

const LiquidacionSchema = z.object({
  empleadoId: z.number().int(),
  projectId: z.number().int(),
  periodo: z.string(),
  diasTrabajados: z.number().min(0),
  horasNormales: z.number().min(0),
  horasExtra: z.number().min(0),
  bonificacionFamiliar: z.number().min(0).default(0),
  otrosBonos: z.number().min(0).default(0),
  anticipos: z.number().min(0).default(0),
  otrosDescuentos: z.number().min(0).default(0),
  budgetItemId: z.number().int().optional().nullable(),
  notas: z.string().optional().nullable(),
});

rrhhRouter.post(
  "/rrhh/liquidaciones",
  asyncHandler(async (req, res) => {
    const body = LiquidacionSchema.parse(req.body);

    const emp = await prisma.empleado.findUnique({ where: { id: body.empleadoId } });
    if (!emp) throw new NotFoundError("Empleado", Number(req.params.id) || 0);

    const cfg = await getConfig(body.projectId);
    const calc = calcLiquidacion({
      salarioBase: Number(emp.salarioBase),
      diasTrabajados: body.diasTrabajados,
      horasNormales: body.horasNormales,
      horasExtra: body.horasExtra,
      bonificacionFamiliar: body.bonificacionFamiliar,
      otrosBonos: body.otrosBonos,
      anticipos: body.anticipos,
      otrosDescuentos: body.otrosDescuentos,
      pctIpsObrero: Number(cfg.pctIpsObrero),
      pctIpsPatronal: Number(cfg.pctIpsPatronal),
      factorHoraExtra: Number(cfg.factorHoraExtra),
      horasDiasLaborales: Number(cfg.horasDiasLaborales),
      aguinaldoMeses: Number(cfg.aguinaldoMeses),
    });

    const liq = await prisma.liquidacionPersonal.create({
      data: {
        empleadoId: body.empleadoId,
        projectId: body.projectId,
        periodo: body.periodo,
        diasTrabajados: toDecimal(body.diasTrabajados),
        horasNormales: toDecimal(body.horasNormales),
        horasExtra: toDecimal(body.horasExtra),
        salarioBase: emp.salarioBase,
        valorHoraExtra: toDecimal(calc.valorHoraExtra),
        montoHorasExtra: toDecimal(calc.montoHorasExtra),
        bonificacionFamiliar: toDecimal(body.bonificacionFamiliar),
        otrosBonos: toDecimal(body.otrosBonos),
        subTotal: toDecimal(calc.subTotal),
        ipsObrero: toDecimal(calc.ipsObrero),
        ipsPatronal: toDecimal(calc.ipsPatronal),
        aguinaldo: toDecimal(calc.aguinaldo),
        anticipos: toDecimal(body.anticipos),
        otrosDescuentos: toDecimal(body.otrosDescuentos),
        netoAPagar: toDecimal(calc.netoAPagar),
        costoTotal: toDecimal(calc.costoTotal),
        budgetItemId: body.budgetItemId,
        notas: body.notas,
      },
      include: { empleado: true, project: { select: { id: true, name: true, code: true } } },
    });

    ok(res, liq, 201);
  })
);

// Aprobar liquidación → asiento presupuestario
rrhhRouter.post(
  "/rrhh/liquidaciones/:id/aprobar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const liq = await prisma.liquidacionPersonal.findUnique({
      where: { id },
      include: { empleado: true },
    });
    if (!liq) throw new NotFoundError("Liquidacion", Number(req.params.id));
    if (liq.estado !== "BORRADOR") throw new DomainError("ESTADO_INVALIDO", "Solo se puede aprobar un borrador");

    if (!liq.budgetItemId) {
      throw new DomainError("SIN_RUBRO", "Asignale un rubro presupuestario antes de aprobar");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Fecha del hecho: último día del mes liquidado (o el primer día abierto si ya se cerró)
      const [y, m] = liq.periodo.split("-").map(Number);
      const finDeMes = new Date(Date.UTC(y, m, 0));
      const hoy = today();
      const fc = await fechaContable(tx, liq.projectId, finDeMes > hoy ? hoy : finDeMes);
      const movement = await postMovement(tx, {
        projectId: liq.projectId,
        budgetItemId: liq.budgetItemId!,
        source: "LABOR_COST",
        stage: "ACTUAL",
        fecha: fc.fecha,
        amount: liq.costoTotal,
        sourceType: "LiquidacionPersonal",
        sourceId: id,
        sourceNumber: `LIQ-${liq.periodo}-${String(id).padStart(4, "0")}`,
        note: `Liquidación ${liq.periodo} — ${liq.empleado.fullName}`,
      });
      await postAsientoDesdeRegla(tx, {
        evento: EVENTO.LIQUIDACION_APROBADA,
        projectId: liq.projectId,
        concepto: `Liquidación ${liq.periodo} — ${liq.empleado.fullName}`,
        sourceType: "LiquidacionPersonal",
        sourceId: id,
        fecha: fc.fecha,
        debe: [{ monto: liq.costoTotal, budgetItemId: liq.budgetItemId! }],
        haber: [{ monto: liq.costoTotal }],
      });

      return tx.liquidacionPersonal.update({
        where: { id },
        data: { estado: "APROBADA", budgetMovementId: movement.movement.id },
        include: {
          empleado: true,
          project: { select: { id: true, name: true, code: true } },
          budgetItem: { select: { id: true, code: true, name: true } },
        },
      });
    });

    ok(res, updated);
  })
);

// Marcar como pagada
rrhhRouter.post(
  "/rrhh/liquidaciones/:id/pagar",
  asyncHandler(async (req, res) => {
    const liq = await prisma.liquidacionPersonal.update({
      where: { id: Number(req.params.id) },
      data: { estado: "PAGADA" },
    });
    ok(res, liq);
  })
);

// ──────────────────────────────────────────────
// Config RRHH
// ──────────────────────────────────────────────

rrhhRouter.get(
  "/rrhh/config",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(res, await getConfig(projectId));
  })
);

rrhhRouter.put(
  "/rrhh/config",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const body = z
      .object({
        pctIpsObrero: z.number().min(0),
        pctIpsPatronal: z.number().min(0),
        factorHoraExtra: z.number().min(1),
        horasDiasLaborales: z.number().min(1),
        bonificacionFamiliar: z.number().min(0),
        aguinaldoMeses: z.number().min(1),
        pctVacaciones: z.number().min(0).max(100).optional(),
        pctOtrasCargas: z.number().min(0).max(100).optional(),
        diasLaboralesMes: z.number().min(1).max(31).optional(),
      })
      .parse(req.body);

    const data = {
      pctIpsObrero: toDecimal(body.pctIpsObrero),
      pctIpsPatronal: toDecimal(body.pctIpsPatronal),
      factorHoraExtra: toDecimal(body.factorHoraExtra),
      horasDiasLaborales: toDecimal(body.horasDiasLaborales),
      bonificacionFamiliar: toDecimal(body.bonificacionFamiliar),
      aguinaldoMeses: toDecimal(body.aguinaldoMeses),
      ...(body.pctVacaciones !== undefined && { pctVacaciones: toDecimal(body.pctVacaciones) }),
      ...(body.pctOtrasCargas !== undefined && { pctOtrasCargas: toDecimal(body.pctOtrasCargas) }),
      ...(body.diasLaboralesMes !== undefined && { diasLaboralesMes: toDecimal(body.diasLaboralesMes) }),
    };
    invalidateCostCache();

    if (projectId) {
      const cfg = await prisma.rRHHConfig.upsert({
        where: { projectId },
        create: { projectId, ...data },
        update: data,
      });
      ok(res, cfg);
    } else {
      // Global (projectId null)
      const existing = await prisma.rRHHConfig.findFirst({ where: { projectId: null } });
      if (existing) {
        ok(res, await prisma.rRHHConfig.update({ where: { id: existing.id }, data }));
      } else {
        ok(res, await prisma.rRHHConfig.create({ data }));
      }
    }
  })
);
