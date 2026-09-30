import type { InsumoTipo, Prisma } from "@prisma/client";
import { TraceabilityError, DomainError } from "../errors/domain";
import { toDecimal } from "../lib/money";
import { assertImputableItem } from "./budget";
import { DISTRIBUTION_ROOT_PATH, distributionPoolId } from "./generalExpenses";

type Tx = Prisma.TransactionClient;

/**
 * Regla de imputación de CLAUDE.md para una línea de pedido u OC:
 *  - DIRECTO: el documento trae el ítem → obligatorio.
 *  - COMUN: va al stock de la obra → no lleva ítem (el motor lo reparte por ACU).
 *  - TIEMPO: ítem opcional; si falta, se prorratea después.
 * `explicitItemId` es lo que eligió el usuario en este documento; `inheritedItemId` lo que traía
 * el documento anterior (el pedido), que para COMUN se ignora.
 */
export async function resolveLineItem(
  tx: Tx,
  params: {
    projectId: number;
    material: { code: string; description: string; tipo: InsumoTipo };
    explicitItemId?: number | null;
    inheritedItemId?: number | null;
  }
): Promise<number | null> {
  const { material } = params;
  const label = `${material.code} ${material.description}`;
  if (material.tipo === "COMUN") {
    if (params.explicitItemId) {
      throw new DomainError(
        "COMMON_INSUMO_WITH_ITEM",
        `${label} es un insumo COMÚN: va al stock de la obra y no se imputa a un ítem`,
        422
      );
    }
    return null;
  }
  const itemId = params.explicitItemId ?? params.inheritedItemId ?? null;
  if (material.tipo === "DIRECTO" && !itemId) {
    throw new TraceabilityError(`${label} es un insumo DIRECTO: elegí el ítem al que va`);
  }
  if (itemId) {
    const item = await assertImputableItem(tx, params.projectId, itemId);
    if (item.path.startsWith(DISTRIBUTION_ROOT_PATH)) {
      throw new DomainError("POOL_NOT_SELECTABLE", `"${item.name}" lo carga el sistema: elegí un ítem del presupuesto`, 422);
    }
  }
  return itemId;
}

/** Partida del libro mayor para una línea: su ítem, o el pozo "a distribuir" de la obra. */
export async function ledgerItemFor(tx: Tx, projectId: number, line: { tipo: InsumoTipo; budgetItemId: number | null }) {
  if (line.budgetItemId) return line.budgetItemId;
  return distributionPoolId(tx, projectId, line.tipo === "TIEMPO" ? "TIEMPO" : "STOCK");
}

/**
 * Asientos por (partida del libro mayor, insumo): así cada movimiento queda con obra + ítem (o
 * pozo) + insumo. Los renglones del mismo insumo e ítem se suman.
 */
export async function ledgerLines(
  tx: Tx,
  projectId: number,
  lines: { tipo: InsumoTipo; budgetItemId: number | null; subtotal: Prisma.Decimal | number; materialId: number | null }[]
) {
  const out = new Map<string, { budgetItemId: number; insumoId: number | null; amount: Prisma.Decimal }>();
  for (const l of lines) {
    const budgetItemId = await ledgerItemFor(tx, projectId, l);
    const key = `${budgetItemId}|${l.materialId ?? ""}`;
    const prev = out.get(key);
    const amount = (prev?.amount ?? toDecimal(0)).plus(toDecimal(l.subtotal));
    out.set(key, { budgetItemId, insumoId: l.materialId, amount });
  }
  return [...out.values()];
}

/**
 * Regla de imputación para un gasto suelto (caja chica, factura sin OC): valida el ítem según el
 * tipo del insumo y devuelve la partida del libro mayor (ítem o pozo "a distribuir").
 */
export async function resolveExpenseLine(
  tx: Tx,
  projectId: number,
  insumo: { code: string; description: string; tipo: InsumoTipo },
  budgetItemId: number | null | undefined
) {
  const itemId = await resolveLineItem(tx, { projectId, material: insumo, explicitItemId: budgetItemId ?? null });
  return { itemId, ledgerItemId: await ledgerItemFor(tx, projectId, { tipo: insumo.tipo, budgetItemId: itemId }) };
}

/** Suma de subtotales por partida del libro mayor. */
export async function amountsByLedgerItem(
  tx: Tx,
  projectId: number,
  lines: { tipo: InsumoTipo; budgetItemId: number | null; subtotal: Prisma.Decimal }[]
) {
  const out = new Map<number, Prisma.Decimal>();
  for (const l of lines) {
    const id = await ledgerItemFor(tx, projectId, l);
    out.set(id, (out.get(id) ?? toDecimal(0)).plus(l.subtotal));
  }
  return out;
}
