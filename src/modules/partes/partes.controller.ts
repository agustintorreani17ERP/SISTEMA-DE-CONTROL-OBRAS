import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { audit } from "../../domain/audit";
import { assertOpenPeriod } from "../../domain/progress";
import { today, toDay } from "../../domain/prices";
import { costoHoraEmpleados, loadCargasConfig } from "../../domain/labor";
import { asistenciaDesdeParte } from "../../domain/laborCost";
import { analizarCombustible } from "../../domain/fuelMath";

/**
 * Parte diario de obra: horas de personal y equipos por ítem (llave de la vía C), avance del día
 * (provisorio), cargas de combustible y viajes de camión. El celular manda cada parte con un
 * clientUuid: si se reenvía (cola sin conexión) no se duplica.
 */
export const partesRouter = Router();

const intId = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PARTE_SOURCE = "ParteDiario";
const notaAsistencia = (id: number) => `Parte diario #${id}`;

const itemRef = intId.nullish();
const parteSchema = z.object({
  clientUuid: z.string().min(8).max(64),
  fecha: dateSchema,
  workFrontId: intId.nullish(),
  clima: z.string().max(40).nullish(),
  estadoFaena: z.enum(["NORMAL", "PARCIAL", "SUSPENDIDA"]).default("NORMAL"),
  actividades: z.string().max(4000).nullish(),
  observaciones: z.string().max(2000).nullish(),
  supervisor: z.string().max(120).nullish(),
  createdBy: z.string().max(120).nullish(),
  personal: z.array(z.object({ empleadoId: intId, budgetItemId: itemRef, horas: z.number().positive().max(24) })).max(500).default([]),
  equipos: z.array(z.object({ insumoId: intId, budgetItemId: itemRef, horas: z.number().positive().max(24), nota: z.string().max(300).nullish() })).max(300).default([]),
  avance: z
    .array(z.object({ budgetItemId: intId, cantidad: z.number().refine((n) => n !== 0, "La cantidad no puede ser 0"), nota: z.string().max(300).nullish() }))
    .max(500)
    .default([]),
  combustible: z
    .array(
      z.object({
        equipoId: intId,
        litros: z.number().positive().max(100_000),
        horometro: z.number().min(0).nullish(),
        fotoUrl: z.string().max(300).nullish(),
        nota: z.string().max(300).nullish(),
      })
    )
    .max(100)
    .default([]),
  viajes: z
    .array(
      z.object({
        equipoId: intId.nullish(),
        origen: z.string().min(1).max(120),
        destino: z.string().min(1).max(120),
        materialId: intId.nullish(),
        materialTexto: z.string().max(120).nullish(),
        cantidad: z.number().positive().max(1_000_000),
        unidad: z.enum(["M3", "T"]),
        km: z.number().min(0).max(100_000).nullish(),
        budgetItemId: itemRef,
        nota: z.string().max(300).nullish(),
      })
    )
    .max(300)
    .default([]),
});
type ParteBody = z.infer<typeof parteSchema>;

async function validarReferencias(projectId: number, b: ParteBody) {
  const itemIds = new Set<number>();
  for (const l of [...b.personal, ...b.equipos, ...b.avance, ...b.viajes]) if (l.budgetItemId) itemIds.add(l.budgetItemId);
  if (itemIds.size) {
    const n = await prisma.budgetItem.count({ where: { id: { in: [...itemIds] }, projectId, nodeKind: "ITEM", isSystem: false } });
    if (n !== itemIds.size) throw new DomainError("INVALID_ITEM", "Hay ítems que no son del presupuesto de esta obra", 422);
  }
  const equipoIds = new Set<number>([...b.equipos.map((e) => e.insumoId), ...b.combustible.map((c) => c.equipoId), ...b.viajes.flatMap((v) => (v.equipoId ? [v.equipoId] : []))]);
  if (equipoIds.size) {
    const n = await prisma.material.count({ where: { id: { in: [...equipoIds] }, tipo: "TIEMPO" } });
    if (n !== equipoIds.size) throw new DomainError("NOT_TIME_INSUMO", "Los equipos deben ser insumos de tipo TIEMPO", 422);
  }
  const matIds = [...new Set(b.viajes.flatMap((v) => (v.materialId ? [v.materialId] : [])))];
  if (matIds.length && (await prisma.material.count({ where: { id: { in: matIds } } })) !== matIds.length) {
    throw new DomainError("INVALID_MATERIAL", "Hay materiales de viajes que no existen", 422);
  }
  const empIds = [...new Set(b.personal.map((p) => p.empleadoId))];
  if (empIds.length && (await prisma.empleado.count({ where: { id: { in: empIds } } })) !== empIds.length) {
    throw new DomainError("INVALID_EMPLOYEE", "Hay empleados que no existen", 422);
  }
  const porEmpleado = new Map<number, number>();
  for (const p of b.personal) porEmpleado.set(p.empleadoId, (porEmpleado.get(p.empleadoId) ?? 0) + p.horas);
  if ([...porEmpleado.values()].some((h) => h > 24)) throw new DomainError("TOO_MANY_HOURS", "Un empleado no puede sumar más de 24 horas en el día", 422);
  const porEquipo = new Map<number, number>();
  for (const e of b.equipos) porEquipo.set(e.insumoId, (porEquipo.get(e.insumoId) ?? 0) + e.horas);
  if ([...porEquipo.values()].some((h) => h > 24)) throw new DomainError("TOO_MANY_HOURS", "Un equipo no puede sumar más de 24 horas en el día", 422);
  if (b.workFrontId && !(await prisma.workFront.findFirst({ where: { id: b.workFrontId, projectId }, select: { id: true } }))) {
    throw new DomainError("INVALID_FRONT", "El frente no es de esta obra", 422);
  }
}

/** Datos para armar el parte en el celular (se guardan para usarlos sin conexión). */
partesRouter.get(
  "/projects/:id/parte-diario/catalogo",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new NotFoundError("Obra", projectId);
    const [items, empleados, equipos, materiales, frentes] = await Promise.all([
      prisma.budgetItem.findMany({
        where: { projectId, nodeKind: "ITEM", isSystem: false },
        select: { id: true, code: true, name: true, unit: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.empleado.findMany({
        where: { activo: true, OR: [{ projectId }, { projectId: null }] },
        select: { id: true, fullName: true, oficio: true, tipo: true, projectId: true },
        orderBy: { fullName: "asc" },
      }),
      prisma.material.findMany({
        where: { tipo: "TIEMPO", active: true },
        select: { id: true, code: true, description: true, unit: true, estimatedCost: true, consumoLh: true, categoria: true },
        orderBy: { code: "asc" },
      }),
      prisma.material.findMany({
        where: { categoria: "MATERIAL", active: true },
        select: { id: true, code: true, description: true, unit: true },
        orderBy: { code: "asc" },
      }),
      prisma.workFront.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const { map } = await costoHoraEmpleados(prisma, projectId, empleados.map((e) => e.id));
    ok(res, {
      projectId,
      generadoEl: new Date().toISOString(),
      items: items.map((i) => ({ ...i, unit: i.unit ?? "" })),
      empleados: empleados.map((e) => ({ ...e, costoHora: map.get(e.id)?.costoHora ?? 0 })),
      equipos: equipos.map((e) => ({ ...e, costoHora: moneyNumber(e.estimatedCost), consumoLh: e.consumoLh === null ? null : moneyNumber(e.consumoLh), estimatedCost: undefined })),
      materiales,
      frentes,
    });
  })
);

const rangeSchema = z.object({ desde: dateSchema, hasta: dateSchema });

partesRouter.get(
  "/projects/:id/partes-diarios",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = rangeSchema.parse(req.query);
    const partes = await prisma.parteDiario.findMany({
      where: { projectId, fecha: { gte: toDay(q.desde), lte: toDay(q.hasta) } },
      include: {
        workFront: { select: { name: true } },
        horasPersonal: { include: { empleado: { select: { fullName: true } }, budgetItem: { select: { code: true, name: true } } } },
        horasEquipo: { include: { insumo: { select: { code: true, description: true } }, budgetItem: { select: { code: true, name: true } } } },
        cargas: { include: { equipo: { select: { code: true, description: true } } } },
        viajes: { include: { equipo: { select: { code: true } }, material: { select: { code: true, description: true } }, budgetItem: { select: { code: true, name: true } } } },
      },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 200,
    });
    const avances = await prisma.avanceItem.findMany({
      where: { sourceType: PARTE_SOURCE, sourceId: { in: partes.map((p) => p.id) } },
      include: { budgetItem: { select: { code: true, name: true, unit: true } } },
    });
    ok(
      res,
      partes.map((p) => ({
        id: p.id,
        clientUuid: p.clientUuid,
        fecha: iso(p.fecha),
        frente: p.workFront?.name ?? null,
        clima: p.clima,
        estadoFaena: p.estadoFaena,
        actividades: p.actividades,
        observaciones: p.observaciones,
        supervisor: p.supervisor,
        createdAt: p.createdAt,
        personal: p.horasPersonal.map((h) => ({ id: h.id, empleado: h.empleado.fullName, item: h.budgetItem, horas: moneyNumber(h.horas) })),
        equipos: p.horasEquipo.map((h) => ({ id: h.id, equipo: h.insumo, item: h.budgetItem, horas: moneyNumber(h.horas) })),
        avance: avances
          .filter((a) => a.sourceId === p.id)
          .map((a) => ({ id: a.id, item: a.budgetItem, cantidad: moneyNumber(a.cantidad), origen: a.origen })),
        combustible: p.cargas.map((c) => ({ id: c.id, equipo: c.equipo, litros: moneyNumber(c.litros), horometro: c.horometro === null ? null : moneyNumber(c.horometro), fotoUrl: c.fotoUrl })),
        viajes: p.viajes.map((v) => ({
          id: v.id,
          camion: v.equipo?.code ?? null,
          origen: v.origen,
          destino: v.destino,
          material: v.material ? `${v.material.code} ${v.material.description}` : v.materialTexto,
          cantidad: moneyNumber(v.cantidad),
          unidad: v.unidad,
          km: v.km === null ? null : moneyNumber(v.km),
          item: v.budgetItem,
        })),
      }))
    );
  })
);

partesRouter.post(
  "/projects/:id/partes-diarios",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const b = parteSchema.parse(req.body);
    const existente = await prisma.parteDiario.findUnique({ where: { clientUuid: b.clientUuid }, select: { id: true, projectId: true } });
    if (existente) {
      if (existente.projectId !== projectId) throw new DomainError("UUID_CONFLICT", "El identificador del parte ya se usó en otra obra", 409);
      return ok(res, { id: existente.id, duplicado: true, avisos: [] });
    }
    if (toDay(b.fecha) > today()) throw new DomainError("FUTURE_DATE", "El parte no puede tener fecha futura", 400);
    const vacio = !b.personal.length && !b.equipos.length && !b.avance.length && !b.combustible.length && !b.viajes.length && !b.actividades?.trim();
    if (vacio) throw new DomainError("EMPTY_PARTE", "El parte no tiene horas, avance, combustible, viajes ni actividades", 422);
    await validarReferencias(projectId, b);
    const cfg = await loadCargasConfig(prisma, projectId);
    const fecha = toDay(b.fecha);

    let id: number;
    try {
      id = await prisma.$transaction(async (tx) => {
        await assertOpenPeriod(tx, projectId, b.fecha, "El parte diario");
        const parte = await tx.parteDiario.create({
          data: {
            projectId,
            fecha,
            workFrontId: b.workFrontId ?? null,
            clima: b.clima || null,
            estadoFaena: b.estadoFaena,
            actividades: b.actividades?.trim() || null,
            observaciones: b.observaciones?.trim() || null,
            supervisor: b.supervisor || null,
            clientUuid: b.clientUuid,
            createdBy: b.createdBy || null,
          },
        });
        const base = { projectId, fecha, parteId: parte.id };
        if (b.personal.length) {
          await tx.parteHoraPersonal.createMany({
            data: b.personal.map((p) => ({ ...base, empleadoId: p.empleadoId, budgetItemId: p.budgetItemId ?? null, horas: p.horas })),
          });
          // La asistencia (liquidación de haberes) se deriva del parte si ese día no tenía una cargada
          const porEmp = new Map<number, { budgetItemId: number | null; horas: number }[]>();
          for (const p of b.personal) {
            if (!porEmp.has(p.empleadoId)) porEmp.set(p.empleadoId, []);
            porEmp.get(p.empleadoId)!.push({ budgetItemId: p.budgetItemId ?? null, horas: p.horas });
          }
          const ya = await tx.asistencia.findMany({ where: { projectId, fecha, empleadoId: { in: [...porEmp.keys()] } }, select: { empleadoId: true } });
          const tienen = new Set(ya.map((a) => a.empleadoId));
          for (const [empleadoId, lineas] of porEmp) {
            if (tienen.has(empleadoId)) continue;
            const a = asistenciaDesdeParte(lineas, cfg.horasDiasLaborales);
            await tx.asistencia.create({
              data: { empleadoId, projectId, fecha, estado: a.estado, horasNormales: a.horasNormales, horasExtra: a.horasExtra, budgetItemId: a.budgetItemId, notas: notaAsistencia(parte.id) },
            });
          }
        }
        if (b.equipos.length) {
          await tx.parteEquipo.createMany({
            data: b.equipos.map((e) => ({ ...base, insumoId: e.insumoId, budgetItemId: e.budgetItemId ?? null, horas: e.horas, nota: e.nota || null, createdBy: b.createdBy || null })),
          });
        }
        if (b.avance.length) {
          await tx.avanceItem.createMany({
            data: b.avance.map((a) => ({
              projectId,
              fecha,
              budgetItemId: a.budgetItemId,
              cantidad: a.cantidad,
              origen: "PARTE_DIARIO" as const,
              sourceType: PARTE_SOURCE,
              sourceId: parte.id,
              nota: a.nota || null,
              createdBy: b.createdBy || null,
            })),
          });
        }
        if (b.combustible.length) {
          await tx.cargaCombustible.createMany({
            data: b.combustible.map((c) => ({ ...base, equipoId: c.equipoId, litros: c.litros, horometro: c.horometro ?? null, fotoUrl: c.fotoUrl || null, nota: c.nota || null })),
          });
        }
        if (b.viajes.length) {
          await tx.viajeCamion.createMany({
            data: b.viajes.map((v) => ({
              ...base,
              equipoId: v.equipoId ?? null,
              origen: v.origen,
              destino: v.destino,
              materialId: v.materialId ?? null,
              materialTexto: v.materialId ? null : v.materialTexto || null,
              cantidad: v.cantidad,
              unidad: v.unidad,
              km: v.km ?? null,
              budgetItemId: v.budgetItemId ?? null,
              nota: v.nota || null,
            })),
          });
        }
        await audit(tx, {
          entity: "ParteDiario",
          entityId: parte.id,
          action: "CREATE",
          payload: { fecha: b.fecha, personal: b.personal.length, equipos: b.equipos.length, avance: b.avance.length, combustible: b.combustible.length, viajes: b.viajes.length },
        });
        return parte.id;
      });
    } catch (e) {
      // Dos envíos simultáneos del mismo parte: gana el primero
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const p = await prisma.parteDiario.findUnique({ where: { clientUuid: b.clientUuid }, select: { id: true } });
        if (p) return ok(res, { id: p.id, duplicado: true, avisos: [] });
      }
      throw e;
    }

    const avisos: string[] = [];
    if (b.combustible.length) {
      const r = await combustibleAnalisis(projectId, b.fecha, b.fecha, b.combustible.map((c) => c.equipoId));
      for (const c of r.cargas) {
        const eq = r.equipos.get(c.equipoId);
        if (c.estado === "ALERTA") avisos.push(`${eq?.code}: consumo ${c.consumoReal} L/h, ${Math.round((c.desvioPct ?? 0) * 100)} % sobre el teórico (${c.consumoTeorico} L/h)`);
        if (c.estado === "HOROMETRO_INVALIDO") avisos.push(`${eq?.code}: el horómetro es menor que el de la carga anterior`);
        if (c.alertaHoras) avisos.push(`${eq?.code}: las horas del parte (${c.horasParte}) no coinciden con el horómetro (${c.horasHorometro})`);
      }
    }
    ok(res, { id, duplicado: false, avisos }, 201);
  })
);

partesRouter.delete(
  "/partes-diarios/:id",
  asyncHandler(async (req, res) => {
    const id = intId.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const p = await tx.parteDiario.findUnique({ where: { id } });
      if (!p) throw new NotFoundError("Parte diario", id);
      await assertOpenPeriod(tx, p.projectId, p.fecha, "El parte diario");
      await tx.avanceItem.deleteMany({ where: { sourceType: PARTE_SOURCE, sourceId: id, origen: "PARTE_DIARIO" } });
      await tx.asistencia.deleteMany({ where: { projectId: p.projectId, fecha: p.fecha, notas: notaAsistencia(id) } });
      await tx.parteDiario.delete({ where: { id } });
      await audit(tx, { entity: "ParteDiario", entityId: id, action: "DELETE" });
    });
    ok(res, { deleted: true, id });
  })
);

/** Cargas del rango analizadas contra la carga anterior de cada equipo (aunque sea previa al rango). */
async function combustibleAnalisis(projectId: number, desde: string, hasta: string, soloEquipos?: number[]) {
  const d0 = toDay(desde);
  const d1 = toDay(hasta);
  const enRango = await prisma.cargaCombustible.findMany({
    where: { projectId, fecha: { gte: d0, lte: d1 }, ...(soloEquipos ? { equipoId: { in: soloEquipos } } : {}) },
    select: { equipoId: true },
  });
  const equipoIds = [...new Set(enRango.map((c) => c.equipoId))];
  if (!equipoIds.length) return { cargas: [], resumen: [], equipos: new Map() };
  const cargas = await prisma.cargaCombustible.findMany({
    where: { projectId, equipoId: { in: equipoIds }, fecha: { lte: d1 } },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  // Solo hace falta desde la última carga anterior al rango
  const desdeHoras = cargas.filter((c) => c.fecha < d0).map((c) => c.fecha).sort((a, b) => +b - +a)[0] ?? d0;
  const [horas, equipos] = await Promise.all([
    prisma.parteEquipo.findMany({ where: { projectId, insumoId: { in: equipoIds }, fecha: { gt: new Date(+desdeHoras - 86400000), lte: d1 } } }),
    prisma.material.findMany({ where: { id: { in: equipoIds } }, select: { id: true, code: true, description: true, unit: true, consumoLh: true, toleranciaPct: true } }),
  ]);
  const r = analizarCombustible(
    cargas.map((c) => ({ id: c.id, fecha: iso(c.fecha), equipoId: c.equipoId, litros: moneyNumber(c.litros), horometro: c.horometro === null ? null : moneyNumber(c.horometro) })),
    horas.map((h) => ({ equipoId: h.insumoId, fecha: iso(h.fecha), horas: moneyNumber(h.horas) })),
    equipos.map((e) => ({ id: e.id, consumoLh: e.consumoLh === null ? null : moneyNumber(e.consumoLh), toleranciaPct: moneyNumber(e.toleranciaPct) }))
  );
  const extra = new Map(cargas.map((c) => [c.id, c]));
  return {
    cargas: r.cargas.filter((c) => c.fecha >= desde && c.fecha <= hasta).map((c) => ({ ...c, fotoUrl: extra.get(c.id)?.fotoUrl ?? null, parteId: extra.get(c.id)?.parteId ?? null })),
    resumen: r.equipos,
    equipos: new Map(equipos.map((e) => [e.id, e])),
  };
}

partesRouter.get(
  "/projects/:id/combustible",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = rangeSchema.parse(req.query);
    const r = await combustibleAnalisis(projectId, q.desde, q.hasta);
    ok(res, { cargas: r.cargas, resumen: r.resumen, equipos: [...r.equipos.values()].map((e) => ({ ...e, consumoLh: e.consumoLh === null ? null : moneyNumber(e.consumoLh), toleranciaPct: moneyNumber(e.toleranciaPct) })) });
  })
);

partesRouter.get(
  "/projects/:id/viajes",
  asyncHandler(async (req, res) => {
    const projectId = intId.parse(req.params.id);
    const q = rangeSchema.parse(req.query);
    const viajes = await prisma.viajeCamion.findMany({
      where: { projectId, fecha: { gte: toDay(q.desde), lte: toDay(q.hasta) } },
      include: {
        equipo: { select: { code: true, description: true } },
        material: { select: { code: true, description: true } },
        budgetItem: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 2000,
    });
    const rows = viajes.map((v) => ({
      id: v.id,
      fecha: iso(v.fecha),
      parteId: v.parteId,
      camion: v.equipo ? `${v.equipo.code} ${v.equipo.description}` : null,
      origen: v.origen,
      destino: v.destino,
      material: v.material ? `${v.material.code} ${v.material.description}` : v.materialTexto,
      cantidad: moneyNumber(v.cantidad),
      unidad: v.unidad as "M3" | "T",
      km: v.km === null ? null : moneyNumber(v.km),
      item: v.budgetItem,
    }));
    // Resumen por ítem: viajes, m³, t y km
    const porItem = new Map<string, { item: { id: number; code: string; name: string } | null; viajes: number; m3: number; t: number; km: number }>();
    for (const r of rows) {
      const k = r.item ? String(r.item.id) : "-";
      const acc = porItem.get(k) ?? { item: r.item, viajes: 0, m3: 0, t: 0, km: 0 };
      acc.viajes++;
      if (r.unidad === "M3") acc.m3 += r.cantidad;
      else acc.t += r.cantidad;
      acc.km += r.km ?? 0;
      porItem.set(k, acc);
    }
    ok(res, { viajes: rows, resumen: [...porItem.values()].sort((a, b) => b.viajes - a.viajes) });
  })
);
