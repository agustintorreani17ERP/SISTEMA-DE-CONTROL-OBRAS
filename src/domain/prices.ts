import { Prisma } from "@prisma/client";
import { DomainError } from "../errors/domain";
import { toDecimal } from "../lib/money";
import { invalidateCostCache } from "./costCache";
import { localIso } from "./localDate";

type Tx = Prisma.TransactionClient;

export interface PriceLike {
  validFrom: Date;
  price: Prisma.Decimal | number | string;
}

/** Fecha calendario (sin hora) en UTC, igual que guarda Postgres una columna DATE. */
export function toDay(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) throw new DomainError("INVALID_DATE", `Fecha inválida: ${value}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Hoy en Paraguay (America/Asuncion) como fecha calendario, sin depender del huso del servidor. */
export function today(): Date {
  return toDay(localIso());
}

/** El precio de mayor vigencia que no sea posterior a `fecha`; null si todavía no había precio. */
export function precioVigente<T extends PriceLike>(prices: T[], fecha: Date | string): T | null {
  const day = toDay(fecha).getTime();
  let best: T | null = null;
  for (const p of prices) {
    const from = toDay(p.validFrom).getTime();
    if (from <= day && (!best || from > toDay(best.validFrom).getTime())) best = p;
  }
  return best;
}

export async function getPrecioVigente(tx: Tx, materialId: number, fecha: Date | string) {
  return tx.materialPrice.findFirst({
    where: { materialId, validFrom: { lte: toDay(fecha) } },
    orderBy: { validFrom: "desc" },
  });
}

/**
 * Agrega una vigencia nueva sin tocar las anteriores. Si la vigencia ya empezó, refresca la
 * caché `estimatedCost` que siguen leyendo compras y stock.
 */
export async function addPrice(
  tx: Tx,
  input: { materialId: number; price: number | string; validFrom: Date | string; source?: string; createdBy?: string }
) {
  const validFrom = toDay(input.validFrom);
  const price = toDecimal(input.price);
  if (price.isNegative()) throw new DomainError("INVALID_PRICE", "El precio no puede ser negativo");

  const clash = await tx.materialPrice.findUnique({
    where: { materialId_validFrom: { materialId: input.materialId, validFrom } },
  });
  if (clash) {
    throw new DomainError(
      "PRICE_DATE_TAKEN",
      `Ya hay un precio vigente desde ${validFrom.toISOString().slice(0, 10)}. Elegí otra fecha.`,
      409
    );
  }

  invalidateCostCache();
  const created = await tx.materialPrice.create({
    data: { materialId: input.materialId, price, validFrom, source: input.source, createdBy: input.createdBy },
  });

  const current = await getPrecioVigente(tx, input.materialId, today());
  if (current) {
    await tx.material.update({ where: { id: input.materialId }, data: { estimatedCost: current.price } });
  }
  return created;
}

/** Para las rutas que solo conocen un costo estimado: si difiere del vigente hoy, abre vigencia hoy. */
export async function recordEstimate(tx: Tx, materialId: number, price: number | string, source: string) {
  const current = await getPrecioVigente(tx, materialId, today());
  if (current && current.price.equals(toDecimal(price))) return null;
  return addPrice(tx, { materialId, price, validFrom: today(), source });
}
