import { describe, expect, it } from "vitest";
import { previousRange, rangeFor } from "../ranges";

describe("rangos del tablero", () => {
  it("esta semana arranca el lunes, este mes el día 1, desde inicio lo resuelve el servidor", () => {
    expect(rangeFor("semana", "2026-09-30")).toEqual({ desde: "2026-09-28", hasta: "2026-09-30" }); // miércoles
    expect(rangeFor("semana", "2026-09-28")).toEqual({ desde: "2026-09-28", hasta: "2026-09-28" }); // lunes
    expect(rangeFor("mes", "2026-09-28")).toEqual({ desde: "2026-09-01", hasta: "2026-09-28" });
    expect(rangeFor("inicio", "2026-09-28")).toEqual({ desde: null, hasta: "2026-09-28" });
  });

  it("período anterior: mismos días del mes anterior, mes completo o misma duración", () => {
    expect(previousRange("2026-09-01", "2026-09-28")).toEqual({ desde: "2026-08-01", hasta: "2026-08-28" });
    expect(previousRange("2026-09-01", "2026-09-30")).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(previousRange("2026-09-10", "2026-09-16")).toEqual({ desde: "2026-09-03", hasta: "2026-09-09" });
  });
});
