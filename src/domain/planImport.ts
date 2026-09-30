/**
 * Lectura del cronograma pegado desde Excel: primera columna el código del ítem, encabezados con
 * el período (mes o fecha de fin) y en cada celda la cantidad planificada o un % del contrato.
 * Un mes se toma al último día del mes. Código puro.
 */

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** "2026-03", "03/2026", "mar-26", "Marzo 2026", "31/03/2026", "2026-03-31" → fecha de fin del período. */
export function parsePeriod(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t))) return `${year(m[3])}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(t))) return lastDay(Number(m[1]), Number(m[2]));
  if ((m = /^(\d{1,2})[/-](\d{4})$/.exec(t))) return lastDay(Number(m[2]), Number(m[1]));
  if ((m = /^([a-zá-ú]{3})[a-zá-ú]*\.?[\s/-]*(\d{2,4})$/.exec(t))) {
    const mes = MESES[m[1]];
    return mes ? lastDay(year(m[2]), mes) : null;
  }
  return null;
}

/** "1.234,5" / "1234.5" / "25%" → cantidad (con % sobre la cantidad del contrato). */
export function parsePlanValue(raw: string, contrato: number): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t || t === "-") return null;
  const pct = t.endsWith("%");
  let s = pct ? t.slice(0, -1) : t;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return pct ? Math.round(((contrato * n) / 100) * 10_000) / 10_000 : n;
}

export interface PlanItemRef {
  id: number;
  code: string;
  contrato: number;
}

export interface PlanPreviewRow {
  fila: number;
  codigo: string;
  budgetItemId: number | null;
  fecha: string;
  cantidad: number;
  error?: string;
}

export function parsePlanGrid(text: string, items: PlanItemRef[]) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { periodos: [] as string[], filas: [] as PlanPreviewRow[], errores: ["Pegá el encabezado con los períodos y al menos una fila"] };
  const sep = lines[0].includes("\t") ? "\t" : ";";
  const header = lines[0].split(sep);
  const cols: { idx: number; fecha: string }[] = [];
  const errores: string[] = [];
  header.forEach((h, idx) => {
    if (idx === 0 || !h.trim()) return;
    const fecha = parsePeriod(h);
    if (fecha) cols.push({ idx, fecha });
    else if (idx > 0) errores.push(`Encabezado "${h.trim()}" no es un período: se ignora esa columna`);
  });
  if (!cols.length) return { periodos: [], filas: [], errores: ["No encontré períodos en el encabezado (ej. mar-26, 03/2026, 31/03/2026)"] };

  const byCode = new Map(items.map((i) => [i.code.trim().toLowerCase(), i]));
  const filas: PlanPreviewRow[] = [];
  lines.slice(1).forEach((line, n) => {
    const cells = line.split(sep);
    const codigo = (cells[0] ?? "").trim();
    if (!codigo) return;
    const item = byCode.get(codigo.toLowerCase());
    for (const c of cols) {
      const raw = cells[c.idx] ?? "";
      const cantidad = parsePlanValue(raw, item?.contrato ?? 0);
      if (cantidad === null) continue;
      const row: PlanPreviewRow = { fila: n + 2, codigo, budgetItemId: item?.id ?? null, fecha: c.fecha, cantidad: Number.isNaN(cantidad) ? 0 : cantidad };
      if (!item) row.error = "Ítem inexistente en el presupuesto";
      else if (Number.isNaN(cantidad)) row.error = `Valor "${raw.trim()}" no es un número`;
      else if (cantidad < 0) row.error = "Cantidad negativa";
      filas.push(row);
    }
  });
  return { periodos: cols.map((c) => c.fecha), filas, errores };
}
