import { cleanText } from "./matrixExtractor";

export interface NormalizedUnitResult {
  unit: string;
  isStandard: boolean;
  unitReview: boolean;
  unitSuggestion: string | null;
}

const CANONICAL_UNITS: Record<string, string> = {
  // Longitud
  m: "m",
  ml: "m",
  "m.l.": "m",
  mt: "m",
  mts: "m",
  metro: "m",
  metros: "m",
  "metro lineal": "m",
  km: "km",
  kms: "km",
  kilometro: "km",
  kilometros: "km",

  // Área
  m2: "m²",
  "m²": "m²",
  "m^2": "m²",
  mt2: "m²",
  mts2: "m²",
  "metro cuadrado": "m²",
  "metros cuadrados": "m²",
  ha: "ha",
  has: "ha",
  hectarea: "ha",
  hectareas: "ha",

  // Volumen
  m3: "m³",
  "m³": "m³",
  "m^3": "m³",
  mt3: "m³",
  mts3: "m³",
  "metro cubico": "m³",
  "metros cubicos": "m³",
  lt: "lt",
  lts: "lt",
  litro: "lt",
  litros: "lt",
  l: "lt",

  // Masa y Peso
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  ton: "ton",
  tn: "ton",
  tons: "ton",
  tns: "ton",
  tonelada: "ton",
  toneladas: "ton",
  g: "g",
  gr: "g",
  gramo: "g",
  gramos: "g",

  // Conteo / Unidades
  un: "un",
  "un.": "un",
  und: "un",
  "und.": "un",
  unid: "un",
  "unid.": "un",
  unidad: "un",
  unidades: "un",
  u: "un",
  ud: "un",
  pza: "un",
  pieza: "un",
  piezas: "un",
  boca: "boca",
  bocas: "boca",
  par: "par",
  pares: "par",
  juego: "juego",
  jgo: "juego",
  juegos: "juego",
  modulo: "modulo",
  punto: "punto",
  bulto: "bulto",

  // Global y Lotes
  gl: "gl",
  gbl: "gl",
  glb: "gl",
  global: "gl",
  lote: "gl",
  paq: "gl",
  paquete: "gl",

  // Tiempo y Servicios
  mes: "mes",
  meses: "mes",
  dia: "dia",
  dias: "dia",
  jor: "dia",
  jornal: "dia",
  jornales: "dia",
  hs: "hs",
  hora: "hs",
  horas: "hs",
  viaje: "viaje",
  viajes: "viaje",
};

/**
 * Calcula distancia de Levenshtein para encontrar la unidad estándar más parecida
 */
function levenshteinSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(s1.length, s2.length);
  return 1 - matrix[s1.length][s2.length] / maxLen;
}

export function normalizeUnit(raw: unknown): NormalizedUnitResult {
  const text = cleanText(raw).toLowerCase().replace(/\./g, "");
  if (!text) {
    return {
      unit: "un",
      isStandard: true,
      unitReview: false,
      unitSuggestion: null,
    };
  }

  // Comprobar coincidencia directa o con puntuación
  if (CANONICAL_UNITS[text]) {
    return {
      unit: CANONICAL_UNITS[text],
      isStandard: true,
      unitReview: false,
      unitSuggestion: null,
    };
  }

  // Buscar coincidencia difusa con catálogo estándar
  let bestCandidate: string | null = null;
  let highestSim = 0;

  for (const [alias, canonical] of Object.entries(CANONICAL_UNITS)) {
    const sim = levenshteinSimilarity(text, alias);
    if (sim > highestSim && sim >= 0.75) {
      highestSim = sim;
      bestCandidate = canonical;
    }
  }

  if (bestCandidate) {
    return {
      unit: bestCandidate,
      isStandard: true,
      unitReview: false,
      unitSuggestion: null,
    };
  }

  // Si no se pudo reconocer con alta confianza, marcar para revisión
  return {
    unit: cleanText(raw),
    isStandard: false,
    unitReview: true,
    unitSuggestion: "un",
  };
}
