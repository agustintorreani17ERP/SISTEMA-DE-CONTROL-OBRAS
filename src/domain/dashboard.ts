import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError } from "../errors/domain";
import { moneyNumber } from "../lib/money";
import { computeItemsAcu } from "./acu";
import { costEngine } from "./costEngine";
import { aggregate, alertas, byRubro, cortes, curvaS, type DashItemInput, itemRow } from "./dashboardMath";
import { toDay } from "./prices";
import { localIso } from "./localDate";
import { loadFacts, loadPlan, progressReport } from "./progress";
import { acumuladoAl } from "./progressMath";

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Inicio de obra: la más temprana entre la fecha de inicio cargada y el primer hecho (costo,
 * avance o plan). Sin nada de eso, el día de alta de la obra en hora de Paraguay (no en UTC:
 * una obra creada a las 21:00 del 29/9 es del 29/9). Nunca posterior a hoy.
 */
export async function obraInicio(db: Db, projectId: number): Promise<string> {
  const [p, mov, av, plan] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { startDate: true, createdAt: true } }),
    db.budgetMovement.findFirst({ where: { projectId, stage: "ACTUAL" }, orderBy: { fecha: "asc" }, select: { fecha: true } }),
    db.avanceItem.findFirst({ where: { projectId }, orderBy: { fecha: "asc" }, select: { fecha: true } }),
    db.avancePlanificado.findFirst({ where: { projectId }, orderBy: { fecha: "asc" }, select: { fecha: true } }),
  ]);
  // Columnas DATE (medianoche UTC): su día es la parte UTC. startDate se carga como día calendario.
  // Hechos con fecha futura (p. ej. una medición cuyo período termina después de hoy) no cuentan.
  const hoy = localIso();
  const fechas = [p?.startDate, mov?.fecha, av?.fecha, plan?.fecha]
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .map(iso)
    .filter((f) => f <= hoy);
  const inicio = fechas.length ? fechas.sort()[0] : localIso(p?.createdAt ?? new Date());
  return inicio > hoy ? hoy : inicio;
}

/** Rubro (nodo raíz) de cada ítem hoja. */
async function rubroDeItems(db: Db, projectId: number) {
  const nodes = await db.budgetItem.findMany({ where: { projectId }, select: { id: true, parentId: true, code: true, name: true, nodeKind: true } });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<number, { id: number; code: string; name: string } | null>();
  for (const n of nodes) {
    if (n.nodeKind !== "ITEM") continue;
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    let rubro: typeof cur;
    while (cur) {
      if (cur.nodeKind === "RUBRO") rubro = cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(n.id, rubro ? { id: rubro.id, code: rubro.code, name: rubro.name } : null);
  }
  return out;
}

/**
 * Tablero de costos de la obra para [desde, hasta]: todo sale del motor de costos (costo real del
 * rango y acumulado desde el inicio) y del avance fechado.
 */
export async function dashboard(db: Db, projectId: number, desde: string, hasta: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, coeficienteK: true, ivaPct: true } });
  if (!project) throw new NotFoundError("Obra", projectId);
  const inicioObra = await obraInicio(db, projectId);
  // Si el rango pedido termina antes (fechas pasadas), el inicio no puede quedar después del fin
  const inicio = inicioObra > hasta ? desde : inicioObra;
  const desdeAcum = inicio < desde ? inicio : desde;

  const rango = await costEngine(db, projectId, desde, hasta);
  const acum = desdeAcum === desde ? rango : await costEngine(db, projectId, desdeAcum, hasta);
  const report = await progressReport(db, projectId, desde, hasta);
  const items = await db.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM", isSystem: false },
    select: { id: true, unitPrice: true, totalQuantity: true },
  });
  const [acu, rubros] = await Promise.all([computeItemsAcu(db, items, project, toDay(hasta)), rubroDeItems(db, projectId)]);
  const costoRango = new Map(rango.items.map((i) => [i.budgetItemId, i.total]));
  const costoAcum = new Map(acum.items.map((i) => [i.budgetItemId, i.total]));

  const inputs: DashItemInput[] = report.rows.map((r) => {
    const a = acu.get(r.budgetItemId)?.result;
    return {
      id: r.budgetItemId,
      code: r.code,
      name: r.name,
      unit: r.unit,
      rubro: rubros.get(r.budgetItemId) ?? null,
      contrato: r.contrato,
      puSinIva: r.puSinIva,
      costoMetaUnit: r.costoMetaUnit,
      superaOferta: a?.superaOferta ?? false,
      diferenciaOferta: a?.diferenciaOferta ?? null,
      ejecutado: r.ejecutado,
      planificado: r.planificado,
      costoReal: costoRango.get(r.budgetItemId) ?? 0,
      acumulado: r.acumulado,
      costoRealAcum: costoAcum.get(r.budgetItemId) ?? 0,
    };
  });
  const rows = inputs.map(itemRow);
  const rubrosRows = byRubro(inputs, rows);
  const obra = aggregate(rows, { costoReal: rango.totales.costoReal, costoRealAcum: acum.totales.costoReal });

  // Curva S desde el inicio: planificado (VP), ganado (VG) y real (libro mayor) acumulados
  const [plan, facts, costos] = await Promise.all([
    loadPlan(db, projectId),
    loadFacts(db, projectId, hasta),
    db.budgetMovement.groupBy({
      by: ["fecha"],
      where: { projectId, stage: "ACTUAL", source: { not: "CLIENT_CERTIFICATE" }, fecha: { lte: toDay(hasta) } },
      _sum: { amount: true },
    }),
  ]);
  const curva = curvaS(cortes(desdeAcum, hasta), {
    items: inputs.map((i) => ({ id: i.id, costoMetaUnit: i.costoMetaUnit })),
    plan,
    acumuladoAl: (id, fecha) => acumuladoAl(facts.get(id) ?? [], fecha).total,
    costos: costos.map((c) => ({ fecha: iso(c.fecha), amount: moneyNumber(c._sum.amount) })),
  });

  const t = rango.totales;
  return {
    desde,
    hasta,
    inicio,
    origen: rango.origen,
    obra: { ...obra, perdidas: t.perdidas, noImputado: t.noImputado, totalContable: t.totalContable, validacionOk: t.ok },
    /** Subtotal de ítems (sin pérdidas de material), como la hoja 8. */
    subtotalItems: aggregate(rows),
    rubros: rubrosRows,
    items: rows,
    alertas: alertas({
      obra,
      rubros: rubrosRows,
      items: rows,
      inputs,
      materiales: rango.materiales,
      noImputado: t.noImputado,
      totalContable: t.totalContable,
      validacionOk: t.ok,
    }),
    curva,
    avisos: rango.avisos,
  };
}

const SOURCE_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Orden de compra",
  SUBCONTRACT: "Certificado de subcontratista",
  PETTY_CASH: "Caja chica",
  MANUAL_ADJUSTMENT: "Ajuste manual",
  LABOR_COST: "Liquidación de personal",
  STOCK_TRANSFER: "Transferencia de stock",
  INVOICE: "Factura sin OC",
};

/** Del ítem a los documentos que forman su costo en el rango, por vía. */
export async function itemDrill(db: Db, projectId: number, budgetItemId: number, desde: string, hasta: string) {
  const item = await db.budgetItem.findFirst({ where: { id: budgetItemId, projectId }, select: { id: true, code: true, name: true, unit: true } });
  if (!item) throw new NotFoundError("Ítem", budgetItemId);
  const d0 = toDay(desde);
  const d1 = toDay(hasta);
  const engine = await costEngine(db, projectId, desde, hasta);
  const cost = engine.items.find((i) => i.budgetItemId === budgetItemId) ?? null;

  // Vía A (y personal ya asignado al ítem): los asientos del libro mayor del ítem, por documento
  const movs = await db.budgetMovement.findMany({
    where: { projectId, budgetItemId, stage: "ACTUAL", source: { not: "CLIENT_CERTIFICATE" }, fecha: { gte: d0, lte: d1 } },
    include: { insumo: { select: { code: true, description: true } } },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  const docs = new Map<string, { sourceType: string; sourceId: number; numero: string | null; fuente: string; via: "A" | "C"; fecha: string; monto: number; insumos: Set<string> }>();
  for (const m of movs) {
    const k = `${m.sourceType}#${m.sourceId}`;
    const d = docs.get(k) ?? {
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      numero: m.sourceNumber,
      fuente: SOURCE_LABEL[m.source] ?? m.source,
      via: m.source === "LABOR_COST" ? ("C" as const) : ("A" as const),
      fecha: iso(m.fecha),
      monto: 0,
      insumos: new Set<string>(),
    };
    d.monto += moneyNumber(m.amount);
    if (m.insumo) d.insumos.add(`${m.insumo.code} ${m.insumo.description}`);
    docs.set(k, d);
  }

  // Vía C: horas del ítem en el rango (llave del reparto del pozo de tiempo)
  const [equipos, personal] = await Promise.all([
    db.parteEquipo.findMany({
      where: { projectId, budgetItemId, fecha: { gte: d0, lte: d1 } },
      include: { insumo: { select: { code: true, description: true } } },
      orderBy: { fecha: "asc" },
    }),
    db.parteHoraPersonal.findMany({
      where: { projectId, budgetItemId, fecha: { gte: d0, lte: d1 } },
      include: { empleado: { select: { fullName: true } } },
      orderBy: { fecha: "asc" },
    }),
  ]);
  const horasEquipo = new Map<string, number>();
  for (const e of equipos) horasEquipo.set(`${e.insumo.code} ${e.insumo.description}`, (horasEquipo.get(`${e.insumo.code} ${e.insumo.description}`) ?? 0) + moneyNumber(e.horas));
  const horasPersonal = new Map<string, number>();
  for (const h of personal) horasPersonal.set(h.empleado.fullName, (horasPersonal.get(h.empleado.fullName) ?? 0) + moneyNumber(h.horas));

  return {
    item,
    desde,
    hasta,
    costo: cost,
    viaA: [...docs.values()].filter((d) => d.via === "A").map((d) => ({ ...d, monto: Math.round(d.monto), insumos: [...d.insumos] })),
    viaB: cost?.b.insumos ?? [],
    viaC: {
      total: cost?.c.total ?? 0,
      asignado: cost?.c.asignado ?? 0,
      porHoras: cost?.c.porHoras ?? 0,
      porVG: cost?.c.porVG ?? 0,
      liquidaciones: [...docs.values()].filter((d) => d.via === "C").map((d) => ({ ...d, monto: Math.round(d.monto), insumos: [...d.insumos] })),
      horasEquipo: [...horasEquipo.entries()].map(([equipo, horas]) => ({ equipo, horas })),
      horasPersonal: [...horasPersonal.entries()].map(([persona, horas]) => ({ persona, horas })),
      pozo: engine.tiempo,
    },
  };
}
