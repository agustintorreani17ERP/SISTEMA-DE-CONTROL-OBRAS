/**
 * Cálculos puros del libro de stock. Fechas como "AAAA-MM-DD" (comparables como texto).
 * Un conteo representa el saldo al cierre de su día: incluye todos los movimientos de esa fecha.
 */

export interface StockMov {
  fecha: string;
  quantity: number;
}

export interface StockCount {
  id: number;
  fecha: string;
  cantidad: number;
}

export interface CountAdjustment {
  countId: number;
  fecha: string;
  teorico: number;
  diferencia: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function stockAtDate(movs: StockMov[], fecha: string) {
  return round4(movs.reduce((acc, m) => (m.fecha <= fecha ? acc + m.quantity : acc), 0));
}

/**
 * Ajuste de cada conteo = contado − saldo teórico a su fecha, donde el teórico incluye los
 * ajustes de los conteos anteriores. `movs` no debe incluir los ajustes de estos conteos.
 */
export function deriveCountAdjustments(movs: StockMov[], counts: StockCount[]): CountAdjustment[] {
  const ordered = [...counts].sort((a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1));
  const out: CountAdjustment[] = [];
  const all = [...movs];
  for (const c of ordered) {
    const teorico = stockAtDate(all, c.fecha);
    const diferencia = round4(c.cantidad - teorico);
    out.push({ countId: c.id, fecha: c.fecha, teorico, diferencia });
    if (diferencia !== 0) all.push({ fecha: c.fecha, quantity: diferencia });
  }
  return out;
}

/** Primer día cuyo saldo al cierre queda negativo, o null. */
export function firstNegativeDay(movs: StockMov[]): { fecha: string; saldo: number } | null {
  const byDay = new Map<string, number>();
  for (const m of movs) byDay.set(m.fecha, (byDay.get(m.fecha) ?? 0) + m.quantity);
  let running = 0;
  for (const fecha of [...byDay.keys()].sort()) {
    running = round4(running + byDay.get(fecha)!);
    if (running < 0) return { fecha, saldo: running };
  }
  return null;
}
