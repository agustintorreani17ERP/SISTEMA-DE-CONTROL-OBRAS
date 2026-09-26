/**
 * Asocia cada fila de la lista de precios de mano de obra con un ítem del presupuesto:
 * primero por código, después por descripción (exacta o muy parecida).
 */
export interface BudgetLeaf {
  id: number;
  code: string;
  name: string;
  unit: string | null;
}

export interface LaborRowInput {
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
}

export interface LaborMatch extends LaborRowInput {
  budgetItemId: number | null;
  matchedBy: "code" | "description" | "similar" | null;
  budgetItemLabel: string | null;
}

export function normalizeText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const normalizeCode = (code: string) =>
  code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\.$/, "")
    .split(".")
    .map((s) => s.replace(/^0+(?=\d)/, ""))
    .join(".");

function tokens(text: string) {
  return new Set(normalizeText(text).split(" ").filter((t) => t.length > 2));
}

/**
 * Parecido entre dos descripciones (0..1): qué parte de las palabras de la más corta
 * aparece en la otra. Exige al menos 2 palabras en común (salvo descripciones de una palabra)
 * para no asociar rubros distintos que comparten un término genérico.
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

export function matchLaborRows(rows: LaborRowInput[], leaves: BudgetLeaf[]): LaborMatch[] {
  const byCode = new Map<string, BudgetLeaf[]>();
  const byDesc = new Map<string, BudgetLeaf>();
  for (const leaf of leaves) {
    const key = normalizeCode(leaf.code);
    byCode.set(key, [...(byCode.get(key) ?? []), leaf]);
    byDesc.set(normalizeText(leaf.name), leaf);
  }
  const label = (l: BudgetLeaf) => `${l.code} · ${l.name}`;

  return rows.map((row) => {
    const desc = normalizeText(row.description);
    // Código: solo si es único en el presupuesto (en planillas por áreas los códigos se repiten)
    const codeHits = row.code ? byCode.get(normalizeCode(row.code)) ?? [] : [];
    if (codeHits.length === 1) {
      return { ...row, budgetItemId: codeHits[0].id, matchedBy: "code", budgetItemLabel: label(codeHits[0]) };
    }
    const pool = codeHits.length > 1 ? codeHits : leaves;
    const exact = codeHits.length > 1 ? pool.find((l) => normalizeText(l.name) === desc) : byDesc.get(desc);
    if (exact) return { ...row, budgetItemId: exact.id, matchedBy: "description", budgetItemLabel: label(exact) };

    let best: BudgetLeaf | null = null;
    let bestScore = 0;
    for (const leaf of pool) {
      const score = similarity(row.description, leaf.name);
      if (score > bestScore) {
        bestScore = score;
        best = leaf;
      }
    }
    if (best && bestScore >= 0.6) {
      return { ...row, budgetItemId: best.id, matchedBy: "similar", budgetItemLabel: label(best) };
    }
    return { ...row, budgetItemId: null, matchedBy: null, budgetItemLabel: null };
  });
}
