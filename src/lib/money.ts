import { Decimal } from "@prisma/client/runtime/library";

export type MoneyLike = Decimal | number | string | Record<string, any> | null | undefined;

export function toDecimal(value?: unknown): Decimal {
  if (value === undefined || value === null || value === "") {
    return new Decimal(0);
  }
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === "number") {
    if (isNaN(value) || !isFinite(value)) return new Decimal(0);
    return new Decimal(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return new Decimal(0);
    try {
      return new Decimal(trimmed);
    } catch {
      return new Decimal(0);
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if ("increment" in obj) {
      return toDecimal(obj.increment);
    }
    if ("decrement" in obj) {
      return toDecimal(obj.decrement).negated();
    }
    if ("set" in obj) {
      return toDecimal(obj.set);
    }
    if (typeof obj.toNumber === "function") {
      try {
        return new Decimal(obj.toNumber());
      } catch {
        // continue
      }
    }
    if (typeof obj.toFixed === "function") {
      try {
        return new Decimal(obj.toFixed());
      } catch {
        // continue
      }
    }
    if (Array.isArray(obj.d) && typeof obj.e === "number" && typeof obj.s === "number") {
      try {
        const digits = obj.d.join("");
        const sign = obj.s < 0 ? "-" : "";
        return new Decimal(`${sign}0.${digits}e${obj.e + 1}`);
      } catch {
        // continue
      }
    }
    if (typeof obj.toString === "function" && obj.toString !== Object.prototype.toString) {
      try {
        return new Decimal(obj.toString());
      } catch {
        // continue
      }
    }
  }
  try {
    return new Decimal(String(value));
  } catch {
    return new Decimal(0);
  }
}

export function moneyNumber(value?: unknown): number {
  if (value === undefined || value === null) return 0;
  return toDecimal(value).toNumber();
}

export function assertPositive(value: unknown, field: string): Decimal {
  const n = toDecimal(value);
  if (n.lte(0)) {
    throw new Error(`${field} debe ser mayor a cero`);
  }
  return n;
}

