import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  acumuladoPorLinea,
  contextoItems,
  lineasSinRubro,
  mensajeLineasSinRubro,
  normalizeText,
  normalizeUnit,
  numeroLinea,
  siguienteCorrelativo,
  similarity,
  sugerirRubro,
  type ItemRef,
} from "../../ecms/domain/asignacionMO";
import { assertSinLineasPendientes, resolverLinea } from "../../ecms/domain/subPlanilla";

describe("normalización de texto y unidades", () => {
  it("H°A°, HºAº, HoAo y hormigón armado son lo mismo; quita «Ejecución de»", () => {
    for (const t of ["Losa de H°A°", "Losa de HºAº", "Losa de HoAo", "Ejecución de losa de hormigón armado"]) {
      expect(normalizeText(t)).toBe("losa de hormigon armado");
    }
  });
  it("m² = m2, m = ml", () => {
    expect(normalizeUnit("m²")).toBe(normalizeUnit("m2"));
    expect(normalizeUnit("m")).toBe(normalizeUnit("ml"));
    expect(normalizeUnit("m3")).not.toBe(normalizeUnit("m2"));
  });
  it("similarity reconoce descripciones parecidas", () => {
    expect(similarity("Ejecución de viga de HºAº", "Vigas de hormigón armado")).toBeGreaterThan(0);
    expect(similarity("Revoque interior", "Pintura exterior")).toBe(0);
  });
});

describe("numeración por frente", () => {
  it("numero = <código del frente>.<correlativo>, correlativo siguiente del contratista en el frente", () => {
    expect(siguienteCorrelativo([])).toBe(1);
    expect(siguienteCorrelativo([1, 2, 5])).toBe(6);
    expect(numeroLinea("2", 3)).toBe("2.3");
  });
});

describe("contexto de ítems (capítulo/planta)", () => {
  it("distingue códigos repetidos dentro de un Área", () => {
    const ctx = contextoItems([
      { id: 1, parentId: null, code: "A2", name: "Área: 2) BLOQUE 6" },
      { id: 2, parentId: 1, code: "PB", name: "PLANTA BAJA" },
      { id: 3, parentId: 1, code: "PA", name: "PLANTA ALTA" },
      { id: 4, parentId: 2, code: "3.3", name: "Mampostería" },
      { id: 5, parentId: 3, code: "3.3", name: "Mampostería" },
    ]);
    expect(ctx.get(4)).toEqual({ areaId: 1, capitulo: "PLANTA BAJA" });
    expect(ctx.get(5)).toEqual({ areaId: 1, capitulo: "PLANTA ALTA" });
  });
});

describe("sugerirRubro", () => {
  const frente = { id: 10, tipo: "AREA" as const, budgetItemId: 1 };
  const lp = { id: 7, description: "Ejecución de losa de HºAº", unit: "m2" };
  const items: ItemRef[] = [
    { id: 100, code: "3.1", name: "Losa de hormigón armado", unit: "m²", areaId: 1 },
    { id: 101, code: "3.2", name: "Losa de hormigón armado", unit: "m3", areaId: 1 },
    { id: 102, code: "3.3", name: "Revoques", unit: "m2", areaId: 1 },
    { id: 200, code: "3.1", name: "Losa de hormigón armado", unit: "m2", areaId: 2 },
  ];

  it("1) memoria: la última línea del mismo frente + rubro MO (de cualquier contratista)", () => {
    const r = sugerirRubro(frente, lp, items, [
      { id: 1, workFrontId: 10, laborPriceId: 7, budgetItemId: 100 },
      { id: 5, workFrontId: 10, laborPriceId: 7, budgetItemId: 102 },
      { id: 9, workFrontId: 11, laborPriceId: 7, budgetItemId: 200 },
    ]);
    expect(r.sugerido).toMatchObject({ budgetItemId: 102, motivo: "MEMORIA" });
  });

  it("2) parecido con unidad compatible del área; 3) resto del área sin preseleccionar", () => {
    const r = sugerirRubro(frente, lp, items, []);
    expect(r.sugerido).toMatchObject({ budgetItemId: 100, motivo: "SIMILAR" });
    expect(r.candidatos.map((c) => c.budgetItemId)).toEqual([100, 101, 102]);
    expect(r.candidatos.find((c) => c.budgetItemId === 101)?.motivo).toBe("AREA");
    expect(r.candidatos.some((c) => c.budgetItemId === 200)).toBe(false);

    const sinParecido = sugerirRubro(frente, { id: 8, description: "Colocación de cerámica", unit: "m2" }, items, []);
    expect(sinParecido.sugerido).toBeNull();
  });

  it("4) frente auxiliar → Gastos generales", () => {
    const r = sugerirRubro({ id: 30, tipo: "AUXILIAR", budgetItemId: null }, lp, items, [], { gastosGeneralesId: 900 });
    expect(r.sugerido).toMatchObject({ budgetItemId: 900, motivo: "GASTOS_GENERALES" });
  });
});

describe("acumulados por línea", () => {
  it("acumulado por planillaLineaId", () => {
    const m = acumuladoPorLinea([
      { planillaLineaId: 1, cantidad: 3 },
      { planillaLineaId: 1, cantidad: 2 },
      { planillaLineaId: 2, cantidad: 4 },
      { planillaLineaId: null, cantidad: 9 },
    ]);
    expect(m.get(1)).toBe(5);
    expect(m.get(2)).toBe(4);
  });
  it("aprobar con líneas sin rubro falla y lista los N°", () => {
    const pendientes = lineasSinRubro([
      { budgetItemId: 5, numero: "2.1" },
      { budgetItemId: null, numero: "2.2" },
      { budgetItemId: null, numero: "25.1" },
    ]);
    expect(pendientes).toEqual(["2.2", "25.1"]);
    expect(() => assertSinLineasPendientes(pendientes, mensajeLineasSinRubro(pendientes))).toThrow(/2\.2, 25\.1/);
    expect(() => assertSinLineasPendientes([], "")).not.toThrow();
  });
});

/** Base en memoria con lo que usa resolverLinea. */
function fakeTx() {
  const lineas: any[] = [];
  const fronts = [
    { id: 10, projectId: 1, codigo: "2" },
    { id: 11, projectId: 1, codigo: "25" },
  ];
  const prices = [
    { id: 7, projectId: 1 },
    { id: 8, projectId: 1 },
  ];
  const match = (l: any, where: any) => Object.entries(where).every(([k, v]) => l[k] === v);
  const tx = {
    workFront: { findUnique: async ({ where }: any) => fronts.find((f) => f.id === where.id) ?? null },
    laborPrice: { findUnique: async ({ where }: any) => prices.find((p) => p.id === where.id) ?? null },
    subPlanillaLinea: {
      findFirst: async ({ where }: any) => lineas.find((l) => match(l, where)) ?? null,
      findUnique: async ({ where }: any) => lineas.find((l) => l.id === where.id) ?? null,
      findMany: async ({ where }: any) => lineas.filter((l) => match(l, where)),
      create: async ({ data }: any) => {
        const l = { id: lineas.length + 1, ...data };
        lineas.push(l);
        return l;
      },
      update: async ({ where, data }: any) => Object.assign(lineas.find((l) => l.id === where.id), data),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, lineas };
}

describe("resolverLinea", () => {
  it("numera por (contratista, frente) y reutiliza la misma combinación entre certificados", async () => {
    const { tx } = fakeTx();
    const a = await resolverLinea(tx, 1, 50, { workFrontId: 10, laborPriceId: 7, budgetItemId: 100 });
    const b = await resolverLinea(tx, 1, 50, { workFrontId: 10, laborPriceId: 8, budgetItemId: 100 });
    const c = await resolverLinea(tx, 1, 50, { workFrontId: 11, laborPriceId: 7, budgetItemId: 300 });
    const otro = await resolverLinea(tx, 1, 60, { workFrontId: 10, laborPriceId: 7, budgetItemId: 100 });
    expect([a.numero, b.numero, c.numero, otro.numero]).toEqual(["2.1", "2.2", "25.1", "2.1"]);

    // Certificado siguiente: misma combinación → misma línea y número
    const again = await resolverLinea(tx, 1, 50, { workFrontId: 10, laborPriceId: 7, budgetItemId: 100 });
    expect(again.id).toBe(a.id);
    expect(again.numero).toBe("2.1");
  });

  it("una línea sin rubro conserva su número al asignarse", async () => {
    const { tx } = fakeTx();
    const borrador = await resolverLinea(tx, 1, 50, { workFrontId: 10, laborPriceId: 7, budgetItemId: null });
    const asignada = await resolverLinea(tx, 1, 50, { planillaLineaId: borrador.id, workFrontId: 10, laborPriceId: 7, budgetItemId: 100 });
    expect(asignada.id).toBe(borrador.id);
    expect(asignada.numero).toBe("2.1");
  });
});
