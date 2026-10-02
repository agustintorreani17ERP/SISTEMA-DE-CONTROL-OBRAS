import { describe, expect, it } from "vitest";
import { evaluateMatch, MATCH_TOLERANCE_GS } from "../threeWayMatch";

describe("evaluateMatch", () => {
  it("una factura EMITIDA (venta al cliente) nunca pasa por control de compras", () => {
    const result = evaluateMatch({ tipo: "EMITIDA", total: 1_000_000 });
    expect(result.kind).toBe("NO_APLICA");
    expect(result.passed).toBe(true);
  });

  it("EMITIDA es NO_APLICA incluso si por error trajera una OC", () => {
    const result = evaluateMatch({
      tipo: "EMITIDA",
      total: 1_000_000,
      purchaseOrder: { number: "OC-1", totalAmount: 1_000_000, stockRegistered: true },
    });
    expect(result.kind).toBe("NO_APLICA");
    expect(result.passed).toBe(true);
  });

  describe("con Orden de Compra (3 vías)", () => {
    const po = { number: "OC-100", totalAmount: 1_000_000, stockRegistered: true };

    it("aprueba cuando el monto coincide y hay recepción física", () => {
      const result = evaluateMatch({ tipo: "RECIBIDA", total: 1_000_000, purchaseOrder: po });
      expect(result.kind).toBe("ORDEN_COMPRA");
      expect(result.passed).toBe(true);
    });

    it("tolera una diferencia por debajo de MATCH_TOLERANCE_GS", () => {
      const result = evaluateMatch({ tipo: "RECIBIDA", total: 1_000_000 + MATCH_TOLERANCE_GS / 2, purchaseOrder: po });
      expect(result.passed).toBe(true);
    });

    it("rechaza por encima de la tolerancia", () => {
      const result = evaluateMatch({ tipo: "RECIBIDA", total: 1_000_000 + MATCH_TOLERANCE_GS + 0.01, purchaseOrder: po });
      expect(result.passed).toBe(false);
      expect(result.notes).toMatch(/Discrepancia de monto/);
    });

    it("rechaza si no hay recepción física ni remisión", () => {
      const result = evaluateMatch({
        tipo: "RECIBIDA",
        total: 1_000_000,
        purchaseOrder: { ...po, stockRegistered: false },
        remisionNumber: null,
      });
      expect(result.passed).toBe(false);
      expect(result.notes).toMatch(/recepción física/);
    });

    it("aprueba con remisión aunque el pañol no haya marcado stockRegistered", () => {
      const result = evaluateMatch({
        tipo: "RECIBIDA",
        total: 1_000_000,
        purchaseOrder: { ...po, stockRegistered: false },
        remisionNumber: "REM-001",
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("con certificado de subcontratista (2 vías)", () => {
    it("aprueba cuando el certificado está aprobado y el monto coincide", () => {
      const result = evaluateMatch({
        tipo: "RECIBIDA",
        total: 500_000,
        certificado: { ref: "#1", estado: "APROBADA", estadosAprobados: ["APROBADA", "PAGADA"], monto: 500_000 },
      });
      expect(result.kind).toBe("CERTIFICADO");
      expect(result.passed).toBe(true);
      // No debe exigir recepción física: es un servicio, no una compra de materiales.
      expect(result.notes).toMatch(/sin recepción física/);
    });

    it("rechaza si el certificado todavía no fue aprobado", () => {
      const result = evaluateMatch({
        tipo: "RECIBIDA",
        total: 500_000,
        certificado: { ref: "#1", estado: "EN_REVISION", estadosAprobados: ["APROBADA", "PAGADA"], monto: 500_000 },
      });
      expect(result.passed).toBe(false);
      expect(result.notes).toMatch(/aún no está aprobado/);
    });

    it("rechaza si el monto facturado difiere del certificado", () => {
      const result = evaluateMatch({
        tipo: "RECIBIDA",
        total: 600_000,
        certificado: { ref: "#1", estado: "APROBADA", estadosAprobados: ["APROBADA", "PAGADA"], monto: 500_000 },
      });
      expect(result.passed).toBe(false);
      expect(result.notes).toMatch(/Discrepancia en medición/);
    });
  });

  it("sin OC ni certificado: requiere aprobación manual, nunca pasa automáticamente", () => {
    const result = evaluateMatch({ tipo: "RECIBIDA", total: 123_000 });
    expect(result.kind).toBe("SIN_DOCUMENTO");
    expect(result.passed).toBe(false);
    expect(result.notes).toMatch(/aprobación manual/);
  });
});
