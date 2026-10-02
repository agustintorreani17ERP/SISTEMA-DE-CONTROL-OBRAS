import { describe, expect, it, vi } from "vitest";
import { anularAsiento, EVENTO, postAsientoDesdeRegla, rebuildProjectAccounting } from "../contabilidad";

/**
 * Fake de Prisma más completo que el de contabilidad.test.ts: agrega reglaAsientoContable y los
 * modelos que recorre rebuildProjectAccounting. Mismo patrón (arrays en memoria + vi.fn), sin DB.
 */
function fakeTx(opts: { reglas?: Record<string, { cuentaDebeId: number; cuentaHaberId: number; activo?: boolean }>; invoicesRecibidas?: any[] } = {}) {
  const asientos: any[] = [];
  let nextId = 1;
  const reglas = opts.reglas ?? {};

  return {
    reglaAsientoContable: {
      findUnique: vi.fn(async ({ where }: any) => {
        const r = reglas[where.evento];
        if (!r) return null;
        return { evento: where.evento, activo: r.activo ?? true, cuentaDebeId: r.cuentaDebeId, cuentaHaberId: r.cuentaHaberId };
      }),
    },
    asiento: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          asientos.find((a) => {
            if (where.anulaDeId === null && a.anulaDeId !== null) return false;
            if (where.sourceType !== undefined && a.sourceType !== where.sourceType) return false;
            if (where.sourceId !== undefined && a.sourceId !== where.sourceId) return false;
            if (where.anulaDeId !== undefined && where.anulaDeId !== null && a.anulaDeId !== where.anulaDeId) return false;
            return true;
          }) ?? null
        );
      }),
      findUnique: vi.fn(async ({ where }: any) => asientos.find((a) => a.id === where.id) ?? null),
      count: vi.fn(
        async ({ where }: any) =>
          asientos.filter((a) => a.sourceType === where.sourceType && a.sourceId === where.sourceId && (where.anulaDeId === null ? a.anulaDeId === null : true)).length
      ),
      create: vi.fn(async ({ data }: any) => {
        const { lineas, ...rest } = data;
        const record = { id: nextId++, anulaDeId: null, ...rest, lineas: lineas?.create ?? [] };
        asientos.push(record);
        return record;
      }),
    },
    purchaseOrder: { findMany: vi.fn(async () => []) },
    invoice: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.tipo === "RECIBIDA") return opts.invoicesRecibidas ?? [];
        return [];
      }),
    },
    subcontractorCertificate: { findMany: vi.fn(async () => []) },
    liquidacionPersonal: { findMany: vi.fn(async () => []) },
    pettyCashExpense: { findMany: vi.fn(async () => []) },
    payment: { findMany: vi.fn(async () => []) },
  } as any;
}

describe("postAsientoDesdeRegla", () => {
  it("no contabiliza si el evento no tiene regla activa", async () => {
    const tx = fakeTx();
    const result = await postAsientoDesdeRegla(tx, {
      evento: EVENTO.OC_RECIBIDA,
      projectId: 1,
      concepto: "OC sin regla",
      sourceType: "PurchaseOrder",
      sourceId: 1,
      debe: [{ monto: 1000 }],
      haber: [{ monto: 1000 }],
    });
    expect(result).toBeNull();
    expect(tx.asiento.create).not.toHaveBeenCalled();
  });

  it("no contabiliza si la regla existe pero está inactiva", async () => {
    const tx = fakeTx({ reglas: { [EVENTO.OC_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20, activo: false } } });
    const result = await postAsientoDesdeRegla(tx, {
      evento: EVENTO.OC_RECIBIDA,
      projectId: 1,
      concepto: "OC con regla inactiva",
      sourceType: "PurchaseOrder",
      sourceId: 1,
      debe: [{ monto: 1000 }],
      haber: [{ monto: 1000 }],
    });
    expect(result).toBeNull();
  });

  it("arma las líneas debe/haber desde las cuentas de la regla", async () => {
    const tx = fakeTx({ reglas: { [EVENTO.OC_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20 } } });
    const asiento = await postAsientoDesdeRegla(tx, {
      evento: EVENTO.OC_RECIBIDA,
      projectId: 1,
      concepto: "OC con regla",
      sourceType: "PurchaseOrder",
      sourceId: 1,
      debe: [{ monto: 600, budgetItemId: 5 }, { monto: 400, budgetItemId: 6 }],
      haber: [{ monto: 1000, partnerId: 99 }],
    });
    expect(asiento).not.toBeNull();
    expect(asiento!.lineas).toHaveLength(3);
    const debeLineas = asiento!.lineas.filter((l: any) => l.cuentaId === 10);
    const haberLineas = asiento!.lineas.filter((l: any) => l.cuentaId === 20);
    expect(debeLineas).toHaveLength(2);
    expect(haberLineas).toHaveLength(1);
    expect(haberLineas[0].partnerId).toBe(99);
  });
});

describe("rebuildProjectAccounting", () => {
  const invoiceA = {
    id: 100,
    numeroFactura: "001-001-0000001",
    fechaEmision: new Date("2026-01-10"),
    partnerId: 7,
    items: [{ budgetItemId: 5, insumoId: null, subtotal: 1000 }],
  };

  it("postea el asiento de una factura recibida imputada que todavía no tiene asiento", async () => {
    const tx = fakeTx({
      reglas: { [EVENTO.FACTURA_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20 } },
      invoicesRecibidas: [invoiceA],
    });
    const result = await rebuildProjectAccounting(tx, 1);
    expect(result.postedDocuments).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(tx.asiento.create).toHaveBeenCalledTimes(1);
  });

  it("es idempotente: no duplica el asiento en una segunda corrida", async () => {
    const tx = fakeTx({
      reglas: { [EVENTO.FACTURA_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20 } },
      invoicesRecibidas: [invoiceA],
    });
    await rebuildProjectAccounting(tx, 1);
    const second = await rebuildProjectAccounting(tx, 1);
    expect(second.postedDocuments).toBe(0);
    expect(tx.asiento.create).toHaveBeenCalledTimes(1);
  });
});

describe("anularAsiento", () => {
  it("crea un contra-asiento con las líneas invertidas", async () => {
    const tx = fakeTx({ reglas: { [EVENTO.OC_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20 } } });
    const original = await postAsientoDesdeRegla(tx, {
      evento: EVENTO.OC_RECIBIDA,
      projectId: 1,
      concepto: "OC a anular",
      sourceType: "PurchaseOrder",
      sourceId: 1,
      debe: [{ monto: 1000 }],
      haber: [{ monto: 1000 }],
    });
    const anulacion = await anularAsiento(tx, { asientoId: original!.id });
    expect(anulacion.anulaDeId).toBe(original!.id);
    expect(anulacion.lineas).toHaveLength(2);
    const debeOriginal = original!.lineas.find((l: any) => Number(l.debe) > 0)!;
    const haberAnulacion = anulacion.lineas.find((l: any) => l.cuentaId === debeOriginal.cuentaId)!;
    expect(Number(haberAnulacion.haber)).toBe(Number(debeOriginal.debe));
  });

  it("es idempotente: anular dos veces el mismo asiento devuelve la misma anulación", async () => {
    const tx = fakeTx({ reglas: { [EVENTO.OC_RECIBIDA]: { cuentaDebeId: 10, cuentaHaberId: 20 } } });
    const original = await postAsientoDesdeRegla(tx, {
      evento: EVENTO.OC_RECIBIDA,
      projectId: 1,
      concepto: "OC a anular",
      sourceType: "PurchaseOrder",
      sourceId: 1,
      debe: [{ monto: 1000 }],
      haber: [{ monto: 1000 }],
    });
    const first = await anularAsiento(tx, { asientoId: original!.id });
    const second = await anularAsiento(tx, { asientoId: original!.id });
    expect(second.id).toBe(first.id);
    expect(tx.asiento.create).toHaveBeenCalledTimes(2); // original + 1 anulación (no una segunda)
  });

  it("rechaza anular un asiento que no existe", async () => {
    const tx = fakeTx();
    await expect(anularAsiento(tx, { asientoId: 999 })).rejects.toThrow(/no existe/);
  });
});
