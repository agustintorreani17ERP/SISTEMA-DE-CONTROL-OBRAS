import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { areaFrontName, nextAuxiliaryCode, syncWorkFrontsFromAreas } from "../../ecms/domain/workFrontSync";

interface Area {
  id: number;
  projectId: number;
  parentId: number | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  isSystem: boolean;
  name: string;
  sortOrder?: number;
}
interface Front {
  id: number;
  projectId: number;
  name: string;
  budgetItemId: number | null;
  codigo?: string | null;
  orden?: number;
  tipo?: "AREA" | "AUXILIAR";
}

function fakeTx(items: Area[], fronts: Front[], usage: { requests?: number[]; partes?: number[] } = {}) {
  let nextId = Math.max(0, ...fronts.map((f) => f.id)) + 1;
  const tx = {
    budgetItem: {
      findMany: async ({ where }: any) =>
        items.filter(
          (i) => i.projectId === where.projectId && i.parentId === null && i.nodeKind !== "ITEM" && i.isSystem === false
        ),
    },
    workFront: {
      findMany: async ({ where }: any) => fronts.filter((f) => f.projectId === where.projectId && f.budgetItemId !== null),
      create: async ({ data }: any) => {
        const f = { id: nextId++, ...data };
        fronts.push(f);
        return f;
      },
      update: async ({ where, data }: any) => Object.assign(fronts.find((f) => f.id === where.id)!, data),
      delete: async ({ where }: any) => fronts.splice(fronts.findIndex((f) => f.id === where.id), 1)[0],
    },
    materialRequest: { count: async ({ where }: any) => ((usage.requests ?? []).includes(where.workFrontId) ? 1 : 0) },
    parteDiario: { count: async ({ where }: any) => ((usage.partes ?? []).includes(where.workFrontId) ? 1 : 0) },
    subPlanillaLinea: { count: async () => 0 },
  };
  return tx as unknown as Prisma.TransactionClient;
}

const area = (id: number, name: string, extra: Partial<Area> = {}): Area => ({
  id,
  projectId: 1,
  parentId: null,
  nodeKind: "RUBRO",
  isSystem: false,
  name,
  ...extra,
});

describe("syncWorkFrontsFromAreas", () => {
  it("crea un frente por cada rubro raíz, sin rubros de sistema, subrubros ni ítems", async () => {
    const fronts: Front[] = [];
    const items = [
      area(10, "BLOQUE A"),
      area(11, "BLOQUE B"),
      area(12, "Gastos Generales", { isSystem: true }),
      area(13, "Sub", { parentId: 10, nodeKind: "SUBRUBRO" }),
      area(14, "Partida global", { nodeKind: "ITEM" }),
    ];
    await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    expect(fronts.map((f) => [f.name, f.budgetItemId])).toEqual([
      ["BLOQUE A", 10],
      ["BLOQUE B", 11],
    ]);
  });

  it("es idempotente y renombra el frente cuando cambia el nombre del área", async () => {
    const fronts: Front[] = [{ id: 1, projectId: 1, name: "BLOQUE A", budgetItemId: 10 }];
    await syncWorkFrontsFromAreas(fakeTx([area(10, "BLOQUE A – ADMINISTRACIÓN")], fronts), 1);
    expect(fronts).toMatchObject([{ id: 1, projectId: 1, name: "BLOQUE A – ADMINISTRACIÓN", budgetItemId: 10, tipo: "AREA" }]);
  });

  it("no toca los frentes cargados a mano", async () => {
    const fronts: Front[] = [{ id: 1, projectId: 1, name: "Acceso norte", budgetItemId: null }];
    await syncWorkFrontsFromAreas(fakeTx([], fronts), 1);
    expect(fronts).toEqual([{ id: 1, projectId: 1, name: "Acceso norte", budgetItemId: null }]);
  });

  it("borra el frente de un área eliminada si no tiene uso, y solo lo desvincula si tiene partes", async () => {
    const fronts: Front[] = [
      { id: 1, projectId: 1, name: "Viejo sin uso", budgetItemId: 20 },
      { id: 2, projectId: 1, name: "Viejo con partes", budgetItemId: 21 },
    ];
    await syncWorkFrontsFromAreas(fakeTx([], fronts, { partes: [2] }), 1);
    expect(fronts).toEqual([{ id: 2, projectId: 1, name: "Viejo con partes", budgetItemId: null, tipo: "AUXILIAR" }]);
  });

  it("24 áreas → 24 frentes con código 1…24, nombre sin el prefijo y orden del presupuesto", async () => {
    const fronts: Front[] = [];
    const items = Array.from({ length: 24 }, (_, i) => area(100 + i, `Área: ${i + 1}) BLOQUE ${i + 1}`, { sortOrder: (i + 1) * 10 }));
    const r = await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    expect(r.creados).toBe(24);
    expect(fronts).toHaveLength(24);
    expect(fronts.map((f) => f.codigo)).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1)));
    expect(fronts[1]).toMatchObject({ name: "BLOQUE 2", codigo: "2", orden: 20, tipo: "AREA", budgetItemId: 101 });
  });

  it("resincronizar no duplica ni cambia nada", async () => {
    const fronts: Front[] = [];
    const items = Array.from({ length: 24 }, (_, i) => area(100 + i, `Área: ${i + 1}) BLOQUE ${i + 1}`, { sortOrder: i }));
    await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    const antes = structuredClone(fronts);
    const r = await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    expect(r).toEqual({ creados: 0, actualizados: 0, desvinculados: 0, borrados: 0 });
    expect(fronts).toEqual(antes);
  });

  it("los auxiliares sobreviven a la resincronización sin renombrarse", async () => {
    const items = [area(10, "Área: 1) OBRADOR"), area(11, "Área: 2) BLOQUE 6 - AULAS")];
    const fronts: Front[] = [];
    await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    fronts.push({ id: 50, projectId: 1, name: "Depósito central", budgetItemId: null, codigo: "3", orden: 3, tipo: "AUXILIAR" });
    await syncWorkFrontsFromAreas(fakeTx([area(11, "Área: 2) BLOQUE 6 - AULAS")], fronts), 1);
    expect(fronts.find((f) => f.id === 50)).toEqual({ id: 50, projectId: 1, name: "Depósito central", budgetItemId: null, codigo: "3", orden: 3, tipo: "AUXILIAR" });
    expect(fronts.map((f) => f.name)).toEqual(["BLOQUE 6 - AULAS", "Depósito central"]);
  });

  it("renombrar un área renombra su frente", async () => {
    const items = [area(10, "Área: 2) BLOQUE 6 - AULAS")];
    const fronts: Front[] = [];
    await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    items[0].name = "Área: 2) BLOQUE 6 - AULAS Y SANITARIOS";
    const r = await syncWorkFrontsFromAreas(fakeTx(items, fronts), 1);
    expect(r.actualizados).toBe(1);
    expect(fronts).toMatchObject([{ id: 1, name: "BLOQUE 6 - AULAS Y SANITARIOS", codigo: "2", budgetItemId: 10 }]);
  });
});

describe("areaFrontName", () => {
  it("saca el prefijo y el número del área", () => {
    expect(areaFrontName("Área: 2) BLOQUE 6 - AULAS")).toEqual({ codigo: "2", nombre: "BLOQUE 6 - AULAS" });
    expect(areaFrontName("AREA 14) PCI")).toEqual({ codigo: "14", nombre: "PCI" });
    expect(areaFrontName("BLOQUE A")).toEqual({ codigo: null, nombre: "BLOQUE A" });
  });
});

describe("nextAuxiliaryCode", () => {
  it("mayor código numérico + 1", () => {
    expect(nextAuxiliaryCode(Array.from({ length: 24 }, (_, i) => String(i + 1)))).toBe("25");
    expect(nextAuxiliaryCode(["1", "25", null, "X"])).toBe("26");
    expect(nextAuxiliaryCode([])).toBe("1");
  });
});
