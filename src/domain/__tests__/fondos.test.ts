import { describe, expect, it } from "vitest";
import {
  anularAnticipo,
  anularSolicitudPorOrigen,
  aprobarSolicitud,
  crearAnticipo,
  pagarLote,
  pagarSolicitud,
  programarSolicitud,
  rechazarSolicitud,
  solicitudDesdeCertificacion,
  solicitudDesdeCertificadoSubcontrato,
} from "../fondos";
import { calcularNeto, estadoTrasPago, puedeTransicionar, solicitadoSinPagar, totalesPorEstado } from "../fondosMath";

/**
 * Prisma en memoria (mismo patrón que contabilidad.more.test.ts: arrays + funciones, sin DB).
 * Solo los modelos que usa src/domain/fondos.ts. No tiene budgetMovement: si la solicitud lo
 * tocara, el test rompería.
 */
type Row = Record<string, any>;

/** relación → [tabla, campo FK en la fila (1:1) | FK en la tabla destino (1:N)] */
const REL: Record<string, Record<string, { table: string; fk: string; many?: boolean }>> = {
  certification: {
    partner: { table: "partner", fk: "partnerId" },
    project: { table: "project", fk: "projectId" },
    invoices: { table: "invoice", fk: "certificationId", many: true },
  },
  subcontractorCertificate: { contract: { table: "subcontractorContract", fk: "contractId" } },
  anticipo: {
    partner: { table: "partner", fk: "partnerId" },
    aplicaciones: { table: "aplicacionAnticipo", fk: "anticipoId", many: true },
  },
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "sourceType_sourceId") return row.sourceType === v.sourceType && row.sourceId === v.sourceId;
    if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
    return row[k] === v;
  });
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in v) row[k] = Number(row[k] ?? 0) + Number(v.increment);
    else if (v && typeof v === "object" && "decrement" in v) row[k] = Number(row[k] ?? 0) - Number(v.decrement);
    else row[k] = v;
  }
}

function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  const ids: Record<string, number> = {};
  const t = (name: string) => (tables[name] ??= []);
  for (const [name, rows] of Object.entries(seed)) {
    t(name).push(...rows.map((r) => ({ ...r })));
    ids[name] = Math.max(0, ...rows.map((r) => r.id ?? 0));
  }

  const withInclude = (name: string, row: Row | undefined, include?: Row) => {
    if (!row) return null;
    if (!include) return row;
    const out = { ...row };
    for (const key of Object.keys(include)) {
      const rel = REL[name]?.[key];
      if (!rel) continue;
      out[key] = rel.many ? t(rel.table).filter((r) => r[rel.fk] === row.id) : t(rel.table).find((r) => r.id === row[rel.fk]) ?? null;
    }
    return out;
  };

  const model = (name: string) => ({
    findUnique: async ({ where, include }: Row) => withInclude(name, t(name).find((r) => matches(r, where)), include),
    findFirst: async ({ where, include }: Row = {}) => withInclude(name, t(name).find((r) => matches(r, where)), include),
    findMany: async ({ where }: Row = {}) => t(name).filter((r) => matches(r, where)),
    create: async ({ data }: Row) => {
      const { lineas, ...rest } = data;
      const row: Row = { id: (ids[name] = (ids[name] ?? 0) + 1), anulaDeId: null, ...rest };
      if (lineas?.create) row.lineas = lineas.create;
      t(name).push(row);
      return row;
    },
    update: async ({ where, data }: Row) => {
      const row = t(name).find((r) => matches(r, where));
      if (!row) throw new Error(`${name} ${JSON.stringify(where)} no existe`);
      applyData(row, data);
      return row;
    },
    aggregate: async ({ where, _max }: Row) => {
      const rows = t(name).filter((r) => matches(r, where));
      const max: Row = {};
      for (const k of Object.keys(_max)) max[k] = rows.length ? Math.max(...rows.map((r) => r[k])) : null;
      return { _max: max };
    },
  });

  const names = [
    "solicitudFondo",
    "pagoSolicitudFondo",
    "certification",
    "subcontractorCertificate",
    "subcontractorContract",
    "anticipo",
    "aplicacionAnticipo",
    "retencionFondo",
    "project",
    "partner",
    "invoice",
    "payment",
    "cuentaFinanciera",
    "movimientoCuentaFinanciera",
    "reglaAsientoContable",
    "asiento",
  ];
  const tx = Object.fromEntries(names.map((n) => [n, model(n)])) as any;
  return { tx, tables, t };
}

const CUENTA_BANCO_CONTABLE = 103;
const REGLAS = [
  { id: 1, evento: "PAGO_FACTURA", cuentaDebeId: 201, cuentaHaberId: 113, activo: true },
  { id: 2, evento: "PAGO_ANTICIPO_PROVEEDOR", cuentaDebeId: 122, cuentaHaberId: 113, activo: true },
  { id: 3, evento: "PAGO_CERTIFICADO_SUBCONTRATISTA", cuentaDebeId: 202, cuentaHaberId: 113, activo: true },
];

function escenario() {
  return fakeDb({
    project: [{ id: 1, code: "CTN", name: "Obra CTN" }],
    partner: [
      { id: 7, name: "Sub SRL" },
      { id: 8, name: "Proveedor SA" },
    ],
    certification: [
      { id: 50, projectId: 1, partnerId: 7, numero: 3, montoTotal: 10_000_000, retentionAmount: 500_000, approvedAt: new Date("2026-10-01") },
    ],
    invoice: [
      { id: 900, projectId: 1, partnerId: 7, certificationId: 50, tipo: "RECIBIDA", estado: "APROBADA", numeroFactura: "001-002-0000003", total: 10_000_000, fechaVencimiento: new Date("2026-10-31") },
    ],
    retencionFondo: [{ id: 1, sourceType: "Certification", sourceId: 50, tipo: "RETENCION_GARANTIA", monto: 200_000 }],
    aplicacionAnticipo: [{ id: 1, anticipoId: 99, sourceType: "Certification", sourceId: 50, monto: 1_000_000 }],
    cuentaFinanciera: [
      { id: 5, projectId: 1, nombre: "Banco", cuentaContableId: CUENTA_BANCO_CONTABLE },
      { id: 6, projectId: 2, nombre: "Banco otra obra", cuentaContableId: null },
    ],
    subcontractorContract: [{ id: 30, projectId: 1, partnerId: 7, number: "SC-0001", paidAmount: 0, status: "CERTIFICADO" }],
    subcontractorCertificate: [{ id: 60, contractId: 30, number: "CERT-0001", amount: 4_000_000, status: "CERTIFICADO", issuedAt: new Date("2026-10-01") }],
    reglaAsientoContable: REGLAS,
  });
}

const pago = { cuentaFinancieraId: 5, referencia: "TRF-1", fecha: new Date("2026-10-02"), usuario: "Tesorero" };

describe("fondosMath", () => {
  it("neto = bruto − reparo − retenciones − anticipo, en Gs sin decimales", () => {
    expect(calcularNeto(10_000_000.4, { reparo: 500_000, retenciones: 200_000, anticipo: 1_000_000 }).montoNeto).toBe(8_300_000);
  });
  it("transiciones: no se aprueba lo pagado ni se paga lo pendiente", () => {
    expect(puedeTransicionar("PENDIENTE", "APROBADA")).toBe(true);
    expect(puedeTransicionar("PENDIENTE", "PAGADA")).toBe(false);
    expect(puedeTransicionar("PAGADA", "ANULADA")).toBe(false);
    expect(estadoTrasPago(1000, 400)).toBe("PAGADA_PARCIAL");
    expect(estadoTrasPago(1000, 1000)).toBe("PAGADA");
  });
  it("totales por estado y solicitado sin pagar se suman", () => {
    const rows = [
      { estado: "APROBADA" as const, montoNeto: 1000, montoPagado: 0 },
      { estado: "PAGADA_PARCIAL" as const, montoNeto: 1000, montoPagado: 300 },
      { estado: "PAGADA" as const, montoNeto: 500, montoPagado: 500 },
      { estado: "ANULADA" as const, montoNeto: 800, montoPagado: 0 },
    ];
    const t = totalesPorEstado(rows);
    expect(t.APROBADA).toEqual({ cantidad: 1, neto: 1000, pagado: 0, saldo: 1000 });
    expect(t.ANULADA.saldo).toBe(0);
    expect(solicitadoSinPagar(rows)).toBe(1700);
  });
});

describe("generación desde el certificado de subcontratista", () => {
  it("aprobar genera 1 solicitud y re-aprobar no duplica", async () => {
    const { tx, t } = escenario();
    const a = await solicitudDesdeCertificacion(tx, 50, "Ana");
    const b = await solicitudDesdeCertificacion(tx, 50, "Ana");
    expect(t("solicitudFondo")).toHaveLength(1);
    expect(b!.id).toBe(a!.id);
    expect(a).toMatchObject({ numero: 1, origen: "CERT_SUBCONTRATISTA", estado: "PENDIENTE", creadoPor: "Ana", partnerId: 7 });
  });

  it("neto correcto y factura RECIBIDA enlazada", async () => {
    const { tx } = escenario();
    const s = await solicitudDesdeCertificacion(tx, 50, "Ana");
    expect(s).toMatchObject({
      montoBruto: 10_000_000,
      descuentoReparo: 500_000,
      descuentoRetenciones: 200_000,
      descuentoAnticipo: 1_000_000,
      montoNeto: 8_300_000,
      invoiceId: 900,
    });
    expect(s!.fechaVencimiento).toEqual(new Date("2026-10-31"));
  });

  it("certificado de contrato de subcontrato: correlativo por obra", async () => {
    const { tx } = escenario();
    await solicitudDesdeCertificacion(tx, 50, "Ana");
    const s = await solicitudDesdeCertificadoSubcontrato(tx, 60, "Ana");
    expect(s).toMatchObject({ numero: 2, montoNeto: 4_000_000, invoiceId: null, sourceType: "SubcontractorCertificate" });
  });
});

describe("anticipos", () => {
  it("anticipo OTORGADO genera su solicitud por el monto completo", async () => {
    const { tx, t } = escenario();
    const { anticipo, solicitud } = await crearAnticipo(tx, { projectId: 1, partnerId: 8, tipo: "OTORGADO", monto: 3_000_000, fecha: new Date("2026-10-05") }, "Ana");
    expect(solicitud).toMatchObject({ origen: "ANTICIPO", anticipoId: anticipo.id, montoNeto: 3_000_000, partnerId: 8 });
    expect(solicitud!.fechaVencimiento).toEqual(new Date("2026-10-05"));
    await crearAnticipo(tx, { projectId: 1, tipo: "RECIBIDO", monto: 1_000, fecha: new Date("2026-10-05") }, "Ana");
    expect(t("solicitudFondo")).toHaveLength(1);
  });

  it("anticipo OTORGADO sin proveedor se rechaza", async () => {
    const { tx } = escenario();
    await expect(crearAnticipo(tx, { projectId: 1, tipo: "OTORGADO", monto: 1, fecha: new Date() }, "Ana")).rejects.toMatchObject({ code: "PARTNER_REQUIRED" });
  });
});

describe("anular el origen", () => {
  it("sin pagos: la solicitud queda ANULADA (y el anticipo marcado)", async () => {
    const { tx, t } = escenario();
    const { anticipo, solicitud } = await crearAnticipo(tx, { projectId: 1, partnerId: 8, tipo: "OTORGADO", monto: 3_000_000, fecha: new Date() }, "Ana");
    await anularAnticipo(tx, anticipo.id);
    expect(t("solicitudFondo").find((s) => s.id === solicitud!.id)!.estado).toBe("ANULADA");
    expect(t("anticipo")[0].anuladoAt).toBeInstanceOf(Date);
  });

  it("con pagos: error claro y no se anula", async () => {
    const { tx, t } = escenario();
    const s = await solicitudDesdeCertificacion(tx, 50, "Ana");
    await aprobarSolicitud(tx, s!.id, "Gerente");
    await pagarSolicitud(tx, s!.id, { ...pago, monto: 1_000_000 });
    await expect(anularSolicitudPorOrigen(tx, "Certification", 50)).rejects.toMatchObject({ code: "SOLICITUD_CON_PAGOS", status: 409 });
    expect(t("solicitudFondo")[0].estado).toBe("PAGADA_PARCIAL");
  });

  it("sin solicitud no hace nada", async () => {
    const { tx } = escenario();
    expect(await anularSolicitudPorOrigen(tx, "SubcontractorCertificate", 60)).toBeFalsy();
  });
});

describe("transiciones", () => {
  it("el aprobador no puede ser quien la generó", async () => {
    const { tx } = escenario();
    const s = await solicitudDesdeCertificacion(tx, 50, "Ana");
    await expect(aprobarSolicitud(tx, s!.id, "Ana")).rejects.toMatchObject({ code: "APROBADOR_IGUAL_CREADOR" });
    await expect(aprobarSolicitud(tx, s!.id, "")).rejects.toMatchObject({ code: "USUARIO_REQUERIDO" });
    const ok = await aprobarSolicitud(tx, s!.id, "Gerente");
    expect(ok).toMatchObject({ estado: "APROBADA", aprobadoPor: "Gerente" });
  });

  it("no se paga una pendiente; rechazar exige motivo; programar valida la cuenta de la obra", async () => {
    const { tx } = escenario();
    const s = await solicitudDesdeCertificacion(tx, 50, "Ana");
    await expect(pagarSolicitud(tx, s!.id, pago)).rejects.toMatchObject({ code: "SOLICITUD_NO_PAGABLE" });
    await expect(rechazarSolicitud(tx, s!.id, "Gerente", " ")).rejects.toMatchObject({ code: "MOTIVO_REQUERIDO" });
    await aprobarSolicitud(tx, s!.id, "Gerente");
    await expect(programarSolicitud(tx, s!.id, { fechaProgramada: new Date(), cuentaFinancieraId: 6 })).rejects.toMatchObject({ code: "ACCOUNT_PROJECT_MISMATCH" });
    const p = await programarSolicitud(tx, s!.id, { fechaProgramada: new Date("2026-10-10"), cuentaFinancieraId: 5 });
    expect(p).toMatchObject({ estado: "PROGRAMADA", cuentaFinancieraId: 5 });
  });
});

describe("pagos", () => {
  it("con factura: pago parcial y total → Payment + EGRESO + asiento; factura PAGADA al final", async () => {
    const { tx, t } = escenario();
    const s = await solicitudDesdeCertificacion(tx, 50, "Ana");
    await aprobarSolicitud(tx, s!.id, "Gerente");

    const r1 = await pagarSolicitud(tx, s!.id, { ...pago, monto: 3_000_000 });
    expect(r1.solicitud).toMatchObject({ estado: "PAGADA_PARCIAL", montoPagado: 3_000_000 });
    expect(t("invoice")[0].estado).toBe("APROBADA");

    await expect(pagarSolicitud(tx, s!.id, { ...pago, monto: 5_300_001 })).rejects.toMatchObject({ code: "MONTO_INVALIDO" });

    const r2 = await pagarSolicitud(tx, s!.id, { ...pago, referencia: "TRF-2" }); // sin monto = saldo
    expect(r2.solicitud).toMatchObject({ estado: "PAGADA", montoPagado: 8_300_000 });
    expect(t("invoice")[0].estado).toBe("PAGADA");

    expect(t("payment").map((p) => p.montoPagado)).toEqual([3_000_000, 5_300_000]);
    expect(t("payment").every((p) => p.invoiceId === 900)).toBe(true);
    expect(t("movimientoCuentaFinanciera")).toHaveLength(2);
    expect(t("movimientoCuentaFinanciera").every((m) => m.tipo === "EGRESO" && m.sourceType === "Payment")).toBe(true);
    expect(t("pagoSolicitudFondo").map((p) => p.paymentId)).toEqual([1, 2]);

    // Debe Proveedores (regla), Haber la cuenta contable del banco.
    const asiento = t("asiento")[0];
    expect(asiento.sourceType).toBe("Payment");
    expect(asiento.lineas).toEqual([
      expect.objectContaining({ cuentaId: 201, partnerId: 7 }),
      expect.objectContaining({ cuentaId: CUENTA_BANCO_CONTABLE }),
    ]);
    expect(Number(asiento.lineas[0].debe)).toBe(3_000_000);
    expect(Number(asiento.lineas[1].haber)).toBe(3_000_000);
  });

  it("anticipo: solo EGRESO (sin Payment) y asiento a Anticipos a proveedores", async () => {
    const { tx, t } = escenario();
    const { solicitud } = await crearAnticipo(tx, { projectId: 1, partnerId: 8, tipo: "OTORGADO", monto: 2_000_000, fecha: new Date() }, "Ana");
    await aprobarSolicitud(tx, solicitud!.id, "Gerente");
    const r = await pagarSolicitud(tx, solicitud!.id, pago);
    expect(r.solicitud.estado).toBe("PAGADA");
    expect(t("payment")).toHaveLength(0);
    expect(t("movimientoCuentaFinanciera")[0]).toMatchObject({ tipo: "EGRESO", monto: 2_000_000, sourceType: "PagoSolicitudFondo", sourceId: r.pago.id });
    expect(t("asiento")[0].lineas[0]).toMatchObject({ cuentaId: 122, partnerId: 8 });
  });

  it("pago total de un certificado de contrato lo marca PAGADO", async () => {
    const { tx, t } = escenario();
    const s = await solicitudDesdeCertificadoSubcontrato(tx, 60, "Ana");
    await aprobarSolicitud(tx, s!.id, "Gerente");
    await pagarSolicitud(tx, s!.id, pago);
    expect(t("subcontractorCertificate")[0].status).toBe("PAGADO");
    expect(t("subcontractorContract")[0].paidAmount).toBe(4_000_000);
    expect(t("asiento")[0].lineas[0].cuentaId).toBe(202);
  });

  it("pago en lote: mismo grupo, todas pagadas, total sumado", async () => {
    const { tx, t } = escenario();
    const a = await solicitudDesdeCertificacion(tx, 50, "Ana");
    const b = await solicitudDesdeCertificadoSubcontrato(tx, 60, "Ana");
    await aprobarSolicitud(tx, a!.id, "Gerente");
    await aprobarSolicitud(tx, b!.id, "Gerente");
    const r = await pagarLote(tx, { ...pago, items: [{ solicitudId: a!.id }, { solicitudId: b!.id }] });
    expect(r.total).toBe(12_300_000);
    expect(t("solicitudFondo").every((s) => s.estado === "PAGADA")).toBe(true);
    const grupos = new Set(t("pagoSolicitudFondo").map((p) => p.grupoPagoId));
    expect(grupos.size).toBe(1);
    expect([...grupos][0]).toBe(r.grupoPagoId);
    expect(t("payment")[0].grupoPagoId).toBe(r.grupoPagoId);
  });

  it("pago en lote con una solicitud no pagable falla (todo o nada en la transacción)", async () => {
    const { tx } = escenario();
    const a = await solicitudDesdeCertificacion(tx, 50, "Ana");
    const b = await solicitudDesdeCertificadoSubcontrato(tx, 60, "Ana");
    await aprobarSolicitud(tx, a!.id, "Gerente");
    await expect(pagarLote(tx, { ...pago, items: [{ solicitudId: a!.id }, { solicitudId: b!.id }] })).rejects.toMatchObject({ code: "SOLICITUD_NO_PAGABLE" });
    await expect(pagarLote(tx, { ...pago, items: [{ solicitudId: a!.id }, { solicitudId: a!.id }] })).rejects.toMatchObject({ code: "LOTE_DUPLICADO" });
  });
});
