import { describe, expect, it } from "vitest";
import { createClientInvoice } from "../clientBilling";
import { EVENTO } from "../contabilidad";
import { fakeDb, rows } from "./fakeDb";

/**
 * createClientInvoice sobre un Prisma en memoria: el cierre (con su snapshot), el proyecto, las
 * certificaciones del período (fondo de reparo), la factura, el asiento y la retención.
 */
function fakeTx(opts: { cierre: any; project: any; certs?: any[]; reglaActiva?: boolean }) {
  return fakeDb({
    project: [opts.project],
    cierrePeriodo: [opts.cierre],
    certification: (opts.certs ?? []).map((c) => ({ projectId: 1, partnerId: null, ...c })),
    reglaAsientoContable: opts.reglaActiva === false ? [] : [{ evento: EVENTO.FACTURA_CLIENTE_EMITIDA, activo: true, cuentaDebeId: 10, cuentaHaberId: 20 }],
  });
}

const baseCierre = {
  id: 1,
  projectId: 1,
  desde: new Date("2026-01-01"),
  hasta: new Date("2026-01-31"),
  snapshot: {
    avance: {
      rows: [{ budgetItemId: 1, code: "1.1", name: "Excavación", unit: "m3", ejecutadoOficial: 100, puConIva: 11_000 }],
    },
  },
};
const baseProject = { id: 1, name: "Obra Test", code: "OB-1", clientName: "Comitente SA", ivaPct: 10 };

describe("createClientInvoice", () => {
  it("genera una factura EMITIDA (ingreso) con el total devengado correcto", async () => {
    const tx = fakeTx({ cierre: baseCierre, project: baseProject });
    const invoice = await createClientInvoice(tx, 1, {});
    expect(invoice.tipo).toBe("EMITIDA");
    expect(invoice.total).toBe(1_100_000); // 100 m3 * 11.000 Gs/m3 (PU con IVA)
    expect(invoice.montoRetenido).toBe(0);
  });

  it("aplica el fondo de reparo del certificado al cliente del período y lo registra como retención pendiente", async () => {
    const certs = [{ id: 5, numero: 1, estado: "APROBADO", retentionPct: 5, periodTo: new Date("2026-01-20"), fecha: new Date("2026-01-20") }];
    const tx = fakeTx({ cierre: baseCierre, project: baseProject, certs });
    const invoice = await createClientInvoice(tx, 1, {});
    expect(invoice.montoRetenido).toBe(Math.round(1_100_000 * 0.05));
    expect(rows(tx, "retencionFondo")).toHaveLength(1);
    expect(rows(tx, "retencionFondo")[0].tipo).toBe("FONDO_REPARO");
    expect(rows(tx, "retencionFondo")[0].partnerId).toBeNull();
  });

  it("postea un único asiento FACTURA_CLIENTE_EMITIDA (idempotente ante dobles llamadas con el mismo cierre)", async () => {
    const tx = fakeTx({ cierre: baseCierre, project: baseProject });
    await createClientInvoice(tx, 1, {});
    // Un segundo createClientInvoice sobre el mismo cierre ya facturado debe rechazarse antes de postear otro asiento.
    await expect(createClientInvoice(tx, 1, {})).rejects.toThrow(/ya está facturado/i);
    expect(rows(tx, "asiento")).toHaveLength(1);
  });

  it("no rompe la emisión si no hay regla contable activa para el evento", async () => {
    const tx = fakeTx({ cierre: baseCierre, project: baseProject, reglaActiva: false });
    const invoice = await createClientInvoice(tx, 1, {});
    expect(invoice.tipo).toBe("EMITIDA");
    expect(rows(tx, "asiento")).toHaveLength(0);
  });
});
