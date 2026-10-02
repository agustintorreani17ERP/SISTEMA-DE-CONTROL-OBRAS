import { describe, expect, it } from "vitest";
import { agruparPorBucketAntiguedad, esIngreso, saldoPendiente } from "../ingresosEgresosMath";

describe("esIngreso", () => {
  it("una factura EMITIDA (al cliente) es un ingreso", () => {
    expect(esIngreso("EMITIDA")).toBe(true);
  });

  it("una factura RECIBIDA (de proveedor/subcontratista) es un egreso", () => {
    expect(esIngreso("RECIBIDA")).toBe(false);
  });
});

describe("saldoPendiente", () => {
  it("resta pagos y retención del total facturado", () => {
    expect(saldoPendiente({ total: 1_000_000, montoRetenido: 50_000, totalPagado: 200_000 })).toBe(750_000);
  });

  it("nunca es negativo aunque se haya pagado de más", () => {
    expect(saldoPendiente({ total: 1_000_000, montoRetenido: 0, totalPagado: 1_500_000 })).toBe(0);
  });

  it("sin pagos ni retención, el saldo es el total", () => {
    expect(saldoPendiente({ total: 500_000, montoRetenido: 0, totalPagado: 0 })).toBe(500_000);
  });
});

describe("agruparPorBucketAntiguedad", () => {
  const hoy = new Date("2026-06-30T00:00:00Z");
  const diasAtras = (n: number) => new Date(hoy.getTime() - n * 86_400_000);
  const diasAdelante = (n: number) => new Date(hoy.getTime() + n * 86_400_000);

  it("una factura que vence hoy o en el futuro está A_VENCER", () => {
    expect(agruparPorBucketAntiguedad(hoy, hoy).bucket).toBe("A_VENCER");
    expect(agruparPorBucketAntiguedad(diasAdelante(5), hoy).bucket).toBe("A_VENCER");
  });

  it("1 a 30 días de vencida cae en 0-30", () => {
    expect(agruparPorBucketAntiguedad(diasAtras(1), hoy).bucket).toBe("0-30");
    expect(agruparPorBucketAntiguedad(diasAtras(30), hoy).bucket).toBe("0-30");
  });

  it("el borde de 31 días pasa a 31-60", () => {
    expect(agruparPorBucketAntiguedad(diasAtras(31), hoy).bucket).toBe("31-60");
    expect(agruparPorBucketAntiguedad(diasAtras(60), hoy).bucket).toBe("31-60");
  });

  it("el borde de 61 días pasa a 61-90", () => {
    expect(agruparPorBucketAntiguedad(diasAtras(61), hoy).bucket).toBe("61-90");
    expect(agruparPorBucketAntiguedad(diasAtras(90), hoy).bucket).toBe("61-90");
  });

  it("más de 90 días cae en +90", () => {
    expect(agruparPorBucketAntiguedad(diasAtras(91), hoy).bucket).toBe("+90");
    expect(agruparPorBucketAntiguedad(diasAtras(400), hoy).bucket).toBe("+90");
  });

  it("diasVencido cuenta los días corridos desde el vencimiento", () => {
    expect(agruparPorBucketAntiguedad(diasAtras(45), hoy).diasVencido).toBe(45);
    expect(agruparPorBucketAntiguedad(diasAdelante(5), hoy).diasVencido).toBe(0);
  });
});
