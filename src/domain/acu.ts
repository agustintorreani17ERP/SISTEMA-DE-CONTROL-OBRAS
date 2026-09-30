import { Prisma, PrismaClient } from "@prisma/client";
import { moneyNumber } from "../lib/money";
import { AcuGrupo, AcuResult, computeAcu } from "./acuMath";
import { precioVigente, toDay } from "./prices";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AcuLinea {
  id: number;
  insumoId: number;
  codigo: string;
  insumo: string;
  unidad: string;
  tipo: string;
  grupo: AcuGrupo;
  consumo: number;
  desperdicioPct: number;
  precio: number | null;
  vigenteDesde: string | null;
  parcial: number;
  sortOrder: number;
  nota: string | null;
}

export interface ItemAcu {
  lineas: AcuLinea[];
  result: AcuResult;
}

interface ItemBase {
  id: number;
  unitPrice: Prisma.Decimal | number;
  totalQuantity: Prisma.Decimal | number;
}

/** Componentes de los ítems con el precio vigente a `fecha`, en una sola lectura. */
async function loadLineas(db: Db, budgetItemIds: number[], fecha: Date) {
  if (!budgetItemIds.length) return new Map<number, Omit<AcuLinea, "parcial">[]>();
  const comps = await db.componenteItem.findMany({
    where: { budgetItemId: { in: budgetItemIds } },
    include: { insumo: { select: { id: true, code: true, description: true, unit: true, tipo: true, categoria: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const insumoIds = [...new Set(comps.map((c) => c.insumoId))];
  const prices = insumoIds.length
    ? await db.materialPrice.findMany({ where: { materialId: { in: insumoIds }, validFrom: { lte: fecha } } })
    : [];
  const byInsumo = new Map<number, typeof prices>();
  for (const p of prices) byInsumo.set(p.materialId, [...(byInsumo.get(p.materialId) ?? []), p]);

  const out = new Map<number, Omit<AcuLinea, "parcial">[]>();
  for (const c of comps) {
    const vig = precioVigente(byInsumo.get(c.insumoId) ?? [], fecha);
    const list = out.get(c.budgetItemId) ?? [];
    list.push({
      id: c.id,
      insumoId: c.insumoId,
      codigo: c.insumo.code,
      insumo: c.insumo.description,
      unidad: c.insumo.unit,
      tipo: c.insumo.tipo,
      grupo: c.insumo.categoria,
      consumo: moneyNumber(c.consumo),
      desperdicioPct: moneyNumber(c.desperdicioPct),
      precio: vig ? moneyNumber(vig.price) : null,
      vigenteDesde: vig ? vig.validFrom.toISOString().slice(0, 10) : null,
      sortOrder: c.sortOrder,
      nota: c.nota,
    });
    out.set(c.budgetItemId, list);
  }
  return out;
}

/** ACU calculado de cada ítem (con o sin componentes) para la K e IVA de la obra. */
export async function computeItemsAcu(
  db: Db,
  items: ItemBase[],
  project: { coeficienteK: Prisma.Decimal | null; ivaPct: Prisma.Decimal | number },
  fecha: Date = new Date()
): Promise<Map<number, ItemAcu>> {
  const day = toDay(fecha);
  const lineas = await loadLineas(
    db,
    items.map((i) => i.id),
    day
  );
  const k = project.coeficienteK === null ? null : moneyNumber(project.coeficienteK);
  const iva = moneyNumber(project.ivaPct);
  const out = new Map<number, ItemAcu>();
  for (const item of items) {
    const ls = lineas.get(item.id) ?? [];
    const result = computeAcu({
      unitPrice: moneyNumber(item.unitPrice),
      quantity: moneyNumber(item.totalQuantity),
      coeficienteK: k,
      ivaPct: iva,
      lines: ls,
    });
    out.set(item.id, { lineas: ls.map((l, i) => ({ ...l, parcial: result.parciales[i] })), result });
  }
  return out;
}
