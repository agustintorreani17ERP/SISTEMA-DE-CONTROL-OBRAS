import { ControlMedicionSub, Prisma, PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { moneyNumber } from "../../lib/money";
import { computeItemsAcu } from "./acu";
import { toDay } from "../../core/domain/prices";
import { Medicion, medidoRango } from "./medicionMath";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Medición oficial = medición del certificado al cliente (Certification sin partnerId) que dejó el
 * borrador. No hay avance por parte diario ni cronograma: lo medido sale solo de los certificados.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fecha de una medición: fin de su período, o la fecha de la medición si no lo tiene. */
export const measurementDate = (cert: { periodTo: Date | null; fecha: Date }) => cert.periodTo ?? cert.fecha;

/** Mediciones oficiales por ítem (budgetItemId → [{ fecha, cantidad }]), opcionalmente hasta una fecha. */
export async function loadMediciones(db: Db, projectId: number, hasta?: string): Promise<Map<number, Medicion[]>> {
  const certs = await db.certification.findMany({
    where: { projectId, partnerId: null, estado: { not: "MEDICION_BORRADOR" } },
    include: { items: { select: { budgetItemId: true, cantidadPresente: true } } },
  });
  const out = new Map<number, Medicion[]>();
  for (const c of certs) {
    const fecha = iso(measurementDate(c));
    if (hasta && fecha > hasta) continue;
    for (const i of c.items) {
      const cantidad = moneyNumber(i.cantidadPresente);
      if (i.budgetItemId === null || cantidad === 0) continue;
      const list = out.get(i.budgetItemId) ?? [];
      list.push({ fecha, cantidad });
      out.set(i.budgetItemId, list);
    }
  }
  return out;
}

/**
 * Control de subcontratistas: lo que certifican en total (libro mayor, todas las fuentes) más lo
 * que se está certificando no puede superar la medición oficial acumulada del ítem.
 */
export async function subcontractOverMeasured(db: Db, projectId: number, lines: { budgetItemId: number; quantity: number }[]) {
  const ids = [...new Set(lines.map((l) => l.budgetItemId))];
  if (!ids.length) return [] as string[];
  const [items, mediciones] = await Promise.all([
    db.budgetItem.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true, subcontractQuantity: true } }),
    loadMediciones(db, projectId),
  ]);
  const nuevo = new Map<number, number>();
  for (const l of lines) nuevo.set(l.budgetItemId, (nuevo.get(l.budgetItemId) ?? 0) + l.quantity);
  const out: string[] = [];
  for (const i of items) {
    const sub = moneyNumber(i.subcontractQuantity) + (nuevo.get(i.id) ?? 0);
    const med = (mediciones.get(i.id) ?? []).reduce((acc, m) => acc + m.cantidad, 0);
    if (sub > med + 0.0001) {
      out.push(
        `${i.code} ${i.name}: subcontratistas certifican ${sub.toLocaleString("es-PY")} ${i.unit ?? ""} y la medición oficial acumulada es ${med.toLocaleString("es-PY")}`
      );
    }
  }
  return out;
}

export async function modoControlMedicion(db: Db, projectId: number): Promise<ControlMedicionSub> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { controlMedicionSub: true } });
  if (!project) throw new NotFoundError("Obra", projectId);
  return project.controlMedicionSub;
}

/**
 * subcontractOverMeasured según la configuración de la obra (Project.controlMedicionSub):
 * NO_CONTROLAR → sin avisos; AVISAR → avisos; BLOQUEAR → DomainError 409 OVER_MEASURED con el detalle.
 * `soloAvisar` (verificación de pantalla) devuelve los avisos aunque la obra bloquee.
 */
export async function controlMedicionSubcontratistas(
  db: Db,
  projectId: number,
  lines: { budgetItemId: number; quantity: number }[],
  opts: { soloAvisar?: boolean } = {}
): Promise<string[]> {
  const modo = await modoControlMedicion(db, projectId);
  if (modo === "NO_CONTROLAR") return [];
  const avisos = await subcontractOverMeasured(db, projectId, lines);
  if (modo === "BLOQUEAR" && avisos.length && !opts.soloAvisar) {
    throw new DomainError(
      "OVER_MEASURED",
      `Los subcontratistas superan la medición oficial acumulada: ${avisos.join("; ")}`,
      409,
      avisos
    );
  }
  return avisos;
}

/** Progreso de un ítem en [desde, hasta], con el costo meta del ACU. Sin cronograma ni planificado. */
export interface ProgresoItem {
  budgetItemId: number;
  code: string;
  name: string;
  unit: string | null;
  contrato: number;
  puSinIva: number;
  costoMetaUnit: number | null;
  costoMetaFuente: "ACU" | "K" | null;
  anterior: number;
  ejecutado: number;
  acumulado: number;
  /** Valor ganado = ejecutado × costo meta. */
  vg: number | null;
  /** Certificable al cliente sin IVA = ejecutado × PU sin IVA. */
  ventaSinIva: number;
  pctAvance: number | null;
  excedeContrato: boolean;
}

export async function progresoItems(db: Db, projectId: number, desde: string, hasta: string): Promise<ProgresoItem[]> {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, coeficienteK: true, ivaPct: true } });
  const items = await db.budgetItem.findMany({
    where: { projectId, nodeKind: "ITEM", isSystem: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, name: true, unit: true, totalQuantity: true, unitPrice: true },
  });
  const [mediciones, acu] = await Promise.all([loadMediciones(db, projectId, hasta), computeItemsAcu(db, items, project, toDay(hasta))]);
  const iva = moneyNumber(project.ivaPct);
  return items.map((i) => {
    const m = medidoRango(mediciones.get(i.id) ?? [], desde, hasta);
    const r = acu.get(i.id)!.result;
    const puConIva = moneyNumber(i.unitPrice);
    const puSinIva = puConIva / (1 + iva / 100);
    const contrato = moneyNumber(i.totalQuantity);
    return {
      budgetItemId: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      contrato,
      puSinIva,
      costoMetaUnit: r.costoMetaUnit,
      costoMetaFuente: r.fuente,
      anterior: m.anterior,
      ejecutado: m.ejecutado,
      acumulado: m.acumulado,
      vg: r.costoMetaUnit === null ? null : m.ejecutado * r.costoMetaUnit,
      ventaSinIva: m.ejecutado * puSinIva,
      pctAvance: contrato > 0 ? m.acumulado / contrato : null,
      excedeContrato: contrato > 0 && m.acumulado > contrato + 0.0001,
    };
  });
}
