import { describe, expect, it } from "vitest";
import { precioVigente } from "../prices";

const prices = [
  { validFrom: new Date("2026-06-01T00:00:00Z"), price: 120 },
  { validFrom: new Date("2026-01-01T00:00:00Z"), price: 100 },
];

describe("precioVigente", () => {
  it("usa el precio anterior hasta el día previo al cambio", () => {
    expect(precioVigente(prices, "2026-05-31")?.price).toBe(100);
  });

  it("usa el precio nuevo desde el día de vigencia", () => {
    expect(precioVigente(prices, "2026-06-01")?.price).toBe(120);
    expect(precioVigente(prices, "2027-01-01")?.price).toBe(120);
  });

  it("devuelve null antes del primer precio", () => {
    expect(precioVigente(prices, "2025-12-31")).toBeNull();
  });

  it("devuelve null sin precios", () => {
    expect(precioVigente([], "2026-01-01")).toBeNull();
  });
});
