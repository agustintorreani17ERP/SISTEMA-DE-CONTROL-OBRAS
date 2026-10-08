/**
 * Agrupado por frente de la planilla del subcontratista (certificado y ficha del contratista).
 * Puro: recibe renglones ya calculados y los ordena por frente y N° de línea.
 */

export interface FrenteRef {
  id: number;
  name: string;
  codigo: string | null;
}

/** "Frente 2 — Bloque 6 - Aulas" */
export function frenteLabel(f: FrenteRef | null | undefined): string {
  if (!f) return "Sin frente";
  return f.codigo ? `Frente ${f.codigo} — ${f.name}` : f.name;
}

export interface Grupo<T> {
  key: string;
  label: string;
  rows: T[];
}

const cmp = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

/** Agrupa por frente (en orden de código) y ordena cada grupo por N° de línea. "Sin frente" va al final. */
export function agruparPorFrente<T>(rows: T[], frenteDe: (r: T) => FrenteRef | null | undefined, numeroDe: (r: T) => string): Grupo<T>[] {
  const grupos = new Map<string, Grupo<T> & { orden: string }>();
  for (const r of rows) {
    const f = frenteDe(r);
    const key = f ? String(f.id) : "none";
    if (!grupos.has(key)) grupos.set(key, { key, label: frenteLabel(f), rows: [], orden: f ? f.codigo ?? `~${f.name}` : "~~~" });
    grupos.get(key)!.rows.push(r);
  }
  return [...grupos.values()]
    .sort((a, b) => cmp(a.orden, b.orden))
    .map(({ orden: _o, ...g }) => ({ ...g, rows: [...g.rows].sort((a, b) => cmp(numeroDe(a), numeroDe(b))) }));
}
