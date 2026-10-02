import { Prisma, PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "../errors/domain";
import { moneyNumber } from "../lib/money";
import { computeItemsAcu } from "./acu";
import { toDay, today } from "./prices";
import { AvanceFact, avanceRango, indicadores, PlanFact, planAcumulado, planRango } from "./progressMath";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Avance fechado por ítem, cronograma y cierres oficiales.
 * La medición oficial es la del certificado al cliente (Certification sin partnerId): al cerrar
 * su medición se registra como AvanceItem MEDICION_OFICIAL con la fecha de fin de su período.
 */

export const CERT_SOURCE = "Certification";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date | string) => (typeof d === "string" ? d : iso(d)).split("-").reverse().join("/");

/**
 * Lo cerrado no se edita: ningún hecho con fecha hasta el último cierre oficial (inclusive).
 * También lo anterior al rango cerrado, porque cambiaría saldos y acumulados del cierre.
 */
export async function assertOpenPeriod(db: Db, projectId: number, fecha: Date | string, que = "El movimiento") {
  const day = toDay(fecha);
  const cierre = await db.cierrePeriodo.findFirst({ where: { projectId, hasta: { gte: day } }, orderBy: { hasta: "desc" } });
  if (cierre) {
    throw new DomainError(
      "PERIOD_CLOSED",
      `${que} tiene fecha ${fmt(day)} y la obra está cerrada oficialmente hasta el ${fmt(cierre.hasta)}: lo cerrado no se edita. ` +
        `Cargalo con fecha posterior al ${fmt(cierre.hasta)} o pedí a un administrador que reabra el último cierre (Centro de Costos › Avance › Cierres oficiales).`,
      409
    );
  }
}

/** Última fecha cerrada oficialmente de la obra (inclusive), o null si no hay cierres. */
export async function cerradoHasta(db: Db, projectId: number): Promise<Date | null> {
  const last = await db.cierrePeriodo.findFirst({ where: { projectId }, orderBy: { hasta: "desc" } });
  return last?.hasta ?? null;
}

/**
 * Fecha contable de un hecho que se confirma tarde (rendición de caja chica, liquidación): su
 * propia fecha si el período sigue abierto; si ya se cerró, el primer día abierto.
 */
export async function fechaContable(db: Db, projectId: number, fecha: Date | string) {
  const day = toDay(fecha);
  const last = await db.cierrePeriodo.findFirst({ where: { projectId }, orderBy: { hasta: "desc" } });
  if (!last || day > last.hasta) return { fecha: day, desplazada: false };
  const next = new Date(last.hasta);
  next.setUTCDate(next.getUTCDate() + 1);
  return { fecha: next, desplazada: true };
}

/** Aviso para un documento que se contabilizó el primer día abierto. */
export const avisoTardio = (que: string, d: { fechaDocumento: Date; fechaContable: Date }) =>
  `${que} tiene fecha ${fmt(d.fechaDocumento)}, en un período cerrado: su costo se contabiliza el ${fmt(d.fechaContable)} (primer día abierto).`;

export async function loadFacts(db: Db, projectId: number, hasta?: Date | string) {
  const rows = await db.avanceItem.findMany({
    where: { projectId, ...(hasta ? { fecha: { lte: toDay(hasta) } } : {}) },
    select: { budgetItemId: true, fecha: true, cantidad: true, origen: true },
  });
  const out = new Map<number, AvanceFact[]>();
  for (const r of rows) {
    const list = out.get(r.budgetItemId) ?? [];
    list.push({ fecha: iso(r.fecha), cantidad: moneyNumber(r.cantidad), origen: r.origen });
    out.set(r.budgetItemId, list);
  }
  return out;
}

export async function loadPlan(db: Db, projectId: number) {
  const rows = await db.avancePlanificado.findMany({ where: { projectId }, select: { budgetItemId: true, fecha: true, cantidad: true } });
  const out = new Map<number, PlanFact[]>();
  for (const r of rows) {
    const list = out.get(r.budgetItemId) ?? [];
    list.push({ fecha: iso(r.fecha), cantidad: moneyNumber(r.cantidad) });
    out.set(r.budgetItemId, list);
  }
  return out;
}

export interface ProgressRow {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  contrato: number;
  puConIva: number;
  puSinIva: number;
  costoMetaUnit: number | null;
  costoMetaFuente: "ACU" | "K" | null;
  anterior: number;
  ejecutado: number;
  acumulado: number;
  anteriorOficial: number;
  ejecutadoOficial: number;
  acumuladoOficial: number;
  provisorio: number;
  ultimaOficial: string | null;
  planificado: number;
  planAcumulado: number;
  pctAvance: number | null;
  cumplimiento: number | null;
  vp: number | null;
  vg: number | null;
  ventaSinIva: number;
  ip: number | null;
  excedeContrato: boolean;
}

/**
 * Avance de cada ítem en [desde, hasta]. `soloOficial` usa solo mediciones oficiales (lo que va
 * al cierre y al certificado); si no, el avance vigente (oficial + partes provisorios).
 */
export async function progressReport(db: Db, projectId: number, desde: string, hasta: string, soloOficial = false) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, coeficienteK: true, ivaPct: true } });
  const items = await db.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM", isSystem: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, name: true, unit: true, totalQuantity: true, unitPrice: true },
  });
  const [facts, plan, acu] = await Promise.all([loadFacts(db, projectId, hasta), loadPlan(db, projectId), computeItemsAcu(db, items, project, toDay(hasta))]);
  const iva = moneyNumber(project.ivaPct);

  const rows: ProgressRow[] = items.map((i) => {
    const a = avanceRango(facts.get(i.id) ?? [], desde, hasta);
    const p = plan.get(i.id) ?? [];
    const r = acu.get(i.id)!.result;
    const puConIva = moneyNumber(i.unitPrice);
    const puSinIva = puConIva / (1 + iva / 100);
    const contrato = moneyNumber(i.totalQuantity);
    const ejecutado = soloOficial ? a.rangoOficial : a.rango;
    const acumulado = soloOficial ? a.acumuladoOficial : a.acumulado;
    const planificado = planRango(p, desde, hasta);
    return {
      budgetItemId: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      contrato,
      puConIva,
      puSinIva,
      costoMetaUnit: r.costoMetaUnit,
      costoMetaFuente: r.fuente,
      anterior: soloOficial ? a.anteriorOficial : a.anterior,
      ejecutado,
      acumulado,
      anteriorOficial: a.anteriorOficial,
      ejecutadoOficial: a.rangoOficial,
      acumuladoOficial: a.acumuladoOficial,
      provisorio: a.provisorio,
      ultimaOficial: a.ultimaOficial,
      planificado,
      planAcumulado: planAcumulado(p, hasta),
      ...indicadores({ contrato, acumulado, ejecutado, planificado, costoMetaUnit: r.costoMetaUnit, puSinIva }),
      excedeContrato: contrato > 0 && acumulado > contrato + 0.0001,
    };
  });

  const sum = (f: (r: ProgressRow) => number | null) => rows.reduce((acc, r) => acc + (f(r) ?? 0), 0);
  const vp = sum((r) => r.vp);
  const vg = sum((r) => r.vg);
  return {
    desde,
    hasta,
    soloOficial,
    rows,
    totales: {
      ventaSinIva: sum((r) => r.ventaSinIva),
      vp,
      vg,
      ip: vp > 0 ? vg / vp : null,
      itemsConAvance: rows.filter((r) => r.ejecutado !== 0).length,
      itemsProvisorios: rows.filter((r) => r.provisorio !== 0).length,
      itemsExcedidos: rows.filter((r) => r.excedeContrato).length,
    },
  };
}

// ─── Cierres ──────────────────────────────────────────────────────────────

async function closingChecks(db: Db, projectId: number, desde: Date, hasta: Date) {
  if (desde > hasta) throw new DomainError("INVALID_RANGE", "La fecha desde es posterior a la fecha hasta", 400);
  if (hasta > today()) {
    throw new DomainError("FUTURE_CLOSE", `No se puede cerrar un período que todavía no terminó: elegí como fecha hasta el ${fmt(today())} o antes.`, 400);
  }
  const last = await db.cierrePeriodo.findFirst({ where: { projectId }, orderBy: { hasta: "desc" } });
  if (last && desde <= last.hasta) {
    const next = new Date(last.hasta);
    next.setUTCDate(next.getUTCDate() + 1);
    throw new DomainError(
      "CLOSE_OVERLAP",
      `El nuevo cierre tiene que empezar después del último (cerrado hasta el ${fmt(last.hasta)}): usá como desde el ${fmt(next)}. Para corregir el último cierre, reabrilo primero.`,
      409
    );
  }
  const blockers: string[] = [];
  const abiertas = await db.certification.findMany({
    where: { projectId, partnerId: null, estado: "MEDICION_BORRADOR", periodTo: { gte: desde, lte: hasta } },
    select: { numero: true },
  });
  if (abiertas.length) {
    blockers.push(`Hay mediciones al cliente sin cerrar en el rango (N° ${abiertas.map((c) => c.numero).join(", ")}): cerralas o borralas antes.`);
  }
  return blockers;
}

export async function closingPreview(db: Db, projectId: number, desde: string, hasta: string) {
  const blockers = await closingChecks(db, projectId, toDay(desde), toDay(hasta));
  const report = await progressReport(db, projectId, desde, hasta, true);
  const avisos: string[] = [];
  const prov = report.rows.filter((r) => r.provisorio !== 0);
  if (prov.length) {
    avisos.push(`${prov.length} ítem(s) tienen partes diarios sin medición oficial al ${fmt(hasta)}: quedan fuera del cierre (siguen como provisorios).`);
  }
  if (report.totales.itemsExcedidos) avisos.push(`${report.totales.itemsExcedidos} ítem(s) superan la cantidad del contrato.`);
  return { blockers, avisos, report };
}

export async function closePeriod(
  tx: Prisma.TransactionClient,
  params: { projectId: number; desde: string; hasta: string; notas?: string | null; createdBy?: string | null },
  /** Resultado del motor de costos del rango (oficial), que queda congelado en el snapshot. */
  costos?: { avisos: string[]; totales: { ok: boolean } } & Record<string, unknown>
) {
  const { blockers, avisos, report } = await closingPreview(tx, params.projectId, params.desde, params.hasta);
  if (blockers.length) throw new DomainError("CLOSE_BLOCKED", blockers.join(" "), 409);
  if (costos && !costos.totales.ok) avisos.push("El motor de costos no validó el rango (ver avisos de costos).");
  const snapshot = { version: 2, generadoEl: new Date().toISOString(), avisos, avance: report, costos: costos ?? null } satisfies Record<string, unknown>;
  return tx.cierrePeriodo.create({
    data: {
      projectId: params.projectId,
      desde: toDay(params.desde),
      hasta: toDay(params.hasta),
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      notas: params.notas || null,
      createdBy: params.createdBy || null,
    },
  });
}

/**
 * Reabre el último cierre oficial de la obra (los anteriores no se reabren): guarda una copia con
 * su snapshot y el motivo en CierreReapertura y lo borra, así sus fechas vuelven a estar abiertas.
 * La factura al cliente que tuviera queda vigente (desvinculada): lo facturado se descuenta al volver a cerrar.
 */
export async function reopenLastClosing(tx: Prisma.TransactionClient, cierreId: number, params: { motivo: string; usuario?: string | null }) {
  const motivo = params.motivo.trim();
  if (motivo.length < 10) throw new DomainError("REOPEN_REASON", "Escribí el motivo de la reapertura (al menos 10 caracteres).", 422);
  const cierre = await tx.cierrePeriodo.findUnique({ where: { id: cierreId }, include: { factura: { select: { id: true, numeroFactura: true } } } });
  if (!cierre) throw new NotFoundError("Cierre", cierreId);
  const last = await tx.cierrePeriodo.findFirst({ where: { projectId: cierre.projectId }, orderBy: { hasta: "desc" } });
  if (last && last.id !== cierre.id) {
    throw new DomainError(
      "REOPEN_NOT_LAST",
      `Solo se puede reabrir el último cierre (${fmt(last.desde)} – ${fmt(last.hasta)}); los cierres anteriores no se reabren.`,
      409
    );
  }
  const archivo = await tx.cierreReapertura.create({
    data: {
      projectId: cierre.projectId,
      cierreIdOriginal: cierre.id,
      desde: cierre.desde,
      hasta: cierre.hasta,
      snapshot: cierre.snapshot as Prisma.InputJsonValue,
      notas: cierre.notas,
      cerradoPor: cierre.createdBy,
      cerradoEl: cierre.createdAt,
      facturaId: cierre.factura?.id ?? null,
      motivo,
      reabiertoPor: params.usuario || null,
    },
  });
  if (cierre.factura) await tx.invoice.update({ where: { id: cierre.factura.id }, data: { cierreId: null } });
  await tx.cierrePeriodo.delete({ where: { id: cierre.id } });
  return { archivo, cierre: { id: cierre.id, projectId: cierre.projectId, desde: iso(cierre.desde), hasta: iso(cierre.hasta) }, factura: cierre.factura ?? null };
}

/** Cierre que contiene la fecha, o null. */
export function cierreDe(db: Db, projectId: number, fecha: Date | string) {
  const day = toDay(fecha);
  return db.cierrePeriodo.findFirst({ where: { projectId, desde: { lte: day }, hasta: { gte: day } } });
}

// ─── Medición oficial = medición del certificado al cliente ──────────────

/** Fecha de una medición: fin de su período, o la fecha de la medición si no lo tiene. */
export const measurementDate = (cert: { periodTo: Date | null; fecha: Date }) => cert.periodTo ?? cert.fecha;

/** Rehace los AvanceItem oficiales de un certificado al cliente con sus cantidades presentes. */
export async function syncOfficialMeasurement(tx: Prisma.TransactionClient, certificationId: number) {
  const cert = await tx.certification.findUniqueOrThrow({ where: { id: certificationId }, include: { items: true } });
  if (cert.partnerId) return;
  const previous = await tx.avanceItem.findMany({ where: { sourceType: CERT_SOURCE, sourceId: cert.id } });
  for (const p of previous) await assertOpenPeriod(tx, cert.projectId, p.fecha, "La medición oficial anterior");
  await tx.avanceItem.deleteMany({ where: { sourceType: CERT_SOURCE, sourceId: cert.id } });
  if (cert.estado === "MEDICION_BORRADOR") return;
  const fecha = measurementDate(cert);
  await assertOpenPeriod(tx, cert.projectId, fecha, "La medición oficial");
  const rows = cert.items.filter((i) => moneyNumber(i.cantidadPresente) !== 0);
  if (!rows.length) return;
  await tx.avanceItem.createMany({
    data: rows.map((i) => ({
      projectId: cert.projectId,
      budgetItemId: i.budgetItemId,
      fecha: toDay(fecha),
      cantidad: i.cantidadPresente,
      origen: "MEDICION_OFICIAL" as const,
      sourceType: CERT_SOURCE,
      sourceId: cert.id,
      nota: `Medición oficial N° ${cert.numero}`,
    })),
  });
}

export async function removeOfficialMeasurement(tx: Prisma.TransactionClient, certificationId: number) {
  const previous = await tx.avanceItem.findMany({ where: { sourceType: CERT_SOURCE, sourceId: certificationId } });
  for (const p of previous) await assertOpenPeriod(tx, p.projectId, p.fecha, "La medición oficial");
  await tx.avanceItem.deleteMany({ where: { sourceType: CERT_SOURCE, sourceId: certificationId } });
}

/**
 * Control de subcontratistas: lo que certifican en total (libro mayor, todas las fuentes) más lo
 * que se está certificando no puede superar la medición oficial acumulada del ítem.
 */
export async function subcontractOverMeasured(db: Db, projectId: number, lines: { budgetItemId: number; quantity: number }[]) {
  const ids = [...new Set(lines.map((l) => l.budgetItemId))];
  if (!ids.length) return [] as string[];
  const [items, official] = await Promise.all([
    db.budgetItem.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true, subcontractQuantity: true } }),
    db.avanceItem.groupBy({ by: ["budgetItemId"], where: { projectId, budgetItemId: { in: ids }, origen: "MEDICION_OFICIAL" }, _sum: { cantidad: true } }),
  ]);
  const medido = new Map(official.map((o) => [o.budgetItemId, moneyNumber(o._sum.cantidad)]));
  const nuevo = new Map<number, number>();
  for (const l of lines) nuevo.set(l.budgetItemId, (nuevo.get(l.budgetItemId) ?? 0) + l.quantity);
  const out: string[] = [];
  for (const i of items) {
    const sub = moneyNumber(i.subcontractQuantity) + (nuevo.get(i.id) ?? 0);
    const med = medido.get(i.id) ?? 0;
    if (sub > med + 0.0001) {
      out.push(
        `${i.code} ${i.name}: subcontratistas certifican ${sub.toLocaleString("es-PY")} ${i.unit ?? ""} y la medición oficial acumulada es ${med.toLocaleString("es-PY")}`
      );
    }
  }
  return out;
}
