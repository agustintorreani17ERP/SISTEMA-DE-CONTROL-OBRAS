import { describe, expect, it } from "vitest";
import { estadoPorAvance, pendienteDeCompra, puedeModificarseDesdeOrigen, validarRenglonesOC } from "../../erp/domain/requisicionesMath";
import {
  actualizarEstadoRequisicion,
  avisarOcEmitida,
  avisarPedidoTomado,
  avisarRecepcion,
  crearRequisicionDesdePedido,
  rechazarRequisicion,
  upsertPedidoTaller,
  type PedidoTallerInput,
} from "../../erp/domain/requisiciones";

type Row = Record<string, any>;

function fakeDb(seed: { project?: Row[]; materialRequest?: Row[]; purchaseOrder?: Row[]; purchaseOrderDetail?: Row[] } = {}) {
  const t: Record<string, Row[]> = {
    project: [...(seed.project ?? [{ id: 1, code: "CTN" }])],
    materialRequest: [...(seed.materialRequest ?? [])],
    requisicion: [],
    requisicionLinea: [],
    purchaseOrder: [...(seed.purchaseOrder ?? [])],
    purchaseOrderDetail: [...(seed.purchaseOrderDetail ?? [])],
    eventoSalida: [],
  };
  const ids: Record<string, number> = {};
  const next = (n: string) => (ids[n] = Math.max(ids[n] ?? 0, ...t[n].map((r) => r.id ?? 0)) + 1);
  const conLineas = (r: Row | undefined, include?: Row) => (r && include?.lineas ? { ...r, lineas: t.requisicionLinea.filter((l) => l.requisicionId === r.id) } : r ?? null);
  const reqMatch = (r: Row, w: Row) =>
    w.id !== undefined
      ? r.id === w.id
      : w.materialRequestId !== undefined
      ? r.materialRequestId === w.materialRequestId
      : r.sistemaOrigen === w.sistemaOrigen_externalId.sistemaOrigen && r.externalId === w.sistemaOrigen_externalId.externalId;

  const tx: any = {
    project: { findUnique: async ({ where }: Row) => t.project.find((p) => (where.id ? p.id === where.id : p.code === where.code)) ?? null },
    materialRequest: {
      findUnique: async ({ where }: Row) => {
        const mr = t.materialRequest.find((m) => m.id === where.id);
        return mr ? { ...mr, details: mr.details ?? [] } : null;
      },
    },
    requisicion: {
      findUnique: async ({ where, include }: Row) => conLineas(t.requisicion.find((r) => reqMatch(r, where)), include),
      create: async ({ data }: Row) => {
        const { lineas, ...rest } = data;
        const row = { id: next("requisicion"), estado: "RECIBIDA", ...rest };
        t.requisicion.push(row);
        for (const l of lineas?.create ?? []) t.requisicionLinea.push({ id: next("requisicionLinea"), requisicionId: row.id, ...l });
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = t.requisicion.find((r) => r.id === where.id)!;
        const { lineas, ...rest } = data;
        Object.assign(row, rest);
        for (const l of lineas?.create ?? []) t.requisicionLinea.push({ id: next("requisicionLinea"), requisicionId: row.id, ...l });
        return row;
      },
    },
    requisicionLinea: {
      deleteMany: async ({ where }: Row) => {
        t.requisicionLinea = t.requisicionLinea.filter((l) => l.requisicionId !== where.requisicionId);
      },
    },
    purchaseOrder: {
      count: async ({ where }: Row) => t.purchaseOrder.filter((o) => o.requisicionId === where.requisicionId && o.status !== "ANULADO").length,
    },
    purchaseOrderDetail: {
      findMany: async ({ where }: Row) =>
        t.purchaseOrderDetail
          .filter((d) => where.requisicionLineaId.in.includes(d.requisicionLineaId))
          .map((d) => ({ ...d, order: t.purchaseOrder.find((o) => o.id === d.orderId)! }))
          .filter((d) => d.order.status !== "ANULADO"),
    },
    eventoSalida: {
      create: async ({ data }: Row) => {
        t.eventoSalida.push({ id: next("eventoSalida"), ...data });
      },
    },
  };
  return { tx, t };
}

describe("estadoPorAvance", () => {
  it("sin OC, el pedido espera compra", () => {
    expect(estadoPorAvance([{ cantidad: 10, pedida: 0, recibida: 0 }])).toBe("RECIBIDA");
  });
  it("con algo pedido, es compra parcial", () => {
    expect(estadoPorAvance([{ cantidad: 10, pedida: 4, recibida: 0 }, { cantidad: 5, pedida: 0, recibida: 0 }])).toBe("COMPRADA_PARCIAL");
  });
  it("con todo en OC, está en compra", () => {
    expect(estadoPorAvance([{ cantidad: 10, pedida: 10, recibida: 3 }])).toBe("EN_COMPRA");
  });
  it("con todo recibido, está comprada", () => {
    expect(estadoPorAvance([{ cantidad: 10, pedida: 10, recibida: 10 }])).toBe("COMPRADA");
  });
  it("un pedido sin renglones queda en la bandeja", () => {
    expect(estadoPorAvance([])).toBe("RECIBIDA");
  });
});

describe("validarRenglonesOC", () => {
  const pendientes = new Map([[1, 10], [2, 4]]);
  it("acepta cantidades dentro de lo pendiente", () => {
    expect(validarRenglonesOC([{ requisicionLineaId: 1, quantity: 10, unitPrice: 5 }], pendientes)).toEqual([]);
  });
  it("rechaza pasarse de lo que falta comprar, sumando renglones repetidos", () => {
    expect(validarRenglonesOC([{ requisicionLineaId: 2, quantity: 3, unitPrice: 1 }, { requisicionLineaId: 2, quantity: 3, unitPrice: 1 }], pendientes)).not.toEqual([]);
  });
  it("rechaza renglones de otro pedido, sin renglones y precios negativos", () => {
    expect(validarRenglonesOC([{ requisicionLineaId: 99, quantity: 1, unitPrice: 1 }], pendientes)).not.toEqual([]);
    expect(validarRenglonesOC([], pendientes)).not.toEqual([]);
    expect(validarRenglonesOC([{ requisicionLineaId: 1, quantity: 1, unitPrice: -1 }], pendientes)).not.toEqual([]);
  });
  it("el pendiente nunca es negativo y el origen no modifica con OC vigentes", () => {
    expect(pendienteDeCompra({ cantidad: 5, pedida: 8 })).toBe(0);
    expect(puedeModificarseDesdeOrigen(0)).toBe(true);
    expect(puedeModificarseDesdeOrigen(1)).toBe(false);
  });
});

const pedido: PedidoTallerInput = {
  externalId: "ped-1",
  numero: "321/2026",
  fecha: "2026-10-10",
  obraCodigo: "CTN",
  maquinaCodigo: "RET-02",
  maquinaDescripcion: "Retroexcavadora",
  compraCentral: true,
  anulado: false,
  lineas: [
    { externalLineId: "l-1", nroParte: "AB-123", descripcion: "Filtro de aceite", cantidad: 2 },
    { externalLineId: "l-2", descripcion: "Filtro de aire", cantidad: 1 },
  ],
};

describe("pedidos del Taller", () => {
  it("entran a la bandeja con la obra enlazada por código y sus renglones", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    expect(r).toMatchObject({ sistemaOrigen: "TALLER", estado: "RECIBIDA", projectId: 1, compraCentral: true, maquinaTexto: "RET-02 · Retroexcavadora" });
    expect(t.requisicionLinea).toHaveLength(2);
    expect(t.requisicionLinea[0]).toMatchObject({ nroParte: "AB-123", externalLineId: "l-1", maquinaCodigo: "RET-02" });
  });

  it("una obra desconocida queda como texto, sin enlace", async () => {
    const { tx } = fakeDb();
    const r = await upsertPedidoTaller(tx, { ...pedido, obraCodigo: "XYZ", obraNombre: "Ruta 9" });
    expect(r).toMatchObject({ projectId: null, obraTexto: "Ruta 9" });
  });

  it("reenviar el mismo pedido no lo duplica y reemplaza sus renglones", async () => {
    const { tx, t } = fakeDb();
    await upsertPedidoTaller(tx, pedido);
    await upsertPedidoTaller(tx, { ...pedido, lineas: [{ externalLineId: "l-1", descripcion: "Filtro de aceite", cantidad: 5 }] });
    expect(t.requisicion).toHaveLength(1);
    expect(t.requisicionLinea).toHaveLength(1);
    expect(Number(t.requisicionLinea[0].cantidad)).toBe(5);
  });

  it("con OC vigentes el Taller ya no lo cambia ni lo anula", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    t.purchaseOrder.push({ id: 1, requisicionId: r.id, status: "BORRADOR" });
    await upsertPedidoTaller(tx, { ...pedido, lineas: [{ externalLineId: "l-1", descripcion: "Otra cosa", cantidad: 99 }] });
    await upsertPedidoTaller(tx, { ...pedido, anulado: true });
    expect(t.requisicionLinea).toHaveLength(2);
    expect(t.requisicion[0].estado).toBe("RECIBIDA");
  });

  it("sin OC se anula desde el Taller, y vuelve a la bandeja si se reenvía activo", async () => {
    const { tx, t } = fakeDb();
    await upsertPedidoTaller(tx, pedido);
    await upsertPedidoTaller(tx, { ...pedido, anulado: true });
    expect(t.requisicion[0].estado).toBe("ANULADA");
    await upsertPedidoTaller(tx, pedido);
    expect(t.requisicion[0].estado).toBe("RECIBIDA");
  });

  it("valida fecha, renglones y cantidades", async () => {
    const { tx } = fakeDb();
    await expect(upsertPedidoTaller(tx, { ...pedido, fecha: "10/10/2026" })).rejects.toMatchObject({ code: "FECHA_INVALIDA" });
    await expect(upsertPedidoTaller(tx, { ...pedido, lineas: [] })).rejects.toMatchObject({ code: "PEDIDO_SIN_RENGLONES" });
    await expect(upsertPedidoTaller(tx, { ...pedido, lineas: [{ externalLineId: "x", descripcion: "x", cantidad: 0 }] })).rejects.toMatchObject({ code: "CANTIDAD_INVALIDA" });
  });
});

describe("estado según las OC", () => {
  it("sigue el avance de lo pedido y lo recibido, y respeta los estados fijos", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    const [l1, l2] = t.requisicionLinea;
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("RECIBIDA");

    t.purchaseOrder.push({ id: 1, status: "EMITIDA", requisicionId: r.id });
    t.purchaseOrderDetail.push({ id: 1, orderId: 1, requisicionLineaId: l1.id, quantity: 2 });
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("COMPRADA_PARCIAL");

    t.purchaseOrderDetail.push({ id: 2, orderId: 1, requisicionLineaId: l2.id, quantity: 1 });
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("EN_COMPRA");

    t.purchaseOrder[0].status = "RECIBIDO";
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("COMPRADA");

    t.purchaseOrder[0].status = "ANULADO";
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("RECIBIDA");

    t.requisicion[0].estado = "RECHAZADA";
    t.purchaseOrder[0].status = "RECIBIDO";
    expect(await actualizarEstadoRequisicion(tx, r.id)).toBe("RECHAZADA");
  });
});

describe("rechazar", () => {
  it("rechaza un pedido del Taller sin OC y avisa; no uno de obra ni sin motivo", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    await expect(rechazarRequisicion(tx, r.id, " ")).rejects.toMatchObject({ code: "MOTIVO_REQUERIDO" });
    await rechazarRequisicion(tx, r.id, "Es de taller, lo compran ellos");
    expect(t.requisicion[0].estado).toBe("RECHAZADA");
    expect(t.eventoSalida[0]).toMatchObject({ destino: "TALLER", tipo: "pedido.rechazado" });

    t.requisicion.push({ id: 50, sistemaOrigen: "ECMS", externalId: "9", estado: "RECIBIDA" });
    await expect(rechazarRequisicion(tx, 50, "x")).rejects.toMatchObject({ code: "RECHAZO_NO_PERMITIDO" });
  });

  it("no rechaza si ya hay una OC vigente", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    t.purchaseOrder.push({ id: 1, requisicionId: r.id, status: "BORRADOR" });
    await expect(rechazarRequisicion(tx, r.id, "x")).rejects.toMatchObject({ code: "TIENE_OC" });
  });
});

describe("pedidos de obra (ECMS)", () => {
  const mr = {
    id: 7,
    number: "PM-000007",
    projectId: 1,
    requestedDate: new Date("2026-10-05T12:00:00Z"),
    notes: "Para el frente 2",
    details: [
      { id: 70, materialId: 3, budgetItemId: 11, quantity: 100, material: { description: "Cemento", unit: "bolsa" } },
      { id: 71, materialId: 4, budgetItemId: null, quantity: 20, material: { description: "Arena", unit: "m3" } },
    ],
  };

  it("al aprobarse nace su requisición, una sola vez", async () => {
    const { tx, t } = fakeDb({ materialRequest: [mr] });
    const a = await crearRequisicionDesdePedido(tx, 7);
    const b = await crearRequisicionDesdePedido(tx, 7);
    expect(b.id).toBe(a.id);
    expect(t.requisicion).toHaveLength(1);
    expect(t.requisicion[0]).toMatchObject({ sistemaOrigen: "ECMS", externalId: "7", numeroOrigen: "PM-000007", projectId: 1, materialRequestId: 7 });
    expect(t.requisicionLinea.map((l) => [l.descripcion, l.unidad, l.materialRequestDetailId])).toEqual([
      ["Cemento", "bolsa", 70],
      ["Arena", "m3", 71],
    ]);
  });
});

describe("avisos al Taller", () => {
  it("solo avisa por pedidos del Taller, con las cantidades por renglón", async () => {
    const { tx, t } = fakeDb();
    const r = await upsertPedidoTaller(tx, pedido);
    t.requisicion.push({ id: 90, sistemaOrigen: "ECMS", externalId: "1", lineas: [] });

    await avisarPedidoTomado(tx, r.id, "OC-000001");
    await avisarOcEmitida(tx, r.id, "OC-000001", new Date("2026-10-11T00:00:00Z"));
    await avisarRecepcion(tx, r.id, {
      number: "OC-000001",
      receiptNumber: "001-001-123",
      fecha: new Date("2026-10-12T00:00:00Z"),
      detalles: [
        { requisicionLineaId: t.requisicionLinea[0].id, quantity: 2 },
        { requisicionLineaId: t.requisicionLinea[1].id, quantity: 1 },
      ],
    });
    await avisarPedidoTomado(tx, 90, "OC-000002");

    expect(t.eventoSalida.map((e) => e.tipo)).toEqual(["pedido.tomado_por_erp", "pedido.oc_emitida", "pedido.recibido"]);
    expect(t.eventoSalida[2].payload).toMatchObject({
      externalId: "ped-1",
      remito: "001-001-123",
      lineas: [{ externalLineId: "l-1", cantidad: 2 }, { externalLineId: "l-2", cantidad: 1 }],
    });
  });
});
