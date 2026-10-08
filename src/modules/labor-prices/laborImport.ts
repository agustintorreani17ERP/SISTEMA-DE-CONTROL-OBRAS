import { moneyNumber } from "../../lib/money";
import { type PriceLike, precioVigente, toDay } from "../../domain/prices";
import { MO_CODE_PREFIX, type MoParseResult } from "../insumos/moImport";

/**
 * Lista de precios de MO de la obra: catálogo (código, descripción, unidad, precio y sector).
 * No se asocia a rubros: el rubro del presupuesto se asigna en cada medición de subcontratista.
 */
export interface LaborImportRow {
  rowNumber: number;
  code: string;
  description: string;
  unit: string;
  unitPrice: number | null;
  sector: string | null;
  errors: string[];
  warnings: string[];
}

/** Filas leídas de la planilla → filas de la lista (código sin el prefijo del insumo). */
export function laborRowsFromParsed(parsed: MoParseResult): LaborImportRow[] {
  return parsed.rows.map((r) => {
    const errors = [...r.errors];
    if (r.price === 0) errors.push("Precio 0");
    return {
      rowNumber: r.rowNumber,
      code: r.sourceCode,
      description: r.description,
      unit: r.unit,
      unitPrice: r.price,
      sector: r.sector,
      errors,
      warnings: r.warnings.filter((w) => w !== "Precio 0"),
    };
  });
}

export const moInsumoCode = (code: string) => `${MO_CODE_PREFIX}${code.trim()}`;

export type InsumoPricePlan = "NUEVO_PRECIO" | "SIN_CAMBIO" | "CONFLICTO_FECHA";

/**
 * Qué hacer con el precio del insumo MO-<código> al guardar la lista: abrir vigencia desde
 * `validFrom` si difiere del vigente; si ya hay otro precio con esa misma fecha no se pisa
 * (los precios nunca se actualizan).
 */
export function planInsumoPrice(prices: PriceLike[], price: number, validFrom: Date | string): InsumoPricePlan {
  const vig = precioVigente(prices, validFrom);
  if (vig && moneyNumber(vig.price) === price) return "SIN_CAMBIO";
  const day = toDay(validFrom).getTime();
  if (prices.some((p) => toDay(p.validFrom).getTime() === day)) return "CONFLICTO_FECHA";
  return "NUEVO_PRECIO";
}
