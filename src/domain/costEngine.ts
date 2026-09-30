import { Prisma, PrismaClient } from "@prisma/client";
import { moneyNumber } from "../lib/money";
import { computeItemsAcu } from "./acu";
import { AcuComp, Bucket, computeCostEngine, EngineInput, EngineInsumo, EngineResult, HoraKey, InventarioInput, LedgerLine, teoricoPorInsumo } from "./costEngineMath";
import { DISTRIBUTION_ROOT_PATH } from "./generalExpenses";
import { precioVigente, toDay } from "./prices";
import { loadFacts, progressReport } from "./progress";
import { avanceRango, dayBefore } from "./progressMath";
import { COUNT_SOURCE } from "./stock";
import { cacheGet, cacheSet } from "./costCache";
import { costoHoraEmpleados } from "./labor";
import { pesosPersonal } from "./laborCost";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CostEngineResult extends EngineResult {
  projectId: number;
  soloOficial: boolean;
  origen: "calculado" | "cache" | "snapshot";
  generadoEl: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
};


const BUCKET_STOCK = `${DISTRIBUTION_ROOT_PATH}/DIST.STOCK`;
const BUCKET_TIEMPO = `${DISTRIBUTION_ROOT_PATH}/DIST.TIEMPO`;
function bucketOf(item: { path: string; isSystem: boolean }, source: string): Bucket {
  if (item.path === BUCKET_STOCK) return "POOL_STOCK";
  if (item.path === BUCKET_TIEMPO || item.path.startsWith(DISTRIBUTION_ROOT_PATH)) return "POOL_TIEMPO";
  if (item.isSystem) return "GG";
  return source === "LABOR_COST" ? "ITEM_TIEMPO" : "ITEM";
}

/** Movimientos de stock que no son consumo: compras, transferencias, ajustes manuales. */
const NO_CONSUMO = ["RECEIPT", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT", "REVERSAL"] as const;

/**
 * Costo por ítem de la obra en [desde, hasta], calculado en el momento con los hechos del rango.
 * `soloOficial` usa solo medición oficial para el avance (por defecto: sí si el rango está cerrado).
 */
export async function costEngine(
  db: Db,
  projectId: number,
  desde: string,
  hasta: string,
  opts: { soloOficial?: boolean; sinCache?: boolean } = {}
): Promise<CostEngineResult> {
  const ultimo = await db.cierrePeriodo.findFirst({ where: { projectId }, orderBy: { hasta: "desc" } });
  const cerrado = Boolean(ultimo && toDay(hasta) <= ultimo.hasta);
  const soloOficial = opts.soloOficial ?? cerrado;

  if (!opts.sinCache && cerrado && soloOficial) {
    const exacto = await db.cierrePeriodo.findFirst({ where: { projectId, desde: toDay(desde), hasta: toDay(hasta) } });
    const snap = (exacto?.snapshot as any)?.costos as CostEngineResult | undefined;
    if (snap) return { ...snap, origen: "snapshot" };
    const hit = cacheGet<CostEngineResult>(`${projectId}:${desde}:${hasta}`);
    if (hit) return { ...hit, origen: "cache" };
  }

  const input = await loadEngineInput(db, projectId, desde, hasta, soloOficial);
  const result: CostEngineResult = {
    ...computeCostEngine(input.engine),
    projectId,
    soloOficial,
    origen: "calculado",
    generadoEl: new Date().toISOString(),
  };
  result.avisos.push(...input.avisos);

  if (cerrado && soloOficial && !opts.sinCache) {
    cacheSet(`${projectId}:${desde}:${hasta}`, result);
  }
  return result;
}

async function loadEngineInput(db: Db, projectId: number, desde: string, hasta: string, soloOficial: boolean) {
  const avisos: string[] = [];
  const d0 = toDay(desde);
  const d1 = toDay(hasta);

  // Avance y valor ganado del rango
  const report = await progressReport(db, projectId, desde, hasta, soloOficial);
  const items = report.rows.map((r) => ({ id: r.budgetItemId, code: r.code, name: r.name, unit: r.unit, ejecutado: r.ejecutado, vg: r.vg }));

  // ACU con precios vigentes al fin del rango
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { coeficienteK: true, ivaPct: true } });
  const budgetItems = await db.budgetItem.findMany({
    where: { id: { in: items.map((i) => i.id) } },
    select: { id: true, unitPrice: true, totalQuantity: true },
  });
  const acuData = await computeItemsAcu(db, budgetItems, project, d1);
  const acu: Record<number, AcuComp[]> = {};
  const insumoIds = new Set<number>();
  for (const [itemId, a] of acuData) {
    acu[itemId] = a.lineas.map((l) => ({ insumoId: l.insumoId, consumo: l.consumo, desperdicioPct: l.desperdicioPct }));
    a.lineas.forEach((l) => insumoIds.add(l.insumoId));
  }

  // Insumos comunes con movimientos de stock en la obra (aunque no estén en un ACU)
  const stocked = await db.stockMovement.findMany({ where: { projectId, material: { tipo: "COMUN" } }, distinct: ["materialId"], select: { materialId: true } });
  stocked.forEach((s) => insumoIds.add(s.materialId));

  const [materials, prices] = await Promise.all([
    db.material.findMany({ where: { id: { in: [...insumoIds] } }, select: { id: true, code: true, description: true, unit: true, tipo: true, toleranciaPct: true } }),
    db.materialPrice.findMany({ where: { materialId: { in: [...insumoIds] }, validFrom: { lte: d1 } } }),
  ]);
  const insumos: Record<number, EngineInsumo> = {};
  for (const m of materials) {
    const vig = precioVigente(prices.filter((p) => p.materialId === m.id), d1);
    insumos[m.id] = {
      id: m.id,
      code: m.code,
      description: m.description,
      unit: m.unit,
      tipo: m.tipo,
      precio: vig ? moneyNumber(vig.price) : null,
      toleranciaPct: moneyNumber(m.toleranciaPct),
    };
  }

  // Libro mayor: todo lo que contabilidad registró como costo incurrido en el rango
  const movs = await db.budgetMovement.findMany({
    where: { projectId, stage: "ACTUAL", source: { not: "CLIENT_CERTIFICATE" }, fecha: { gte: d0, lte: d1 } },
    include: { budgetItem: { select: { path: true, isSystem: true } } },
  });
  const ledger: LedgerLine[] = movs.map((m) => ({
    budgetItemId: m.budgetItemId,
    bucket: bucketOf(m.budgetItem, m.source),
    amount: moneyNumber(m.amount),
    source: m.source,
    sourceNumber: m.sourceNumber,
    fecha: iso(m.fecha),
  }));

  // Vía C: horas valorizadas del parte diario (equipos) y de asistencia (personal propio)
  const horas: HoraKey[] = [];
  const partes = await db.parteEquipo.findMany({ where: { projectId, fecha: { gte: d0, lte: d1 } } });
  if (partes.length) {
    const eqPrices = await db.materialPrice.findMany({ where: { materialId: { in: [...new Set(partes.map((p) => p.insumoId))] }, validFrom: { lte: d1 } } });
    let sinPrecio = 0;
    for (const p of partes) {
      const vig = precioVigente(eqPrices.filter((x) => x.materialId === p.insumoId), p.fecha);
      if (!vig) sinPrecio++;
      horas.push({ budgetItemId: p.budgetItemId, peso: moneyNumber(p.horas) * (vig ? moneyNumber(vig.price) : 0), origen: "EQUIPO" });
    }
    if (sinPrecio) avisos.push(`${sinPrecio} parte(s) de equipo sin precio vigente del equipo: no pesan en el reparto`);
  }
  // Personal propio: horas por ítem del parte diario; sin parte ese día, la asistencia. Peso = horas × costo hora con cargas.
  const [horasParte, asistencias] = await Promise.all([
    db.parteHoraPersonal.findMany({ where: { projectId, fecha: { gte: d0, lte: d1 } } }),
    db.asistencia.findMany({ where: { projectId, fecha: { gte: d0, lte: d1 }, estado: { not: "AUSENTE" } } }),
  ]);
  const { map: costos } = await costoHoraEmpleados(db, projectId, [...horasParte.map((h) => h.empleadoId), ...asistencias.map((a) => a.empleadoId)]);
  const sinCosto = { base: 0, cargas: { ipsPatronal: 0, aguinaldo: 0, vacaciones: 0, otras: 0, total: 0 }, factor: 1, costoHora: 0, manual: false };
  const pesos = pesosPersonal(
    horasParte.map((h) => ({ empleadoId: h.empleadoId, fecha: iso(h.fecha), budgetItemId: h.budgetItemId, horas: moneyNumber(h.horas) })),
    asistencias.map((a) => ({
      empleadoId: a.empleadoId,
      fecha: iso(a.fecha),
      budgetItemId: a.budgetItemId,
      horas: moneyNumber(a.horasNormales) + moneyNumber(a.horasExtra),
      jornal: moneyNumber(a.jornal),
    })),
    (id) => costos.get(id) ?? sinCosto
  );
  for (const p of pesos) horas.push({ ...p, origen: "PERSONAL" });

  // Vía B: inventario de comunes entre los conteos que encierran el rango
  const inventario: InventarioInput[] = [];
  const comunes = Object.values(insumos).filter((i) => i.tipo === "COMUN");
  const factsCache = new Map<string, Map<number, ReturnType<typeof avanceRango>>>();
  const avanceVentana = async (desdeV: string, hastaV: string) => {
    const key = `${desdeV}:${hastaV}`;
    if (!factsCache.has(key)) {
      const facts = await loadFacts(db, projectId, hastaV);
      const byItem = new Map<number, ReturnType<typeof avanceRango>>();
      for (const i of items) byItem.set(i.id, avanceRango(facts.get(i.id) ?? [], desdeV, hastaV));
      factsCache.set(key, byItem);
    }
    return factsCache.get(key)!;
  };
  for (const ins of comunes) {
    const c1 = await db.conteoInventario.findFirst({
      where: { projectId, materialId: ins.id, fecha: { lte: toDay(dayBefore(desde)) } },
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
    });
    const c2 = await db.conteoInventario.findFirst({ where: { projectId, materialId: ins.id, fecha: { gte: d1 } }, orderBy: [{ fecha: "asc" }, { id: "desc" }] });
    if (!c2) continue;
    let inicio: { fecha: string; cantidad: number } | null = c1 ? { fecha: iso(c1.fecha), cantidad: moneyNumber(c1.cantidadContada) } : null;
    if (!inicio) {
      // Sin conteo previo: vale 0 solo si el insumo no tenía movimientos antes del rango.
      const antes = await db.stockMovement.count({ where: { projectId, materialId: ins.id, fecha: { lt: d0 } } });
      if (antes === 0) inicio = { fecha: dayBefore(desde), cantidad: 0 };
    }
    if (!inicio) continue;
    const fin = { fecha: iso(c2.fecha), cantidad: moneyNumber(c2.cantidadContada) };
    // Si hubo dos conteos el mismo día del cierre de ventana, vale el último cargado.
    const ultimoFin = await db.conteoInventario.findFirst({ where: { projectId, materialId: ins.id, fecha: c2.fecha }, orderBy: { id: "desc" } });
    if (ultimoFin) fin.cantidad = moneyNumber(ultimoFin.cantidadContada);
    const entradasAgg = await db.stockMovement.aggregate({
      where: {
        projectId,
        materialId: ins.id,
        fecha: { gt: toDay(inicio.fecha), lte: toDay(fin.fecha) },
        kind: { in: [...NO_CONSUMO] },
        NOT: { sourceType: COUNT_SOURCE },
      },
      _sum: { quantity: true },
    });
    const ventanaAvance = await avanceVentana(nextDay(inicio.fecha), fin.fecha);
    const ejecutadoVentana = new Map(items.map((i) => [i.id, ventanaAvance.get(i.id)?.[soloOficial ? "rangoOficial" : "rango"] ?? 0]));
    const teoricoV = teoricoPorInsumo(ejecutadoVentana, acu, (id) => id === ins.id).get(ins.id);
    inventario.push({
      insumoId: ins.id,
      ventana: { desde: inicio.fecha, hasta: fin.fecha },
      stockInicial: inicio.cantidad,
      entradas: moneyNumber(entradasAgg._sum.quantity),
      stockFinal: fin.cantidad,
      teoricoVentana: [...(teoricoV?.values() ?? [])].reduce((a, b) => a + b, 0),
    });
  }
  const sinConteo = comunes.length - inventario.length;
  if (sinConteo > 0) avisos.push(`${sinConteo} insumo(s) común(es) sin conteos que encierren el rango: su desvío no se calcula`);

  // Facturas recibidas sin OC ni certificado que todavía no se imputaron por renglón
  const facturas = await db.invoice.aggregate({
    where: {
      projectId,
      tipo: "RECIBIDA",
      purchaseOrderId: null,
      certificationId: null,
      certificacionId: null,
      fechaEmision: { gte: d0, lte: new Date(d1.getTime() + 86_399_999) },
      estado: { not: "ANULADA" },
      items: { some: { insumoId: null } },
    },
    _sum: { total: true },
    _count: true,
  });
  if (facturas._count) {
    avisos.push(
      `${facturas._count} factura(s) recibida(s) sin OC ni certificado por ${moneyNumber(facturas._sum.total).toLocaleString("es-PY")} Gs no están en el libro mayor: imputalas por renglón en Contabilidad › Facturas`
    );
  }

  const engine: EngineInput = { desde, hasta, items, acu, insumos, ledger, inventario, horas };
  return { engine, avisos };
}
