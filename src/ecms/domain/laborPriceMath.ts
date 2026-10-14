/**
 * Precio sugerido de mano de obra para certificar a un subcontratista (puro).
 * 1. Lista de precios de MO de la obra (lo pactado para ese ítem).
 * 2. Si no hay, la mano de obra del ACU del ítem: Σ consumo × (1 + desperdicio) × precio vigente
 *    de los insumos MANO_OBRA (catálogo importado de la lista de MO).
 */

export type PrecioFuente = "LISTA_OBRA" | "ACU_MO";

export interface MoComponente {
  insumoId: number;
  consumo: number;
  desperdicioPct: number;
  precio: number | null;
}

export interface PrecioSugerido {
  precio: number;
  fuente: PrecioFuente;
  insumoId: number | null;
  /** Renglones MO del ACU sin precio vigente (el sugerido queda corto). */
  sinPrecio: number;
}

/** Tolerancia para considerar que se usó el precio sugerido (%). */
export const TOLERANCIA_PRECIO_MO = 0.5;

export function precioMoDesdeAcu(comps: MoComponente[]): PrecioSugerido | null {
  if (!comps.length) return null;
  let total = 0;
  let sinPrecio = 0;
  let mayor: { insumoId: number; monto: number } | null = null;
  for (const c of comps) {
    if (c.precio === null) {
      sinPrecio++;
      continue;
    }
    const monto = c.consumo * (1 + c.desperdicioPct / 100) * c.precio;
    total += monto;
    if (!mayor || monto > mayor.monto) mayor = { insumoId: c.insumoId, monto };
  }
  if (!mayor) return null;
  return { precio: Math.round(total * 100) / 100, fuente: "ACU_MO", insumoId: mayor.insumoId, sinPrecio };
}

export function sugerirPrecio(listaObra: { precio: number; insumoId: number | null } | null, acu: MoComponente[]): PrecioSugerido | null {
  if (listaObra) return { precio: listaObra.precio, fuente: "LISTA_OBRA", insumoId: listaObra.insumoId ?? precioMoDesdeAcu(acu)?.insumoId ?? null, sinPrecio: 0 };
  return precioMoDesdeAcu(acu);
}

export interface LineaPrecio {
  code: string;
  name: string;
  precio: number;
  sugerido: number | null;
  fuente: PrecioFuente | null;
}

const gs = (n: number) => Math.round(n).toLocaleString("es-PY");

/** Avisos por precio distinto al sugerido o sin precio de referencia. */
export function alertasPrecio(lineas: LineaPrecio[], tolPct = TOLERANCIA_PRECIO_MO): string[] {
  const out: string[] = [];
  for (const l of lineas) {
    if (l.sugerido === null) {
      out.push(`${l.code} ${l.name}: sin precio de referencia (ni lista de MO de la obra ni MO en el ACU)`);
      continue;
    }
    if (l.sugerido === 0) {
      if (l.precio !== 0) out.push(`${l.code} ${l.name}: se certifica a ${gs(l.precio)} y la referencia es 0`);
      continue;
    }
    const desvio = l.precio / l.sugerido - 1;
    if (Math.abs(desvio) * 100 > tolPct) {
      const origen = l.fuente === "LISTA_OBRA" ? "lista de MO de la obra" : "MO del ACU";
      out.push(`${l.code} ${l.name}: precio ${gs(l.precio)} distinto del sugerido ${gs(l.sugerido)} (${origen}), ${desvio > 0 ? "+" : ""}${(desvio * 100).toFixed(1)} %`);
    }
  }
  return out;
}
