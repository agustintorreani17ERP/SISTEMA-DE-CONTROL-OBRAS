/**
 * Formato único de números del sistema (convención paraguaya):
 * - Guaraníes sin decimales, punto de miles: 29.460.942.194
 * - Cantidades con coma decimal: 144,35
 * - Porcentajes: 62,4 %
 * Código puro: se puede usar en el cliente y en el servidor.
 */

const EMPTY = "—";
const cache = new Map<string, Intl.NumberFormat>();

function nf(min: number, max: number) {
  const key = `${min}-${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("es-PY", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

/** Convierte a número finito o null (acepta strings numéricos y Decimal serializado). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 29460942194 → "29.460.942.194" (con { symbol: true } → "Gs. 29.460.942.194"). */
export function formatGs(value: unknown, opts: { symbol?: boolean; empty?: string } = {}): string {
  const n = toNumber(value);
  if (n === null) return opts.empty ?? EMPTY;
  const text = nf(0, 0).format(Math.round(n) || 0);
  return opts.symbol ? `Gs. ${text}` : text;
}

/** 144.35 → "144,35" (siempre con `decimals` decimales). */
export function formatQty(value: unknown, decimals = 2, opts: { empty?: string } = {}): string {
  const n = toNumber(value);
  if (n === null) return opts.empty ?? EMPTY;
  return nf(decimals, decimals).format(n);
}

/** 0.624 → "62,4 %". Recibe una fracción (1 = 100 %). */
export function formatPct(ratio: unknown, decimals = 1, opts: { empty?: string } = {}): string {
  const n = toNumber(ratio);
  if (n === null) return opts.empty ?? EMPTY;
  return `${nf(decimals, decimals).format(n * 100)} %`;
}

/** Monto en la moneda de la obra: PYG → "29.460.942.194 ₲"; USD → "US$ 1.234,50". */
export function formatMoney(value: unknown, currency: "PYG" | "USD" = "PYG"): string {
  const n = toNumber(value) ?? 0;
  return currency === "USD" ? `US$ ${nf(2, 2).format(n)}` : `${formatGs(n)} ₲`;
}
