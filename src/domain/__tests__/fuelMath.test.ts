import { describe, expect, it } from "vitest";
import { analizarCombustible } from "../fuelMath";

const eq = { id: 1, consumoLh: 12, toleranciaPct: 10 };

describe("control de combustible", () => {
  it("por horómetro: litros de la carga ÷ horas desde la carga anterior", () => {
    const r = analizarCombustible(
      [
        { id: 1, fecha: "2026-09-01", equipoId: 1, litros: 200, horometro: 1000 },
        { id: 2, fecha: "2026-09-05", equipoId: 1, litros: 480, horometro: 1040 },
        { id: 3, fecha: "2026-09-09", equipoId: 1, litros: 600, horometro: 1080 },
      ],
      [],
      [eq]
    );
    const byId = new Map(r.cargas.map((c) => [c.id, c]));
    expect(byId.get(1)!.estado).toBe("PRIMERA");
    expect(byId.get(2)).toMatchObject({ horasUsadas: 40, fuenteHoras: "HOROMETRO", consumoReal: 12, desvioPct: 0, estado: "OK" });
    // 600 / 40 = 15 L/h → +25 % sobre 12: fuera del 10 %
    expect(byId.get(3)).toMatchObject({ consumoReal: 15, desvioPct: 0.25, estado: "ALERTA" });
    expect(r.equipos[0]).toMatchObject({ litros: 1280, horas: 80, consumoReal: 13.5, estado: "ALERTA", alertas: 1 });
  });

  it("sin horómetro usa las horas del parte entre cargas", () => {
    const r = analizarCombustible(
      [
        { id: 1, fecha: "2026-09-01", equipoId: 1, litros: 100, horometro: null },
        { id: 2, fecha: "2026-09-03", equipoId: 1, litros: 150, horometro: null },
      ],
      [
        { equipoId: 1, fecha: "2026-09-01", horas: 8 }, // antes de la primera carga del intervalo: no cuenta
        { equipoId: 1, fecha: "2026-09-02", horas: 8 },
        { equipoId: 1, fecha: "2026-09-03", horas: 7 },
      ],
      [eq]
    );
    const c2 = r.cargas.find((c) => c.id === 2)!;
    expect(c2).toMatchObject({ horasParte: 15, horasUsadas: 15, fuenteHoras: "PARTE", consumoReal: 10 });
    expect(c2.estado).toBe("REVISAR"); // 10 vs 12 = −16,7 %
  });

  it("horómetro que retrocede y horas del parte que no cierran con el horómetro", () => {
    const r = analizarCombustible(
      [
        { id: 1, fecha: "2026-09-01", equipoId: 1, litros: 100, horometro: 500 },
        { id: 2, fecha: "2026-09-02", equipoId: 1, litros: 120, horometro: 510 },
        { id: 3, fecha: "2026-09-03", equipoId: 1, litros: 120, horometro: 505 },
      ],
      [{ equipoId: 1, fecha: "2026-09-02", horas: 6 }],
      [eq]
    );
    const byId = new Map(r.cargas.map((c) => [c.id, c]));
    expect(byId.get(2)!.alertaHoras).toBe(true); // 6 h de parte vs 10 h de horómetro
    expect(byId.get(3)!.estado).toBe("HOROMETRO_INVALIDO");
  });

  it("sin consumo teórico no alerta por desvío", () => {
    const r = analizarCombustible(
      [
        { id: 1, fecha: "2026-09-01", equipoId: 2, litros: 100, horometro: 0 },
        { id: 2, fecha: "2026-09-02", equipoId: 2, litros: 100, horometro: 10 },
      ],
      [],
      [{ id: 2, consumoLh: null, toleranciaPct: 0 }]
    );
    expect(r.cargas.find((c) => c.id === 2)!.estado).toBe("SIN_TEORICO");
  });
});
