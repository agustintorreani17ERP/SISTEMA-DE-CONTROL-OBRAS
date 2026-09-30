import { describe, expect, it, vi } from "vitest";
import { postAsiento } from "../contabilidad";

function fakeTx() {
  const asientos: any[] = [];
  let nextId = 1;
  return {
    asiento: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          asientos.find((a) => {
            if (where.anulaDeId === null && a.anulaDeId !== null) return false;
            if (where.sourceType !== undefined && a.sourceType !== where.sourceType) return false;
            if (where.sourceId !== undefined && a.sourceId !== where.sourceId) return false;
            if (where.anulaDeId !== undefined && where.anulaDeId !== null && a.anulaDeId !== where.anulaDeId)
              return false;
            return true;
          }) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const { lineas, ...rest } = data;
        const record = { id: nextId++, anulaDeId: null, ...rest, lineas: lineas?.create ?? [] };
        asientos.push(record);
        return record;
      }),
    },
  } as any;
}

describe("postAsiento", () => {
  it("crea un asiento balanceado", async () => {
    const tx = fakeTx();
    const asiento = await postAsiento(tx, {
      projectId: 1,
      concepto: "Pago a proveedor",
      sourceType: "TEST",
      sourceId: 1,
      lineas: [
        { cuentaId: 10, debe: 1000 },
        { cuentaId: 20, haber: 1000 },
      ],
    });
    expect(asiento.lineas).toHaveLength(2);
  });

  it("rechaza un asiento desbalanceado", async () => {
    const tx = fakeTx();
    await expect(
      postAsiento(tx, {
        projectId: 1,
        concepto: "Desbalanceado",
        sourceType: "TEST",
        sourceId: 2,
        lineas: [
          { cuentaId: 10, debe: 1000 },
          { cuentaId: 20, haber: 900 },
        ],
      })
    ).rejects.toThrow(/no balancea/);
  });

  it("rechaza un asiento con menos de dos líneas", async () => {
    const tx = fakeTx();
    await expect(
      postAsiento(tx, {
        projectId: 1,
        concepto: "Incompleto",
        sourceType: "TEST",
        sourceId: 3,
        lineas: [{ cuentaId: 10, debe: 1000 }],
      })
    ).rejects.toThrow(/al menos dos/);
  });

  it("es idempotente por sourceType + sourceId", async () => {
    const tx = fakeTx();
    const input = {
      projectId: 1,
      concepto: "Pago a proveedor",
      sourceType: "TEST",
      sourceId: 4,
      lineas: [
        { cuentaId: 10, debe: 500 },
        { cuentaId: 20, haber: 500 },
      ],
    };
    const first = await postAsiento(tx, input);
    const second = await postAsiento(tx, input);
    expect(second.id).toBe(first.id);
    expect(tx.asiento.create).toHaveBeenCalledTimes(1);
  });
});
