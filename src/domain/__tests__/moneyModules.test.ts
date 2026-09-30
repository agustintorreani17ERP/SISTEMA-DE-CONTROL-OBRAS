import { describe, expect, it } from "vitest";
import { alertasPrecio, precioMoDesdeAcu, sugerirPrecio } from "../laborPriceMath";
import { buildClientInvoice } from "../clientBillingMath";
import { reconcile } from "../reconciliationMath";

describe("precio sugerido de MO para subcontratistas", () => {
  const acu = [
    { insumoId: 1, consumo: 1, desperdicioPct: 0, precio: 8000 }, // MO-1.1
    { insumoId: 2, consumo: 0.5, desperdicioPct: 10, precio: 3675 }, // MO-2.2
  ];

  it("sin lista de la obra usa la MO del ACU: Σ consumo × (1 + desperdicio) × precio", () => {
    // 8.000 + 0,5 × 1,10 × 3.675 = 10.021,25
    expect(precioMoDesdeAcu(acu)).toEqual({ precio: 10_021.25, fuente: "ACU_MO", insumoId: 1, sinPrecio: 0 });
  });

  it("la lista de MO de la obra manda sobre el ACU", () => {
    expect(sugerirPrecio({ precio: 9000, insumoId: null }, acu)).toEqual({ precio: 9000, fuente: "LISTA_OBRA", insumoId: 1, sinPrecio: 0 });
    expect(sugerirPrecio(null, [])).toBeNull();
  });

  it("alerta si el precio usado difiere del sugerido o no hay referencia", () => {
    const a = alertasPrecio([
      { code: "1.1", name: "Replanteo", precio: 8000, sugerido: 8000, fuente: "LISTA_OBRA" },
      { code: "1.2", name: "Excavación", precio: 8030, sugerido: 8000, fuente: "LISTA_OBRA" }, // +0,375 %: dentro de tolerancia
      { code: "1.3", name: "Cimiento", precio: 9000, sugerido: 8000, fuente: "ACU_MO" },
      { code: "1.4", name: "Losa", precio: 5000, sugerido: null, fuente: null },
    ]);
    expect(a).toHaveLength(2);
    expect(a[0]).toContain("1.3 Cimiento");
    expect(a[0]).toContain("+12.5 %");
    expect(a[1]).toContain("sin precio de referencia");
  });
});

describe("factura al cliente desde la medición oficial cerrada", () => {
  it("cantidad oficial × PU con IVA, IVA desglosado con el % de la obra y fondo de reparo informado", () => {
    const f = buildClientInvoice(
      [
        { budgetItemId: 1, code: "1", name: "Excavación", unit: "m3", cantidad: 120, puConIva: 55_000 },
        { budgetItemId: 2, code: "2", name: "Hormigón", unit: "m3", cantidad: 0, puConIva: 1_200_000 },
        { budgetItemId: 3, code: "3", name: "Corrección", unit: "m2", cantidad: -2, puConIva: 10_000 },
      ],
      10,
      5
    );
    expect(f.lineas).toHaveLength(1);
    expect(f.total).toBe(6_600_000);
    expect(f.iva).toBe(600_000);
    expect(f.sinIva).toBe(6_000_000);
    expect(f.retencion).toBe(330_000);
    expect(f.netoACobrar).toBe(6_270_000);
    expect(f.negativos.map((n) => n.code)).toEqual(["3"]);
  });
});

describe("conciliación documentos ↔ libro mayor", () => {
  it("clasifica faltantes, diferencias, asientos sin documento y facturas que no coinciden", () => {
    const r = reconcile(
      [
        { sourceType: "PurchaseOrder", sourceId: 1, fuente: "OC", numero: "OC 1", fecha: "2026-09-05", esperado: 1_000_000, enRango: true },
        { sourceType: "PurchaseOrder", sourceId: 2, fuente: "OC", numero: "OC 2", fecha: "2026-09-06", esperado: 500_000, enRango: true },
        { sourceType: "PettyCashExpense", sourceId: 7, fuente: "CAJA_CHICA", numero: "CC 7", fecha: "2026-09-10", esperado: 80_000, enRango: true },
        { sourceType: "Certification", sourceId: 3, fuente: "SUBCONTRATO", numero: "Cert 3", fecha: "2026-08-30", esperado: 2_000_000, enRango: false },
      ],
      [
        { sourceType: "PurchaseOrder", sourceId: 1, sourceNumber: "OC 1", fuente: "OC", amount: 1_000_000, fecha: "2026-09-05" },
        { sourceType: "PettyCashExpense", sourceId: 7, sourceNumber: "CC 7", fuente: "CAJA_CHICA", amount: 75_000, fecha: "2026-09-10" },
        { sourceType: "Certification", sourceId: 3, sourceNumber: "Cert 3", fuente: "SUBCONTRATO", amount: 2_000_000, fecha: "2026-09-01" },
        { sourceType: "ManualAdjustment", sourceId: 9, sourceNumber: "AJ-9", fuente: "OTROS", amount: 40_000, fecha: "2026-09-15" },
      ],
      [{ invoiceId: 1, numero: "001-001-0000010", fecha: "2026-09-07", total: 1_100_000, sourceType: "PurchaseOrder", sourceId: 1, totalDocumento: 1_000_000 }],
      { facturaExigida: new Set(["PurchaseOrder#2"]) }
    );
    expect(r.partidas.map((p) => [p.tipo, p.numero])).toEqual([
      ["SIN_ASIENTO", "OC 2"],
      ["DIFERENCIA", "CC 7"],
      ["SIN_DOCUMENTO", "AJ-9"],
      ["FUERA_DE_RANGO", "Cert 3"],
      ["FACTURA_DIFIERE", "Fact. 001-001-0000010"],
      ["SIN_FACTURA", "OC 2"],
    ]);
    expect(r.totales).toEqual({ documentos: 1_580_000, libro: 3_115_000, diferencia: -1_535_000 });
    expect(r.porFuente.find((f) => f.fuente === "OC")).toEqual({ fuente: "OC", documentos: 1_500_000, libro: 1_000_000, diferencia: 500_000 });
  });

  it("asiento y reverso dentro del rango no generan partida", () => {
    const r = reconcile(
      [],
      [
        { sourceType: "PettyCashExpense", sourceId: 1, sourceNumber: "X", fuente: "CAJA_CHICA", amount: 50_000, fecha: "2026-09-01" },
        { sourceType: "PettyCashExpense", sourceId: 1, sourceNumber: "X", fuente: "CAJA_CHICA", amount: -50_000, fecha: "2026-09-02" },
      ],
      []
    );
    expect(r.partidas).toEqual([]);
  });
});
