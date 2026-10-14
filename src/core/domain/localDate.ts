/**
 * Fecha calendario local de la empresa (Paraguay). "Hoy" y las fechas de registro se toman en
 * America/Asuncion, no en UTC: a las 21:00 del 29/9 en Asunción ya es 30/9 en UTC.
 * Puro: lo usan el servidor y el cliente.
 */
export const TIME_ZONE = "America/Asuncion";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** AAAA-MM-DD de un instante, en hora de Asunción. */
export function localIso(date: Date = new Date()): string {
  return fmt.format(date);
}
