import { describe, expect, it } from "vitest";
import { formatGs, formatMoney, formatPct, formatQty } from "../numbers";

describe("formato único de números", () => {
  it("guaraníes sin decimales con punto de miles", () => {
    expect(formatGs(29460942194)).toBe("29.460.942.194");
    expect(formatGs("1500000.6")).toBe("1.500.001");
    expect(formatGs(-250000)).toBe("-250.000");
    expect(formatGs(0)).toBe("0");
    expect(formatGs(1500, { symbol: true })).toBe("Gs. 1.500");
  });

  it("cantidades con 2 decimales y coma", () => {
    expect(formatQty(144.35)).toBe("144,35");
    expect(formatQty(1234.5)).toBe("1.234,50");
    expect(formatQty(10)).toBe("10,00");
    expect(formatQty(25.3649, 3)).toBe("25,365");
  });

  it("porcentajes desde una fracción", () => {
    expect(formatPct(0.624)).toBe("62,4 %");
    expect(formatPct(1.25, 0)).toBe("125 %");
  });

  it("valores vacíos o inválidos se muestran como guion", () => {
    expect(formatGs(null)).toBe("—");
    expect(formatQty(undefined)).toBe("—");
    expect(formatPct(NaN)).toBe("—");
    expect(formatGs("abc")).toBe("—");
  });

  it("monto según la moneda de la obra", () => {
    expect(formatMoney(29460942194)).toBe("29.460.942.194 ₲");
    expect(formatMoney(1234.5, "USD")).toBe("US$ 1.234,50");
  });
});
