import { describe, expect, it } from "vitest";
import { fakeDb, rows } from "./fakeDb";
import { clientInvoicePreview, createClientInvoice, facturarCertificadoCliente } from "../clientBilling";
import { limitarAPendiente, pendienteDeFacturar } from "../clientBillingMath";
import { assertOpenPeriod, cierreDe, reopenLastClosing } from "../progress";
import { postMovement } from "../budget";
import { recordStockMovement } from "../stock";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * Obra con un ítem (Excavación, PU con IVA 11.000 Gs/m3) y un certificado al cliente N° 1 con
 * medición cerrada de 100 m3 al 30/09/2026 (ya registrada como medición oficial).
 */
function obra(extra: Record<string, any[]> = {}) {
  return fakeDb({
    project: [{ id: 1, name: "Obra Test", code: "OB-1", clientName: "Comitente SA", ivaPct: 10, coeficienteK: 1.3 }],
    budgetItem: [
      { id: 11, projectId: 1, code: "1.1", name: "Excavación", unit: "m3", nodeKind: "ITEM", isSystem: false, totalQuantity: 1000, unitPrice: 11_000, originalAmount: 10_000_000, costCommittedAmount: 0, certifiedQuantity: 0, certifiedAmount: 0, costActualAmount: 0 },
    ],
    certification: [{ id: 5, projectId: 1, partnerId: null, numero: 1, estado: "CERTIFICADO_BORRADOR", periodFrom: D("2026-09-01"), periodTo: D("2026-09-30"), fecha: D("2026-09-30"), retentionPct: 0 }],
    certificationItem: [{ id: 50, certificationId: 5, budgetItemId: 11, insumoId: null, cantidadPresente: 100, precioUnitario: 11_000, montoTotal: 1_100_000 }],
    avanceItem: [{ projectId: 1, budgetItemId: 11, fecha: D("2026-09-30"), cantidad: 100, origen: "MEDICION_OFICIAL", sourceType: "Certification", sourceId: 5 }],
    reglaAsientoContable: [
      { evento: "FACTURA_CLIENTE_EMITIDA", activo: true, cuentaDebeId: 10, cuentaHaberId: 20 },
      { evento: "IVA_DEBITO_FISCAL", activo: true, cuentaDebeId: 10, cuentaHaberId: 30 },
    ],
    ...extra,
  });
}

/** Cierre oficial de septiembre con la medición oficial congelada (acumulado 100 m3). */
const cierreSeptiembre = (acumulado = 100) => ({
  id: 7,
  projectId: 1,
  desde: D("2026-09-01"),
  hasta: D("2026-09-30"),
  createdBy: "Ana",
  notas: null,
  snapshot: {
    avance: { rows: [{ budgetItemId: 11, code: "1.1", name: "Excavación", unit: "m3", anteriorOficial: 0, ejecutadoOficial: acumulado, acumuladoOficial: acumulado, puConIva: 11_000 }] },
  },
});

describe("pendienteDeFacturar / limitarAPendiente (puro)", () => {
  it("pendiente = oficial acumulado − facturado", () => {
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

describe("aprobar el certificado al cliente factura (sin exigir cierre)", () => {
  it("aprobar sin cierre: no hay cierre del período y se emite la factura EMITIDA con IVA 10 % desglosado", async () => {
    const db = obra();
    expect(await cierreDe(db, 1, D("2026-09-30"))).toBeNull(); // → aviso "entrará en el próximo cierre"
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

  it("el asiento de ingreso del certificado al cliente no lo bloquea un período cerrado de costos", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    const { movement, desplazado } = await postMovement(db, {
      projectId: 1, budgetItemId: 11, amount: 1_100_000, quantity: 100, source: "CLIENT_CERTIFICATE", stage: "ACTUAL",
      sourceType: "Certification", sourceId: 5, fecha: D("2026-09-30"),
    });
    expect(desplazado).not.toBeNull();
    expect(movement.fecha).toEqual(D("2026-10-01"));
  });

  it("aprobar con cierre (sin facturar): factura el certificado y el cierre ya no tiene nada que facturar", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    expect(await cierreDe(db, 1, D("2026-09-30"))).not.toBeNull();
    const { invoice } = await facturarCertificadoCliente(db, 5);
    expect(invoice?.total).toBe(1_100_000);
    const preview = await clientInvoicePreview(db, 7);
    expect(preview.draft.lineas).toEqual([]);
    expect(preview.avisos.join(" ")).toMatch(/ya está facturado/);
    await expect(createClientInvoice(db, 7, {})).rejects.toMatchObject({ code: "NOTHING_TO_INVOICE" });
    expect(rows(db, "invoice")).toHaveLength(1);
  });

  it("cierre facturado antes (flujo anterior): aprobar el certificado no vuelve a facturar", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    const delCierre = await createClientInvoice(db, 7, {});
    expect(delCierre.total).toBe(1_100_000);
    const r = await facturarCertificadoCliente(db, 5);
    expect(r.invoice).toBeNull();
    expect(r.avisos.join(" ")).toMatch(/ya estaba facturado/);
    expect(rows(db, "invoice")).toHaveLength(1);
  });

  it("el cierre factura solo la diferencia no facturada", async () => {
    // Otra medición oficial de 20 m3 en el período (certificado N° 2 sin aprobar).
    const db = obra({
      cierrePeriodo: [cierreSeptiembre(120)],
    });
    await db.avanceItem.create({ data: { projectId: 1, budgetItemId: 11, fecha: D("2026-09-30"), cantidad: 20, origen: "MEDICION_OFICIAL", sourceType: "Certification", sourceId: 6 } });
    await facturarCertificadoCliente(db, 5);
    const inv = await createClientInvoice(db, 7, {});
    expect(inv.items.map((i: any) => i.quantity)).toEqual([20]);
    expect(inv.total).toBe(220_000);
  });

  it("aprobar dos veces no duplica la factura", async () => {
    const db = obra();
    const a = await facturarCertificadoCliente(db, 5);
    const b = await facturarCertificadoCliente(db, 5);
    expect(b.invoice?.id).toBe(a.invoice?.id);
    expect(rows(db, "invoice")).toHaveLength(1);
    expect(rows(db, "asiento")).toHaveLength(1);
  });
});

describe("reabrir el último cierre", () => {
  const dosCierres = () =>
    obra({
      cierrePeriodo: [{ ...cierreSeptiembre(), id: 6, desde: D("2026-08-01"), hasta: D("2026-08-31") }, cierreSeptiembre()],
    });

  it("guarda la copia con el snapshot y el motivo, borra el cierre y desvincula su factura", async () => {
    const db = dosCierres();
    const factura = await createClientInvoice(db, 7, {});
    const r = await reopenLastClosing(db, 7, { motivo: "Medición corregida por la fiscalización", usuario: "Admin" });
    expect(r.factura?.id).toBe(factura.id);
    expect(rows(db, "cierrePeriodo").map((c) => c.id)).toEqual([6]);
    expect(rows(db, "cierreReapertura")).toEqual([
      expect.objectContaining({ cierreIdOriginal: 7, motivo: "Medición corregida por la fiscalización", reabiertoPor: "Admin", facturaId: factura.id, snapshot: cierreSeptiembre().snapshot }),
    ]);
    expect(rows(db, "invoice")[0].cierreId).toBeNull();
    // Septiembre vuelve a estar abierto
    await expect(assertOpenPeriod(db, 1, D("2026-09-15"))).resolves.toBeUndefined();
  });

  it("no reabre un cierre anterior al último", async () => {
    const db = dosCierres();
    await expect(reopenLastClosing(db, 6, { motivo: "Quiero corregir agosto" })).rejects.toMatchObject({ code: "REOPEN_NOT_LAST" });
  });

  it("exige motivo", async () => {
    const db = dosCierres();
    await expect(reopenLastClosing(db, 7, { motivo: "  corto " })).rejects.toMatchObject({ code: "REOPEN_REASON" });
    expect(rows(db, "cierrePeriodo")).toHaveLength(2);
  });

  it("reabrir y volver a cerrar: el nuevo cierre factura solo la corrección", async () => {
    const db = dosCierres();
    await createClientInvoice(db, 7, {}); // 100 m3 facturados
    await reopenLastClosing(db, 7, { motivo: "Faltaban 5 m3 en la medición" });
    // Corrección (+5 m3) y nuevo cierre del mismo rango
    await db.cierrePeriodo.create({ data: { ...cierreSeptiembre(105), id: 8 } });
    const inv = await createClientInvoice(db, 8, {});
    expect(inv.items.map((i: any) => i.quantity)).toEqual([5]);
    expect(rows(db, "invoice")).toHaveLength(2);
  });
});

describe("documentos tardíos y hechos bloqueados", () => {
  it("un movimiento contable con fecha cerrada entra el primer día abierto y conserva la fecha real", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    const { movement, desplazado } = await postMovement(db, {
      projectId: 1, budgetItemId: 11, amount: 500_000, source: "PURCHASE_ORDER", stage: "ACTUAL",
      sourceType: "PurchaseOrder", sourceId: 3, fecha: D("2026-09-15"),
    });
    expect(movement.fecha).toEqual(D("2026-10-01"));
    expect(movement.fechaDocumento).toEqual(D("2026-09-15"));
    expect(desplazado).toEqual({ fechaDocumento: D("2026-09-15"), fechaContable: D("2026-10-01") });
  });

  it("en período abierto no se desplaza", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    const { movement, desplazado } = await postMovement(db, {
      projectId: 1, budgetItemId: 11, amount: 1, source: "PURCHASE_ORDER", stage: "COMMITTED", sourceType: "PurchaseOrder", sourceId: 3, fecha: D("2026-10-01"),
    });
    expect(desplazado).toBeNull();
    expect(movement.fechaDocumento).toBeNull();
  });

  it("una recepción tardía entra al stock el primer día abierto; una salida con fecha cerrada se rechaza con la acción sugerida", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()], material: [{ id: 3, name: "Cemento" }] });
    const recepcion = await recordStockMovement(db, {
      projectId: 1, materialId: 3, kind: "RECEIPT", quantity: 10, fecha: D("2026-09-20"), sourceType: "PurchaseOrder", sourceId: 3, tardio: true,
    });
    expect(recepcion.fecha).toEqual(D("2026-10-01"));
    expect(recepcion.fechaDocumento).toEqual(D("2026-09-20"));
    await expect(
      recordStockMovement(db, { projectId: 1, materialId: 3, kind: "CONSUMPTION", quantity: -1, fecha: D("2026-09-20"), sourceType: "Manual", sourceId: 1, budgetItemId: 11 })
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("partes diarios y mediciones siguen bloqueados en lo cerrado, con la acción sugerida", async () => {
    const db = obra({ cierrePeriodo: [cierreSeptiembre()] });
    const err = await assertOpenPeriod(db, 1, D("2026-09-10"), "El parte diario").catch((e) => e);
    expect(err.code).toBe("PERIOD_CLOSED");
    expect(err.message).toMatch(/Cargalo con fecha posterior al 30\/09\/2026 o pedí a un administrador que reabra el último cierre/);
  });
});
