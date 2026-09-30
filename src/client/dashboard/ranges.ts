/** Rangos del tablero: esta semana, este mes, desde el inicio de obra o personalizado. */

export type Preset = "semana" | "mes" | "inicio" | "custom";
export type ComparePreset = "anterior" | "custom";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = utc(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** `desde` null = desde el inicio de obra (lo resuelve el servidor). */
export function rangeFor(preset: Exclude<Preset, "custom">, hoy: string): { desde: string | null; hasta: string } {
  if (preset === "inicio") return { desde: null, hasta: hoy };
  if (preset === "mes") return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  const dow = (utc(hoy).getUTCDay() + 6) % 7; // lunes = 0
  return { desde: addDays(hoy, -dow), hasta: hoy };
}

/** Período anterior de la misma duración (el mes anterior completo si el rango es un mes calendario). */
export function previousRange(desde: string, hasta: string): { desde: string; hasta: string } {
  if (desde.endsWith("-01")) {
    const d = utc(desde);
    const prevStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const prevEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    const lastOfMonth = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    // Mes en curso hasta hoy: se compara con los mismos días del mes anterior
    const dias = Number(hasta.slice(8, 10));
    const end = hasta === lastOfMonth ? prevEnd : new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), Math.min(dias, prevEnd.getUTCDate())));
    if (hasta.slice(0, 7) === desde.slice(0, 7)) return { desde: iso(prevStart), hasta: iso(end) };
  }
  const len = Math.round((utc(hasta).getTime() - utc(desde).getTime()) / 86_400_000);
  const h = addDays(desde, -1);
  return { desde: addDays(h, -len), hasta: h };
}
