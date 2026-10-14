/**
 * Previsto vs Ejecutado (código puro). Presupuesto original congelado + adendas que cambian cantidades.
 *
 *  cantidad contractual = BudgetItem.contractQuantity (congelada; en un extra vale 0)
 *  cantidad real        = contractual + Σ deltas de adendas aprobadas (con fecha ≤ al)
 *  cantidad ejecutada   = medición acumulada de los certificados al cliente (hasta `al`)
 *
 * Los precios unitarios no cambian: monto = cantidad × PU. El monto contractual es el congelado
 * (`contractAmount`), así el redondeo del importador no se pierde.
 */

export interface PrevistoItem {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  unit: string | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  sortOrder: number;
  unitPrice: number;
  contractQuantity: number;
  contractAmount: number;
  isExtra: boolean;
  origenAdendaId: number | null;
}

export interface PrevistoAdenda {
  id: number;
  numero: number;
  titulo: string;
  fecha: string;
}

export interface PrevistoDelta {
  adendaId: number;
  budgetItemId: number;
  delta: number;
}

export interface PrevistoRow {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  unit: string | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  sortOrder: number;
  unitPrice: number | null;
  isExtra: boolean;
  /** N° de la adenda que creó el extra. */
  extraAdendaNumero: number | null;
  // Cantidades (solo ítems; los rubros mezclan unidades y quedan en null)
  contractQty: number | null;
  /** Δ de cada adenda aprobada, por id de adenda. */
  deltas: Record<number, number>;
  realQty: number | null;
  executedQty: number | null;
  saldoQty: number | null;
  /** Ejecutada ÷ real. */
  pct: number | null;
  /** Ejecutada por encima de la real. */
  exceeded: boolean;
  // Montos (los rubros se suman en el cliente)
  contractAmount: number;
  realAmount: number;
  executedAmount: number;
  saldoAmount: number;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Cantidad vigente de un ítem: contractual + Σ deltas. */
export const cantidadVigente = (contractQuantity: number, deltas: number[]) => r4(contractQuantity + deltas.reduce((a, b) => a + b, 0));

/** Monto vigente: monto contractual congelado + Σ deltas × PU (los precios no cambian). */
export const montoVigente = (contractAmount: number, unitPrice: number, deltas: number[]) => r2(contractAmount + deltas.reduce((a, b) => a + b, 0) * unitPrice);

/**
 * Filas del Previsto vs Ejecutado. `adendas` son solo las incluidas (aprobadas y con fecha ≤ al): un
 * extra cuya adenda no está incluida no aparece. `ejecutadas` = medición acumulada por ítem.
 */
export function buildPrevistoRows(items: PrevistoItem[], adendas: PrevistoAdenda[], deltas: PrevistoDelta[], ejecutadas: Map<number, number>): PrevistoRow[] {
  const numeroDe = new Map(adendas.map((a) => [a.id, a.numero]));
  const incluidas = new Set(adendas.map((a) => a.id));
  const porItem = new Map<number, PrevistoDelta[]>();
  for (const d of deltas) {
    if (!incluidas.has(d.adendaId)) continue;
    porItem.set(d.budgetItemId, [...(porItem.get(d.budgetItemId) ?? []), d]);
  }

  const rows: PrevistoRow[] = [];
  for (const it of items) {
    const extraAdendaNumero = it.isExtra && it.origenAdendaId !== null ? numeroDe.get(it.origenAdendaId) ?? null : null;
    if (it.isExtra && extraAdendaNumero === null) continue; // su adenda todavía no existe a la fecha (o fue anulada)

    if (it.nodeKind !== "ITEM") {
      rows.push({
        id: it.id, parentId: it.parentId, code: it.code, name: it.name, unit: null, nodeKind: it.nodeKind, sortOrder: it.sortOrder,
        unitPrice: null, isExtra: false, extraAdendaNumero: null,
        contractQty: null, deltas: {}, realQty: null, executedQty: null, saldoQty: null, pct: null, exceeded: false,
        contractAmount: 0, realAmount: 0, executedAmount: 0, saldoAmount: 0,
      });
      continue;
    }

    const ds = porItem.get(it.id) ?? [];
    const deltasPorAdenda: Record<number, number> = {};
    for (const d of ds) deltasPorAdenda[d.adendaId] = r4((deltasPorAdenda[d.adendaId] ?? 0) + d.delta);
    const valores = Object.values(deltasPorAdenda);
    const contractQty = r4(it.contractQuantity);
    const realQty = cantidadVigente(contractQty, valores);
    const executedQty = r4(ejecutadas.get(it.id) ?? 0);
    const contractAmount = r2(it.contractAmount);
    const realAmount = montoVigente(contractAmount, it.unitPrice, valores);
    const executedAmount = r2(executedQty * it.unitPrice);
    rows.push({
      id: it.id, parentId: it.parentId, code: it.code, name: it.name, unit: it.unit, nodeKind: "ITEM", sortOrder: it.sortOrder,
      unitPrice: it.unitPrice, isExtra: it.isExtra, extraAdendaNumero,
      contractQty, deltas: deltasPorAdenda, realQty, executedQty,
      saldoQty: r4(realQty - executedQty),
      pct: realQty > 0 ? executedQty / realQty : null,
      exceeded: executedQty > realQty + 0.0001,
      contractAmount, realAmount, executedAmount,
      saldoAmount: r2(realAmount - executedAmount),
    });
  }
  return rows;
}
