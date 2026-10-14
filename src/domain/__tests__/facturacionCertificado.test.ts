import { describe, expect, it } from "vitest";
import { fakeDb, rows } from "./fakeDb";
import { facturarCertificadoCliente } from "../../bridge/domain/clientBilling";
import { limitarAPendiente, pendienteDeFacturar } from "../../erp/domain/clientBillingMath";
import { postMovement } from "../../ecms/domain/budget";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * Obra con un ítem (Excavación, PU con IVA 11.000 Gs/m3) y un certificado al cliente N° 1 de
 * 100 m3 con período que termina el 30/09/2026 (medición cerrada).
 */
function obra(extra: Record<string, any[]> = {}) {
  return fakeDb({
    project: [{ id: 1, name: "Obra Test", code: "OB-1", clientName: "Comitente SA", ivaPct: 10, coeficienteK: 1.3 }],
    budgetItem: [
      { id: 11, projectId: 1, code: "1.1", name: "Excavación", unit: "m3", nodeKind: "ITEM", isSystem: false, totalQuantity: 1000, unitPrice: 11_000, originalAmount: 10_000_000, costCommittedAmount: 0, certifiedQuantity: 0, certifiedAmount: 0, costActualAmount: 0 },
    ],
    certification: [{ id: 5, projectId: 1, partnerId: null, numero: 1, estado: "CERTIFICADO_BORRADOR", periodFrom: D("2026-09-01"), periodTo: D("2026-09-30"), fecha: D("2026-09-30"), retentionPct: 0 }],
    certificationItem: [{ id: 50, certificationId: 5, budgetItemId: 11, insumoId: null, cantidadPresente: 100, precioUnitario: 11_000, montoTotal: 1_100_000 }],
    reglaAsientoContable: [
      { evento: "FACTURA_CLIENTE_EMITIDA", activo: true, cuentaDebeId: 10, cuentaHaberId: 20 },
      { evento: "IVA_DEBITO_FISCAL", activo: true, cuentaDebeId: 10, cuentaHaberId: 30 },
    ],
    ...extra,
  });
}

describe("pendienteDeFacturar / limitarAPendiente (puro)", () => {
  it("pendiente = medición acumulada − facturado", () => {
    const p = pendienteDeFacturar(new Map([[1, 100], [2, 30]]), new Map([[1, 100], [2, 10]]));
    expect([...p]).toEqual([[2, 20]]);
  });
  it("recorta cada línea a lo pendiente de su ítem y deja pasar las negativas", () => {
    const r = limitarAPendiente(
      [
        { budgetItemId: 1, cantidad: 60 },
        { budgetItemId: 1, cantidad: 60 },
        { budgetItemId: 2, cantidad: -5 },
      ],
      new Map([[1, 100]])
    );
    expect(r.lineas.map((l) => l.cantidad)).toEqual([60, 40, -5]);
    expect(r.recortadas).toHaveLength(1);
  });
});

describe("aprobar el certificado al cliente factura", () => {
  it("emite la factura EMITIDA con IVA 10 % desglosado y su asiento", async () => {
    const db = obra();
    const { invoice, avisos } = await facturarCertificadoCliente(db, 5, { fechaEmision: D("2026-10-01") });
    expect(avisos).toEqual([]);
    expect(invoice).toMatchObject({ tipo: "EMITIDA", certificationId: 5, total: 1_100_000, montoIva10: 100_000, subtotal: 1_000_000 });
    expect(rows(db, "invoiceItem")).toEqual([expect.objectContaining({ budgetItemId: 11, quantity: 100, montoIva10: 100_000, subtotal: 1_000_000 })]);
    // Asiento: Clientes 1.100.000 / Ventas 1.000.000 + IVA débito fiscal 100.000
    const lineas = rows(db, "lineaAsiento").map((l) => [l.cuentaId, Number(l.debe), Number(l.haber)]);
    expect(lineas).toEqual([
      [10, 1_100_000, 0],
      [20, 0, 1_000_000],
      [30, 0, 100_000],
    ]);
  });

  it("aprobar dos veces no duplica la factura ni el asiento", async () => {
    const db = obra();
    const a = await facturarCertificadoCliente(db, 5);
    const b = await facturarCertificadoCliente(db, 5);
    expect(b.invoice?.id).toBe(a.invoice?.id);
    expect(rows(db, "invoice")).toHaveLength(1);
    expect(rows(db, "asiento")).toHaveLength(1);
  });

  it("un certificado posterior factura solo lo que todavía no se facturó del ítem", async () => {
    // Certificado N° 2: otros 20 m3 medidos hasta el 31/10/2026 (acumulado 120 m3).
    const db = obra({
      certification: [
        { id: 5, projectId: 1, partnerId: null, numero: 1, estado: "CERTIFICADO_BORRADOR", periodFrom: D("2026-09-01"), periodTo: D("2026-09-30"), fecha: D("2026-09-30"), retentionPct: 0 },
        { id: 6, projectId: 1, partnerId: null, numero: 2, estado: "CERTIFICADO_BORRADOR", periodFrom: D("2026-10-01"), periodTo: D("2026-10-31"), fecha: D("2026-10-31"), retentionPct: 0 },
      ],
      certificationItem: [
        { id: 50, certificationId: 5, budgetItemId: 11, insumoId: null, cantidadPresente: 100, precioUnitario: 11_000, montoTotal: 1_100_000 },
        { id: 60, certificationId: 6, budgetItemId: 11, insumoId: null, cantidadPresente: 20, precioUnitario: 11_000, montoTotal: 220_000 },
      ],
    });
    await facturarCertificadoCliente(db, 5);
    const { invoice } = await facturarCertificadoCliente(db, 6);
    expect(rows(db, "invoiceItem").filter((i) => i.invoiceId === invoice?.id).map((i) => i.quantity)).toEqual([20]);
    expect(invoice?.total).toBe(220_000);
  });
});

describe("costos con fecha real", () => {
  it("un movimiento con fecha pasada queda con esa fecha, sin desplazar ni marcar documento", async () => {
    const db = obra();
    const { movement, warnings } = await postMovement(db, {
      projectId: 1, budgetItemId: 11, amount: 500_000, source: "PURCHASE_ORDER", stage: "ACTUAL",
      sourceType: "PurchaseOrder", sourceId: 3, fecha: D("2026-09-15"),
    });
    expect(movement.fecha).toEqual(D("2026-09-15"));
    expect(warnings).toEqual([]);
  });
});
