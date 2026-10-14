import type { PrevistoRow } from "../types";

/**
 * Vista de la planilla Previsto vs Ejecutado (código puro). El servidor entrega las filas planas;
 * acá se arma el árbol rubro → subrubro → ítem, se suman los montos de los rubros desde sus ítems
 * y se aplican búsqueda, colapso y "solo con desvío". Los rubros no tienen cantidades (mezclan unidades).
 */

export interface PrevistoMontos {
  contractAmount: number;
  realAmount: number;
  executedAmount: number;
  saldoAmount: number;
}

export interface PrevistoVisible {
  row: PrevistoRow;
  depth: number;
  hasChildren: boolean;
  /** Montos del nodo: propios si es ítem, sumados de sus ítems si es rubro. */
  montos: PrevistoMontos;
}

export interface PrevistoFiltros {
  search?: string;
  soloConDesvio?: boolean;
  collapsed?: Set<number>;
}

const cero = (): PrevistoMontos => ({ contractAmount: 0, realAmount: 0, executedAmount: 0, saldoAmount: 0 });

/** Suma los montos de cada nodo desde sus ítems hoja (los rubros no traen montos propios). */
export function montosPorNodo(rows: PrevistoRow[]): Map<number, PrevistoMontos> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, PrevistoMontos>();
  for (const r of rows) {
    if (r.nodeKind !== "ITEM") continue;
    let cur: PrevistoRow | undefined = r;
    const visitados = new Set<number>();
    while (cur && !visitados.has(cur.id)) {
      visitados.add(cur.id);
      const m = out.get(cur.id) ?? cero();
      m.contractAmount += r.contractAmount;
      m.realAmount += r.realAmount;
      m.executedAmount += r.executedAmount;
      m.saldoAmount += r.saldoAmount;
      out.set(cur.id, m);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
  }
  return out;
}

/** Totales generales: solo ítems (sumar rubros duplicaría). */
export function totalesGenerales(rows: PrevistoRow[]): PrevistoMontos {
  return rows.reduce(
    (acc, r) =>
      r.nodeKind === "ITEM"
        ? {
            contractAmount: acc.contractAmount + r.contractAmount,
            realAmount: acc.realAmount + r.realAmount,
            executedAmount: acc.executedAmount + r.executedAmount,
            saldoAmount: acc.saldoAmount + r.saldoAmount,
          }
        : acc,
    cero()
  );
}

const esDesvio = (r: PrevistoRow) => r.nodeKind === "ITEM" && (r.exceeded || (r.saldoQty ?? 0) < 0);

/**
 * Árbol visible: ítems que coinciden con el filtro (y sus ancestros). Con filtros activos se ignora
 * el colapso, para que las coincidencias no queden escondidas.
 */
export function buildPrevistoView(rows: PrevistoRow[], f: PrevistoFiltros = {}): PrevistoVisible[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hijos = new Map<number, PrevistoRow[]>();
  const raices: PrevistoRow[] = [];
  for (const r of rows) {
    const padre = r.parentId !== null ? byId.get(r.parentId) : undefined;
    if (padre) hijos.set(padre.id, [...(hijos.get(padre.id) ?? []), r]);
    else raices.push(r);
  }
  const porOrden = (a: PrevistoRow, b: PrevistoRow) => a.sortOrder - b.sortOrder;
  const q = (f.search ?? "").trim().toLowerCase();
  const filtrando = Boolean(q) || Boolean(f.soloConDesvio);

  // Ítems que coinciden, y los ancestros que los contienen
  const visibles = new Set<number>();
  if (filtrando) {
    for (const r of rows) {
      if (r.nodeKind !== "ITEM") continue;
      const texto = `${r.code} ${r.name}`.toLowerCase();
      const coincide = (!q || texto.includes(q)) && (!f.soloConDesvio || esDesvio(r));
      if (!coincide) continue;
      let cur: PrevistoRow | undefined = r;
      while (cur && !visibles.has(cur.id)) {
        visibles.add(cur.id);
        cur = cur.parentId !== null ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  const montos = montosPorNodo(rows);
  const out: PrevistoVisible[] = [];
  const recorrer = (nodo: PrevistoRow, depth: number) => {
    if (filtrando && !visibles.has(nodo.id)) return;
    const kids = (hijos.get(nodo.id) ?? []).slice().sort(porOrden);
    out.push({ row: nodo, depth, hasChildren: kids.length > 0, montos: montos.get(nodo.id) ?? cero() });
    if (!filtrando && f.collapsed?.has(nodo.id)) return;
    for (const k of kids) recorrer(k, depth + 1);
  };
  raices.slice().sort(porOrden).forEach((r) => recorrer(r, 0));
  return out;
}
