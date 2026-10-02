import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { syncWorkFrontsFromAreas } from "../workFrontSync";

interface Area {
  id: number;
  projectId: number;
  parentId: number | null;
  nodeKind: "RUBRO" | "SUBRUBRO" | "ITEM";
  isSystem: boolean;
  name: string;
}
interface Front {
  id: number;
  projectId: number;
  name: string;
  budgetItemId: number | null;
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
    expect(fronts).toEqual([{ id: 1, projectId: 1, name: "BLOQUE A – ADMINISTRACIÓN", budgetItemId: 10 }]);
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
    expect(fronts).toEqual([{ id: 2, projectId: 1, name: "Viejo con partes", budgetItemId: null }]);
  });
});
