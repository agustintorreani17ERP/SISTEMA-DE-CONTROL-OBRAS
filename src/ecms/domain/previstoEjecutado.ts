import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { localIso } from "../../core/domain/localDate";
import { toDay } from "../../core/domain/prices";
import { loadMediciones } from "./medicion";
import { buildPrevistoRows, type PrevistoAdenda, type PrevistoDelta, type PrevistoItem, type PrevistoRow } from "./previstoEjecutadoMath";

type Db = PrismaClient | Prisma.TransactionClient;

export interface PrevistoEjecutadoData {
  projectId: number;
  /** Fecha de corte: adendas con fecha ≤ al y medición acumulada hasta al. */
  al: string;
  congelado: boolean;
  adendas: (PrevistoAdenda & { resolucion: string | null })[];
  rows: PrevistoRow[];
}

/**
 * Planilla general Previsto vs Ejecutado de la obra a la fecha `al`:
 * contractual (congelado) · adendas aprobadas · real · ejecutada (certificados al cliente).
 */
export async function previstoEjecutado(db: Db, projectId: number, al: string = localIso()): Promise<PrevistoEjecutadoData> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, presupuestoCongeladoAt: true } });
  if (!project) throw new NotFoundError("Obra", projectId);
  const congelado = Boolean(project.presupuestoCongeladoAt);

  const [nodes, adendasDb, mediciones] = await Promise.all([
    db.budgetItem.findMany({ where: { projectId, isSystem: false }, orderBy: { sortOrder: "asc" } }),
    db.adenda.findMany({ where: { projectId, estado: "APROBADA", fecha: { lte: toDay(al) } }, orderBy: { numero: "asc" } }),
    loadMediciones(db, projectId, al),
  ]);
  const lineas = adendasDb.length ? await db.adendaLinea.findMany({ where: { adendaId: { in: adendasDb.map((a) => a.id) } } }) : [];

  const items: PrevistoItem[] = nodes.map((n) => {
    const vigente = moneyNumber(n.totalQuantity);
    return {
      id: n.id,
      parentId: n.parentId,
      code: n.code,
      name: n.name,
      unit: n.unit,
      nodeKind: n.nodeKind,
      sortOrder: n.sortOrder,
      unitPrice: moneyNumber(n.unitPrice),
      // Obra sin congelar (o dato anterior al congelado): el presupuesto actual es el contrato.
      contractQuantity: congelado ? moneyNumber(n.contractQuantity) : vigente,
      contractAmount: congelado ? moneyNumber(n.contractAmount) : moneyNumber(n.originalAmount),
      isExtra: n.isExtra,
      origenAdendaId: n.origenAdendaId,
    };
  });
  const adendas = adendasDb.map((a) => ({
    id: a.id,
    numero: a.numero,
    titulo: a.titulo,
    fecha: a.fecha.toISOString().slice(0, 10),
    resolucion: a.resolucion,
  }));
  const deltas: PrevistoDelta[] = lineas
    .filter((l) => l.budgetItemId !== null)
    .map((l) => ({ adendaId: l.adendaId, budgetItemId: l.budgetItemId as number, delta: moneyNumber(l.deltaQuantity) }));
  const ejecutadas = new Map<number, number>();
  for (const [itemId, list] of mediciones) ejecutadas.set(itemId, list.reduce((acc, m) => acc + m.cantidad, 0));

  return { projectId, al, congelado, adendas, rows: buildPrevistoRows(items, adendas, deltas, ejecutadas) };
}
