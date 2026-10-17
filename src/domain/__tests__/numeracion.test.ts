import { describe, expect, it } from "vitest";
import { asignarNumero, formatNumeroDoc, sembrarSecuencia } from "../../core/domain/numeracion";

type Row = Record<string, any>;

/** Prisma en memoria: solo secuenciaDocumento y numeroAsignado, con sus llaves compuestas. */
function fakeTx() {
  const secuencias: Row[] = [];
  const asignados: Row[] = [];
  let id = 0;
  const seqMatch = (r: Row, w: Row) => r.tipo === w.tipo_anio.tipo && r.anio === w.tipo_anio.anio;
  const tx = {
    secuenciaDocumento: {
      findUnique: async ({ where }: Row) => secuencias.find((r) => seqMatch(r, where)) ?? null,
      create: async ({ data }: Row) => {
        const row = { ...data };
        secuencias.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = secuencias.find((r) => seqMatch(r, where))!;
        Object.assign(row, data);
        return row;
      },
      upsert: async ({ where, create, update }: Row) => {
        const row = secuencias.find((r) => seqMatch(r, where));
        if (row) {
          row.siguiente += update.siguiente.increment;
          return row;
        }
        const nuevo = { ...create };
        secuencias.push(nuevo);
        return nuevo;
      },
    },
    numeroAsignado: {
      findUnique: async ({ where }: Row) => {
        const w = where.tipo_sistema_externalId;
        return asignados.find((r) => r.tipo === w.tipo && r.sistema === w.sistema && r.externalId === w.externalId) ?? null;
      },
      create: async ({ data }: Row) => {
        if (asignados.some((r) => r.tipo === data.tipo && r.anio === data.anio && r.numero === data.numero)) {
          throw new Error("número duplicado");
        }
        const row = { id: ++id, ...data };
        asignados.push(row);
        return row;
      },
    },
  } as any;
  return { tx, secuencias, asignados };
}

const f = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("asignarNumero", () => {
  it("es correlativo por tipo y año, compartido entre sistemas", async () => {
    const { tx } = fakeTx();
    const a = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-01"), sistema: "ERP", externalId: "a" });
    const b = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-02"), sistema: "TALLER", externalId: "b" });
    const c = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-03"), sistema: "ECMS", externalId: "c" });
    expect([a.numero, b.numero, c.numero]).toEqual([1, 2, 3]);
    expect(formatNumeroDoc(c)).toBe("3/2026");
  });

  it("lleva una secuencia aparte por tipo", async () => {
    const { tx } = fakeTx();
    await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-01"), sistema: "ERP", externalId: "a" });
    const ne = await asignarNumero(tx, { tipo: "NE", fecha: f("2026-03-01"), sistema: "ERP", externalId: "a" });
    expect(ne).toEqual({ anio: 2026, numero: 1 });
  });

  it("reinicia al cambiar de año", async () => {
    const { tx } = fakeTx();
    await asignarNumero(tx, { tipo: "SF", fecha: f("2026-12-30"), sistema: "ERP", externalId: "a" });
    await asignarNumero(tx, { tipo: "SF", fecha: f("2026-12-31"), sistema: "ERP", externalId: "b" });
    const nuevo = await asignarNumero(tx, { tipo: "SF", fecha: f("2027-01-02"), sistema: "ERP", externalId: "c" });
    expect(nuevo).toEqual({ anio: 2027, numero: 1 });
  });

  it("devuelve el mismo número si se pide dos veces para el mismo documento", async () => {
    const { tx, asignados } = fakeTx();
    const a = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-01"), sistema: "TALLER", externalId: "uuid-1" });
    const otra = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-03-05"), sistema: "TALLER", externalId: "uuid-1" });
    expect(otra).toEqual(a);
    expect(asignados).toHaveLength(1);
  });
});

describe("sembrarSecuencia", () => {
  it("arranca después del último número del Taller", async () => {
    const { tx } = fakeTx();
    await sembrarSecuencia(tx, "SF", 2026, 384);
    const n = await asignarNumero(tx, { tipo: "SF", fecha: f("2026-10-01"), sistema: "ERP", externalId: "x" });
    expect(n.numero).toBe(385);
  });

  it("nunca baja una secuencia que ya avanzó", async () => {
    const { tx, secuencias } = fakeTx();
    await sembrarSecuencia(tx, "SF", 2026, 100);
    await sembrarSecuencia(tx, "SF", 2026, 10);
    expect(secuencias[0].siguiente).toBe(101);
  });

  it("rechaza un último número inválido", async () => {
    const { tx } = fakeTx();
    await expect(sembrarSecuencia(tx, "SF", 2026, -1)).rejects.toThrow();
  });
});
