import { describe, expect, it } from "vitest";
import {
  anularNota,
  crearNota,
  marcarRecibidaPorTaller,
  recibirNota,
  registrarNotaTaller,
  type CrearNotaInput,
} from "../../bridge/domain/notasEnvio";
import { puedeTransicionar, validarLineas, validarRecepcion, validarRuta } from "../../bridge/domain/notasEnvioMath";
import { esperaSegundos, MAX_INTENTOS, procesarEventos } from "../../bridge/domain/eventosSalida";

type Row = Record<string, any>;

/** Prisma en memoria con lo que usan notasEnvio.ts, numeracion.ts y eventosSalida.ts. */
function fakeDb(seed: { project?: Row[]; materialRequest?: Row[]; purchaseOrder?: Row[] } = {}) {
  const t: Record<string, Row[]> = {
    project: [...(seed.project ?? [{ id: 1 }, { id: 2 }])],
    materialRequest: [...(seed.materialRequest ?? [{ id: 10 }, { id: 11 }])],
    purchaseOrder: [...(seed.purchaseOrder ?? [{ id: 20 }])],
    solicitudFondo: [],
    certification: [],
    invoice: [],
    notaEnvio: [],
    notaEnvioLinea: [],
    secuenciaDocumento: [],
    numeroAsignado: [],
    documentAuditLog: [],
    eventoSalida: [],
  };
  const ids: Record<string, number> = {};
  const next = (n: string) => (ids[n] = (ids[n] ?? 0) + 1);
  const byId = (name: string) => async ({ where }: Row) => t[name].find((r) => r.id === where.id) ?? null;

  const notaMatch = (r: Row, w: Row) => {
    if (w.id !== undefined) return r.id === w.id;
    if (w.anio_numero) return r.anio === w.anio_numero.anio && r.numero === w.anio_numero.numero;
    if (w.sistemaOrigen_externalId) return r.sistemaOrigen === w.sistemaOrigen_externalId.sistemaOrigen && r.externalId === w.sistemaOrigen_externalId.externalId;
    return false;
  };
  const withNota = (r: Row | undefined, include?: Row) => (r && include?.lineas ? { ...r, lineas: t.notaEnvioLinea.filter((l) => l.notaId === r.id) } : r ?? null);

  const tx: any = {
    project: { findUnique: byId("project") },
    materialRequest: { findUnique: byId("materialRequest") },
    purchaseOrder: { findUnique: byId("purchaseOrder") },
    solicitudFondo: { findUnique: byId("solicitudFondo") },
    certification: { findUnique: byId("certification") },
    invoice: { findUnique: byId("invoice") },
    documentAuditLog: { create: async ({ data }: Row) => t.documentAuditLog.push(data) },
    eventoSalida: {
      create: async ({ data }: Row) => {
        const row = { id: next("evento"), estado: "PENDIENTE", intentos: 0, proximoIntento: new Date(0), ...data };
        t.eventoSalida.push(row);
        return row;
      },
      findMany: async ({ where, take }: Row) => t.eventoSalida.filter((e) => e.estado === where.estado).slice(0, take),
      update: async ({ where, data }: Row) => {
        const row = t.eventoSalida.find((e) => e.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    secuenciaDocumento: {
      upsert: async ({ where, create, update }: Row) => {
        const row = t.secuenciaDocumento.find((r) => r.tipo === where.tipo_anio.tipo && r.anio === where.tipo_anio.anio);
        if (row) {
          row.siguiente += update.siguiente.increment;
          return row;
        }
        const nuevo = { ...create };
        t.secuenciaDocumento.push(nuevo);
        return nuevo;
      },
    },
    numeroAsignado: {
      findUnique: async ({ where }: Row) => {
        const w = where.tipo_sistema_externalId;
        return t.numeroAsignado.find((r) => r.tipo === w.tipo && r.sistema === w.sistema && r.externalId === w.externalId) ?? null;
      },
      create: async ({ data }: Row) => t.numeroAsignado.push({ ...data }),
    },
    notaEnvio: {
      findUnique: async ({ where, include }: Row) => withNota(t.notaEnvio.find((r) => notaMatch(r, where)), include),
      create: async ({ data, include }: Row) => {
        const { lineas, ...rest } = data;
        const row = { id: next("nota"), estado: "ENVIADA", recibidoFecha: null, recibidoPor: null, anuladoMotivo: null, ...rest };
        t.notaEnvio.push(row);
        for (const l of lineas?.create ?? []) t.notaEnvioLinea.push({ id: next("linea"), notaId: row.id, vigente: true, ...l });
        return withNota(row, include ?? { lineas: true });
      },
      update: async ({ where, data }: Row) => {
        const row = t.notaEnvio.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    notaEnvioLinea: {
      findFirst: async ({ where }: Row) => {
        const { vigente, ...refs } = where;
        const [campo, valor] = Object.entries(refs)[0] as [string, number];
        const l = t.notaEnvioLinea.find((x) => x.vigente === vigente && x[campo] === valor);
        return l ? { ...l, nota: t.notaEnvio.find((n) => n.id === l.notaId) } : null;
      },
      updateMany: async ({ where, data }: Row) => {
        for (const l of t.notaEnvioLinea.filter((x) => x.notaId === where.notaId)) Object.assign(l, data);
      },
    },
  };
  return { tx, t };
}

const base: CrearNotaInput = {
  sistemaOrigen: "ECMS",
  origenTipo: "OBRA",
  origenProjectId: 1,
  destinoTipo: "OFICINA",
  fecha: "2026-10-10",
  contenido: "DOCUMENTOS",
  lineas: [{ kind: "PEDIDO", materialRequestId: 10 }],
};

describe("validarRuta", () => {
  it("acepta obra → oficina emitida por el ECMS", () => {
    expect(validarRuta(base)).toEqual([]);
  });
  it("cada sistema solo emite desde su lugar", () => {
    expect(validarRuta({ ...base, sistemaOrigen: "ERP" })).not.toEqual([]);
  });
  it("pide la obra cuando el lugar es OBRA y la rechaza si no", () => {
    expect(validarRuta({ ...base, origenProjectId: null })).toContain("Falta la obra de origen");
    expect(validarRuta({ ...base, destinoProjectId: 2 })).toContain("Solo una obra puede ser destino con obra");
  });
  it("no permite obra a la misma obra, pero sí entre obras distintas", () => {
    const entreObras = { ...base, destinoTipo: "OBRA" as const, destinoProjectId: 2 };
    expect(validarRuta(entreObras)).toEqual([]);
    expect(validarRuta({ ...entreObras, destinoProjectId: 1 })).toContain("El origen y el destino son la misma obra");
  });
  it("el envío interno taller → taller solo lo emite el Taller", () => {
    const interno = { sistemaOrigen: "TALLER" as const, origenTipo: "TALLER" as const, destinoTipo: "TALLER" as const };
    expect(validarRuta(interno)).toEqual([]);
    expect(validarRuta({ ...interno, sistemaOrigen: "ECMS" })).not.toEqual([]);
  });
});

describe("validarLineas", () => {
  it("exige renglones", () => {
    expect(validarLineas("DOCUMENTOS", [])).toContain("La nota necesita al menos un renglón");
  });
  it("un documento enlaza exactamente su referencia", () => {
    expect(validarLineas("DOCUMENTOS", [{ kind: "OC" }])).not.toEqual([]);
    expect(validarLineas("DOCUMENTOS", [{ kind: "OC", purchaseOrderId: 1, invoiceId: 2 }])).not.toEqual([]);
    expect(validarLineas("DOCUMENTOS", [{ kind: "OC", purchaseOrderId: 1 }])).toEqual([]);
  });
  it("el remito y lo manual llevan descripción y no enlazan", () => {
    expect(validarLineas("DOCUMENTOS", [{ kind: "REMITO" }])).not.toEqual([]);
    expect(validarLineas("DOCUMENTOS", [{ kind: "REMITO", descripcion: "Remito 001-002-123" }])).toEqual([]);
    expect(validarLineas("DOCUMENTOS", [{ kind: "MANUAL", descripcion: "x", invoiceId: 1 }])).not.toEqual([]);
  });
  it("los materiales llevan cantidad mayor a 0", () => {
    expect(validarLineas("MATERIALES", [{ kind: "MATERIAL", descripcion: "Cemento", cantidad: 0 }])).not.toEqual([]);
    expect(validarLineas("MATERIALES", [{ kind: "MATERIAL", descripcion: "Cemento", cantidad: 10, unidad: "bolsa" }])).toEqual([]);
    expect(validarLineas("MATERIALES", [{ kind: "PEDIDO", materialRequestId: 1 }])).not.toEqual([]);
  });
});

describe("estados", () => {
  it("solo ENVIADA avanza", () => {
    expect(puedeTransicionar("ENVIADA", "RECIBIDA")).toBe(true);
    expect(puedeTransicionar("ENVIADA", "ANULADA")).toBe(true);
    expect(puedeTransicionar("RECIBIDA", "ANULADA")).toBe(false);
    expect(puedeTransicionar("ANULADA", "RECIBIDA")).toBe(false);
  });
  it("la recepción no puede ser anterior a la nota ni anónima", () => {
    expect(validarRecepcion({ fechaNota: "2026-10-10", recibidoFecha: "2026-10-09", recibidoPor: "Ana" })).not.toEqual([]);
    expect(validarRecepcion({ fechaNota: "2026-10-10", recibidoFecha: "2026-10-10", recibidoPor: " " })).not.toEqual([]);
    expect(validarRecepcion({ fechaNota: "2026-10-10", recibidoFecha: "2026-10-11", recibidoPor: "Ana" })).toEqual([]);
  });
});

describe("crearNota", () => {
  it("toma el número único de NE y no toca stock", async () => {
    const { tx, t } = fakeDb();
    const a = await crearNota(tx, base, "Ing. Pérez");
    const b = await crearNota(tx, { ...base, lineas: [{ kind: "PEDIDO", materialRequestId: 11 }] }, "Ing. Pérez");
    expect([a.anio, a.numero, b.numero]).toEqual([2026, 1, 2]);
    expect(t.notaEnvio).toHaveLength(2);
    expect(t.documentAuditLog[0]).toMatchObject({ entity: "NotaEnvio", action: "CREAR" });
  });

  it("un documento no puede ir en dos notas vigentes, pero sí de nuevo tras anular la primera", async () => {
    const { tx } = fakeDb();
    const a = await crearNota(tx, base, "Ing. Pérez");
    await expect(crearNota(tx, base, "Ing. Pérez")).rejects.toMatchObject({ code: "DOCUMENTO_YA_ENVIADO", status: 409 });
    await anularNota(tx, a.id, { sistema: "ECMS", motivo: "Se mandó mal" });
    await expect(crearNota(tx, base, "Ing. Pérez")).resolves.toMatchObject({ numero: 2 });
  });

  it("rechaza un documento que no existe y exige usuario", async () => {
    const { tx } = fakeDb();
    await expect(crearNota(tx, { ...base, lineas: [{ kind: "PEDIDO", materialRequestId: 999 }] }, "Ana")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crearNota(tx, base, "  ")).rejects.toMatchObject({ code: "USUARIO_REQUERIDO" });
  });

  it("una nota hacia el Taller encola el aviso", async () => {
    const { tx, t } = fakeDb();
    await crearNota(
      tx,
      { ...base, destinoTipo: "TALLER", contenido: "MATERIALES", lineas: [{ kind: "MATERIAL", descripcion: "Bomba", cantidad: 1 }] },
      "Ana"
    );
    expect(t.eventoSalida).toHaveLength(1);
    expect(t.eventoSalida[0]).toMatchObject({ destino: "TALLER", tipo: "nota.enviada" });
    expect(t.eventoSalida[0].payload).toMatchObject({ anio: 2026, numero: 1, destinoTipo: "TALLER" });
  });

  it("una nota a la oficina no avisa al Taller", async () => {
    const { tx, t } = fakeDb();
    await crearNota(tx, base, "Ana");
    expect(t.eventoSalida).toHaveLength(0);
  });
});

describe("recibirNota y anularNota", () => {
  it("la recibe el sistema de destino y no puede recibirse dos veces", async () => {
    const { tx } = fakeDb();
    const n = await crearNota(tx, base, "Ana");
    await expect(recibirNota(tx, n.id, { sistema: "ECMS", recibidoPor: "Luis" })).rejects.toMatchObject({ code: "NO_ES_DESTINO" });
    await expect(recibirNota(tx, n.id, { sistema: "ERP", recibidoPor: "", fecha: "2026-10-11" })).rejects.toMatchObject({ code: "RECEPCION_INVALIDA" });
    const r = await recibirNota(tx, n.id, { sistema: "ERP", recibidoPor: "Luis", fecha: "2026-10-11" });
    expect(r.estado).toBe("RECIBIDA");
    await expect(recibirNota(tx, n.id, { sistema: "ERP", recibidoPor: "Luis", fecha: "2026-10-11" })).rejects.toMatchObject({ code: "TRANSICION_INVALIDA" });
    await expect(anularNota(tx, n.id, { sistema: "ECMS", motivo: "x" })).rejects.toMatchObject({ code: "TRANSICION_INVALIDA" });
  });

  it("solo anula quien la emitió y con motivo", async () => {
    const { tx, t } = fakeDb();
    const n = await crearNota(tx, base, "Ana");
    await expect(anularNota(tx, n.id, { sistema: "ERP", motivo: "x" })).rejects.toMatchObject({ code: "NO_ES_ORIGEN" });
    await expect(anularNota(tx, n.id, { sistema: "ECMS", motivo: " " })).rejects.toMatchObject({ code: "MOTIVO_REQUERIDO" });
    await anularNota(tx, n.id, { sistema: "ECMS", motivo: "Duplicada" });
    expect(t.notaEnvio[0]).toMatchObject({ estado: "ANULADA", anuladoMotivo: "Duplicada" });
    expect(t.notaEnvioLinea.every((l) => l.vigente === false)).toBe(true);
  });
});

describe("notas del Taller", () => {
  const delTaller = {
    externalId: "uuid-1",
    anio: 2026,
    numero: 7,
    fecha: "2026-10-12",
    destinoTipo: "OFICINA" as const,
    contenido: "DOCUMENTOS" as const,
    estado: "ENVIADA" as const,
    lineas: [{ descripcion: "SF 12/2026 — Repuestos SA" }],
  };

  it("registrarlas es idempotente por externalId y conserva el número del Taller", async () => {
    const { tx, t } = fakeDb();
    await registrarNotaTaller(tx, delTaller);
    await registrarNotaTaller(tx, delTaller);
    expect(t.notaEnvio).toHaveLength(1);
    expect(t.notaEnvio[0]).toMatchObject({ anio: 2026, numero: 7, sistemaOrigen: "TALLER", origenTipo: "TALLER" });
  });

  it("al recibirla el ERP, el Taller se entera", async () => {
    const { tx, t } = fakeDb();
    const n = await registrarNotaTaller(tx, delTaller);
    await recibirNota(tx, n.id, { sistema: "ERP", recibidoPor: "Luis", fecha: "2026-10-13" });
    expect(t.eventoSalida).toHaveLength(1);
    expect(t.eventoSalida[0]).toMatchObject({ tipo: "nota.recibida" });
    expect(t.eventoSalida[0].payload).toMatchObject({ externalId: "uuid-1", numero: 7 });
  });

  it("una nota ya recibida no vuelve atrás aunque el Taller la reenvíe anulada", async () => {
    const { tx, t } = fakeDb();
    const n = await registrarNotaTaller(tx, delTaller);
    await recibirNota(tx, n.id, { sistema: "ERP", recibidoPor: "Luis", fecha: "2026-10-13" });
    await registrarNotaTaller(tx, { ...delTaller, estado: "ANULADA" });
    expect(t.notaEnvio[0].estado).toBe("RECIBIDA");
  });

  it("el Taller anula una nota todavía enviada", async () => {
    const { tx, t } = fakeDb();
    await registrarNotaTaller(tx, delTaller);
    await registrarNotaTaller(tx, { ...delTaller, estado: "ANULADA", anuladoMotivo: "Error" });
    expect(t.notaEnvio[0]).toMatchObject({ estado: "ANULADA", anuladoMotivo: "Error" });
  });

  it("el Taller recibe una nota que le mandó el ECMS", async () => {
    const { tx, t } = fakeDb();
    const n = await crearNota(
      tx,
      { ...base, destinoTipo: "TALLER", contenido: "MATERIALES", lineas: [{ kind: "MATERIAL", descripcion: "Bomba", cantidad: 1 }] },
      "Ana"
    );
    await marcarRecibidaPorTaller(tx, { anio: n.anio, numero: n.numero, recibidoPor: "Jefe de taller", fecha: "2026-10-12" });
    expect(t.notaEnvio[0]).toMatchObject({ estado: "RECIBIDA", recibidoPor: "Jefe de taller" });
  });
});

describe("cola de avisos", () => {
  it("la espera crece al doble hasta un tope", () => {
    expect(esperaSegundos(1)).toBe(30);
    expect(esperaSegundos(2)).toBe(60);
    expect(esperaSegundos(3)).toBe(120);
    expect(esperaSegundos(30)).toBe(6 * 60 * 60);
  });

  it("entrega en orden y marca enviados", async () => {
    const { tx, t } = fakeDb();
    await tx.eventoSalida.create({ data: { destino: "TALLER", tipo: "a", payload: {} } });
    await tx.eventoSalida.create({ data: { destino: "TALLER", tipo: "b", payload: {} } });
    const vistos: string[] = [];
    const r = await procesarEventos(tx, async (e) => void vistos.push(e.tipo), { ahora: new Date("2026-10-12T10:00:00Z") });
    expect(r).toEqual({ enviados: 2, reintentos: 0, fallidos: 0 });
    expect(vistos).toEqual(["a", "b"]);
    expect(t.eventoSalida.every((e) => e.estado === "ENVIADO")).toBe(true);
  });

  it("si el destino no responde, reprograma y corta el lote para no desordenar", async () => {
    const { tx, t } = fakeDb();
    await tx.eventoSalida.create({ data: { destino: "TALLER", tipo: "a", payload: {} } });
    await tx.eventoSalida.create({ data: { destino: "TALLER", tipo: "b", payload: {} } });
    const ahora = new Date("2026-10-12T10:00:00Z");
    const r = await procesarEventos(tx, async () => Promise.reject(new Error("sin conexión")), { ahora });
    expect(r).toEqual({ enviados: 0, reintentos: 1, fallidos: 0 });
    expect(t.eventoSalida[0]).toMatchObject({ estado: "PENDIENTE", intentos: 1, ultimoError: "sin conexión" });
    expect(t.eventoSalida[0].proximoIntento.getTime()).toBe(ahora.getTime() + 30_000);
    expect(t.eventoSalida[1].intentos).toBe(0);
    // Todavía no es la hora del reintento: "b" tampoco sale, para no llegar antes que "a"
    const otra = await procesarEventos(tx, async () => undefined, { ahora });
    expect(otra.enviados).toBe(0);
    // Pasada la espera salen los dos, en orden
    const vistos: string[] = [];
    const luego = await procesarEventos(tx, async (e) => void vistos.push(e.tipo), { ahora: new Date(ahora.getTime() + 31_000) });
    expect(luego.enviados).toBe(2);
    expect(vistos).toEqual(["a", "b"]);
  });

  it("tras agotar los intentos queda FALLIDO", async () => {
    const { tx, t } = fakeDb();
    await tx.eventoSalida.create({ data: { destino: "TALLER", tipo: "a", payload: {} } });
    t.eventoSalida[0].intentos = MAX_INTENTOS - 1;
    const r = await procesarEventos(tx, async () => Promise.reject(new Error("x")), { ahora: new Date() });
    expect(r.fallidos).toBe(1);
    expect(t.eventoSalida[0].estado).toBe("FALLIDO");
  });
});
