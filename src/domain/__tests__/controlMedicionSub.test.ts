import { describe, expect, it } from "vitest";
import { DomainError } from "../../errors/domain";
import { controlMedicionSubcontratistas } from "../progress";

type Modo = "AVISAR" | "BLOQUEAR" | "NO_CONTROLAR";

/** Ítem 10: subcontratistas ya certificaron 40 m³ y la medición oficial acumulada es 50 m³. */
function fakeDb(modo: Modo) {
  return {
    project: { findUnique: async () => ({ controlMedicionSub: modo }) },
    budgetItem: {
      findMany: async () => [{ id: 10, code: "1.1", name: "Hormigón", unit: "m3", subcontractQuantity: 40 }],
    },
    avanceItem: {
      groupBy: async () => [{ budgetItemId: 10, _sum: { cantidad: 50 } }],
    },
  } as any;
}

const supera = [{ budgetItemId: 10, quantity: 15 }]; // 40 + 15 = 55 > 50
const dentro = [{ budgetItemId: 10, quantity: 10 }]; // 40 + 10 = 50

describe("controlMedicionSubcontratistas", () => {
  it("NO_CONTROLAR: no avisa aunque supere la medición oficial", async () => {
    expect(await controlMedicionSubcontratistas(fakeDb("NO_CONTROLAR"), 1, supera)).toEqual([]);
  });

  it("AVISAR: devuelve el aviso y no bloquea", async () => {
    const avisos = await controlMedicionSubcontratistas(fakeDb("AVISAR"), 1, supera);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("1.1 Hormigón");
    expect(await controlMedicionSubcontratistas(fakeDb("AVISAR"), 1, dentro)).toEqual([]);
  });

  it("BLOQUEAR: lanza 409 OVER_MEASURED con el detalle", async () => {
    const err = await controlMedicionSubcontratistas(fakeDb("BLOQUEAR"), 1, supera).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("OVER_MEASURED");
    expect(err.status).toBe(409);
    expect(err.details).toHaveLength(1);
    expect(err.message).toContain("1.1 Hormigón");
  });

  it("BLOQUEAR: no lanza si no supera, y en la verificación (soloAvisar) devuelve los avisos", async () => {
    expect(await controlMedicionSubcontratistas(fakeDb("BLOQUEAR"), 1, dentro)).toEqual([]);
    expect(await controlMedicionSubcontratistas(fakeDb("BLOQUEAR"), 1, supera, { soloAvisar: true })).toHaveLength(1);
  });
});
