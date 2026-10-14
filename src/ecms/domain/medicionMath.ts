/**
 * Medición oficial por ítem (código puro). Fechas "AAAA-MM-DD".
 * La única cantidad oficial es la medición del certificado al cliente: cada certificado aporta la
 * cantidad presente de cada ítem en la fecha de fin de su período.
 */

export interface Medicion {
  fecha: string;
  cantidad: number;
}

export interface MedidoRango {
  /** Medido hasta el día anterior a `desde`. */
  anterior: number;
  /** Medido en [desde, hasta]. */
  ejecutado: number;
  /** Medido hasta `hasta`. */
  acumulado: number;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function medidoAl(mediciones: Medicion[], fecha: string) {
  return r4(mediciones.reduce((acc, m) => (m.fecha <= fecha ? acc + m.cantidad : acc), 0));
}

export function medidoRango(mediciones: Medicion[], desde: string, hasta: string): MedidoRango {
  const anterior = medidoAl(mediciones, dayBefore(desde));
  const acumulado = medidoAl(mediciones, hasta);
  return { anterior, ejecutado: r4(acumulado - anterior), acumulado };
}
