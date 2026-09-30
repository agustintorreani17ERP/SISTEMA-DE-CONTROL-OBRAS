import type { Prisma, PrismaClient } from "@prisma/client";
import { moneyNumber } from "../lib/money";
import { precioVigente, toDay } from "./prices";
import { type MoComponente, type PrecioSugerido, sugerirPrecio } from "./laborPriceMath";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Precio sugerido de MO por ítem a una fecha: lista de MO de la obra (LaborPrice) o, si no hay,
 * la mano de obra del ACU con precios vigentes. El insumo de MO sale del catálogo (MO-<código>).
 */
export async function preciosSugeridosMO(db: Db, projectId: number, itemIds: number[], fecha: Date | string) {
  const ids = [...new Set(itemIds)];
  const out = new Map<number, PrecioSugerido | null>();
  if (!ids.length) return out;
  const day = toDay(fecha);
  const [lista, comps] = await Promise.all([
    db.laborPrice.findMany({ where: { projectId, budgetItemId: { in: ids } } }),
    db.componenteItem.findMany({
      where: { budgetItemId: { in: ids }, insumo: { categoria: "MANO_OBRA" } },
      include: { insumo: { include: { prices: { where: { validFrom: { lte: day } } } } } },
    }),
  ]);
  const codigos = lista.map((l) => `MO-${l.code}`);
  const moInsumos = codigos.length ? await db.material.findMany({ where: { code: { in: codigos } }, select: { id: true, code: true } }) : [];
  const insumoPorCodigo = new Map(moInsumos.map((m) => [m.code, m.id]));
  const listaPorItem = new Map(lista.map((l) => [l.budgetItemId as number, { precio: moneyNumber(l.unitPrice), insumoId: insumoPorCodigo.get(`MO-${l.code}`) ?? null }]));

  for (const id of ids) {
    const acu: MoComponente[] = comps
      .filter((c) => c.budgetItemId === id)
      .map((c) => {
        const vig = precioVigente(c.insumo.prices, day);
        return { insumoId: c.insumoId, consumo: moneyNumber(c.consumo), desperdicioPct: moneyNumber(c.desperdicioPct), precio: vig ? moneyNumber(vig.price) : null };
      });
    out.set(id, sugerirPrecio(listaPorItem.get(id) ?? null, acu));
  }
  return out;
}
