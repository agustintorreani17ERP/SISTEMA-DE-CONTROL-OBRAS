export function formatMoney(
  amount: number | string | undefined | null,
  currency: "PYG" | "USD" = "PYG"
): string {
  if (amount === undefined || amount === null) return currency === "PYG" ? "0 ₲" : "$ 0.00";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return currency === "PYG" ? "0 ₲" : "$ 0.00";

  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }

  return (
    new Intl.NumberFormat("es-PY", {
      style: "decimal",
      maximumFractionDigits: 0,
    }).format(Math.round(num)) + " ₲"
  );
}

export function formatCompactMoney(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null) return "0 ₲";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0 ₲";

  if (Math.abs(num) >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + " B ₲";
  }
  if (Math.abs(num) >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + " M ₲";
  }
  if (Math.abs(num) >= 1_000) {
    return (num / 1_000).toFixed(0) + " k ₲";
  }
  return formatMoney(num);
}

export function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

/**
 * Parsea un número en cualquier formato ingresado por el usuario:
 * - Enteros estándar: "1500000", 1500000
 * - Con separadores de miles y decimales latinos: "1.500.000,50", "1500,50"
 * - Con separadores de miles y decimales anglosajones: "1,500,000.50", "1500.50"
 * - Con símbolos de moneda o texto: "Gs. 1.500.000", "$ 250.50", "1 500 000"
 */
export function parseFlexibleNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  let raw = String(value).trim();
  if (!raw || /no\s*cotiza/i.test(raw)) return 0;

  // Limpiar espacios en blanco
  raw = raw.replace(/\s+/g, "");

  // Detectar signo negativo
  const isNegative = raw.startsWith("-") || /^\(.*\)$/.test(raw);

  // Remover símbolos de moneda y caracteres no numéricos excepto comas, puntos y menos
  raw = raw.replace(/[()₲$USDgsPYG]/gi, "").replace(/[^\d,.-]/g, "").trim();
  if (!raw || !/\d/.test(raw)) return 0;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    // Ambos separadores presentes
    if (comma > dot) {
      // 1.250.000,50 -> quitar puntos, cambiar coma por punto
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,250,000.50 -> quitar comas
      raw = raw.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    const parts = raw.split(",");
    if (parts.length > 2) {
      // Múltiples comas (1,250,000)
      raw = raw.replace(/,/g, "");
    } else {
      // Una sola coma (12,50 o 0,75)
      raw = raw.replace(",", ".");
    }
  } else if (dot >= 0) {
    const parts = raw.split(".");
    if (parts.length > 2) {
      // Múltiples puntos (1.500.000)
      raw = raw.replace(/\./g, "");
    } else if (parts.length === 2 && parts[1] === "000") {
      // Ejemplo "50.000" o "1.000" miles exactos
      raw = raw.replace(/\./g, "");
    }
  }

  const num = parseFloat(raw);
  if (isNaN(num)) return 0;
  return isNegative ? -Math.abs(num) : num;
}

export function formatQuantity(val: number | string | undefined | null, maxDecimals = 2): string {
  const num = typeof val === "number" ? val : parseFlexibleNumber(val);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-PY", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-PY", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
