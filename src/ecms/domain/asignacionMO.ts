/**
 * Planilla de subcontratistas: líneas frente + rubro de la lista de MO + rubro presupuestario.
 * Puro (lo usa también el cliente): numeración, sugerencia de rubro, avance y acumulados por línea.
 */

// ── Texto ────────────────────────────────────────────────────────────────────

/** Normaliza descripciones de obra: H°A° / HºAº / HoAo → "hormigon armado", sin "Ejecución de". */
export function normalizeText(text: string) {
  return text
    .replace(/\bh\s*[°ºo]\s*a\s*[°ºo]?(?=[\s.,;:()\-]|$)/gi, " hormigon armado ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bejecucion\s+de(l)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string) {
  return new Set(normalizeText(text).split(" ").filter((t) => t.length > 2));
}

/**
 * Parecido entre dos descripciones (0..1): qué parte de las palabras de la más corta aparece en
 * la otra. Exige 2 palabras en común (salvo descripciones de una palabra).
 */
export function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const shortest = Math.min(ta.size, tb.size);
  if (common < Math.min(2, shortest)) return 0;
  return common / shortest;
}

/** m² = m2, m = ml, m³ = m3, u = un. */
export function normalizeUnit(unit: string | null | undefined) {
  const u = (unit ?? "")
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[\s.]/g, "");
  if (!u) return "";
  if (u === "m" || u === "ml" || u === "mts" || u === "mtl") return "ml";
  if (u === "m2" || u === "mts2") return "m2";
  if (u === "m3" || u === "mts3") return "m3";
  if (u === "u" || u === "un" || u === "und" || u === "unid" || u === "unidad") return "un";
  if (u === "gl" || u === "glb" || u === "global") return "gl";
  return u;
}

/** Sin unidad en alguno de los dos se considera compatible. */
export const unidadCompatible = (a: string | null | undefined, b: string | null | undefined) => {
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  return !na || !nb || na === nb;
};

// ── Numeración ───────────────────────────────────────────────────────────────

export const numeroLinea = (codigoFrente: string | null | undefined, correlativo: number) => `${codigoFrente || "?"}.${correlativo}`;

/** Siguiente correlativo de la planilla del contratista en el frente. */
export const siguienteCorrelativo = (existentes: number[]) => (existentes.length ? Math.max(...existentes) : 0) + 1;

// ── Árbol del presupuesto ────────────────────────────────────────────────────

export interface NodoPresupuesto {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
}

/**
 * Área (rubro raíz) y capítulo/planta de cada nodo: los nombres de los ancestros debajo del
 * Área. Hace falta porque dentro de un Área se repiten códigos (A2 tiene dos "3.3").
 */
export function contextoItems(nodos: NodoPresupuesto[]) {
  const byId = new Map(nodos.map((n) => [n.id, n]));
  const out = new Map<number, { areaId: number | null; capitulo: string }>();
  for (const n of nodos) {
    const chain: NodoPresupuesto[] = [];
    let p = n.parentId !== null ? byId.get(n.parentId) : undefined;
    let guard = 0;
    while (p && guard++ < 50) {
      chain.unshift(p);
      p = p.parentId !== null ? byId.get(p.parentId) : undefined;
    }
    const area = chain[0] ?? null;
    out.set(n.id, {
      areaId: area ? area.id : n.parentId === null ? n.id : null,
      capitulo: chain
        .slice(1)
        .map((c) => c.name)
        .join(" › "),
    });
  }
  return out;
}

// ── Sugerencia de rubro ──────────────────────────────────────────────────────

export interface FrenteRef {
  id: number;
  tipo: "AREA" | "AUXILIAR";
  /** Rubro raíz (Área) del frente; null en auxiliares. */
  budgetItemId: number | null;
}

export interface LaborPriceRef {
  id: number;
  description: string;
  unit: string | null;
}

export interface ItemRef {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  areaId: number | null;
  capitulo?: string;
}

export interface LineaHistorial {
  id: number;
  workFrontId: number;
  laborPriceId: number;
  budgetItemId: number | null;
}

export type MotivoSugerencia = "MEMORIA" | "SIMILAR" | "AREA" | "GASTOS_GENERALES";

export interface CandidatoRubro {
  budgetItemId: number;
  motivo: MotivoSugerencia;
  score: number;
}

export interface SugerenciaRubro {
  /** Rubro preseleccionado (null si solo hay ítems del área sin parecido). */
  sugerido: CandidatoRubro | null;
  /** Candidatos en orden: memoria, parecidos con unidad compatible, resto del área, GG. */
  candidatos: CandidatoRubro[];
}

/**
 * Rubro presupuestario sugerido para una línea, en este orden:
 * 1) la última línea del mismo frente + rubro MO (de cualquier contratista);
 * 2) ítems del área del frente con unidad compatible y nombre parecido;
 * 3) el resto de los ítems del área (no se preselecciona);
 * 4) frente auxiliar → Gastos generales.
 */
export function sugerirRubro(
  frente: FrenteRef,
  laborPrice: LaborPriceRef,
  items: ItemRef[],
  historial: LineaHistorial[],
  opts: { gastosGeneralesId?: number | null } = {}
): SugerenciaRubro {
  const candidatos: CandidatoRubro[] = [];
  const vistos = new Set<number>();
  const push = (c: CandidatoRubro) => {
    if (vistos.has(c.budgetItemId)) return;
    vistos.add(c.budgetItemId);
    candidatos.push(c);
  };

  const ultima = historial
    .filter((h) => h.workFrontId === frente.id && h.laborPriceId === laborPrice.id && h.budgetItemId !== null)
    .sort((a, b) => b.id - a.id)[0];
  if (ultima) push({ budgetItemId: ultima.budgetItemId as number, motivo: "MEMORIA", score: 1 });

  const delArea = frente.budgetItemId !== null ? items.filter((i) => i.areaId === frente.budgetItemId) : [];
  delArea
    .filter((i) => unidadCompatible(i.unit, laborPrice.unit))
    .map((i) => ({ i, score: similarity(laborPrice.description, i.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach((x) => push({ budgetItemId: x.i.id, motivo: "SIMILAR", score: x.score }));
  for (const i of delArea) push({ budgetItemId: i.id, motivo: "AREA", score: 0 });

  if (frente.tipo === "AUXILIAR" && opts.gastosGeneralesId) push({ budgetItemId: opts.gastosGeneralesId, motivo: "GASTOS_GENERALES", score: 0 });

  const sugerido = candidatos.find((c) => c.motivo !== "AREA") ?? null;
  return { sugerido, candidatos };
}


/** Acumulado aprobado por línea de planilla. */
export function acumuladoPorLinea(items: { planillaLineaId: number | null; cantidad: number }[]) {
  const map = new Map<number, number>();
  for (const i of items) if (i.planillaLineaId !== null) map.set(i.planillaLineaId, (map.get(i.planillaLineaId) ?? 0) + i.cantidad);
  return map;
}

/** N° de las líneas sin rubro presupuestario (impiden aprobar). */
export const lineasSinRubro = (items: { budgetItemId: number | null; numero: string | null }[]) =>
  items.filter((i) => i.budgetItemId === null).map((i) => i.numero ?? "sin línea");

export const mensajeLineasSinRubro = (numeros: string[]) =>
  `Asigná el rubro presupuestario de ${numeros.length === 1 ? "la línea" : `las ${numeros.length} líneas`} N° ${numeros.join(", ")} antes de aprobar.`;
