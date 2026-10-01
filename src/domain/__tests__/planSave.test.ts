import { describe, expect, it } from "vitest";
import { guardarPlan, type PlanLinea } from "../planSave";

/** Fake de Prisma con lo único que toca guardarPlan: avancePlanificado (findMany, deleteMany, createMany). */
function fakeTx(inicial: { projectId: number; budgetItemId: number; fecha: string; cantidad: number }[] = []) {
  let nextId = 1;
  let rows = inicial.map((r) => ({ id: nextId++, ...r, fecha: new Date(`${r.fecha}T00:00:00Z`) }));
  const tx = {
    avancePlanificado: {
      findMany: async ({ where }: any) =>
        rows.filter((r) => r.projectId === where.projectId && (!where.budgetItemId || where.budgetItemId.in.includes(r.budgetItemId))),
      deleteMany: async ({ where }: any) => {
        const antes = rows.length;
        rows = where.id ? rows.filter((r) => !where.id.in.includes(r.id)) : rows.filter((r) => r.projectId !== where.projectId);
        return { count: antes - rows.length };
      },
      createMany: async ({ data }: any) => {
        for (const d of data) rows.push({ id: nextId++, ...d });
        return { count: data.length };
      },
    },
  };
  const del = (projectId: number) =>
    rows
      .filter((r) => r.projectId === projectId)
      .map((r) => `${r.budgetItemId}|${r.fecha.toISOString().slice(0, 10)}|${r.cantidad}`)
      .sort();
  return { tx: tx as any, del };
}

const plan: PlanLinea[] = [
  { budgetItemId: 1, fecha: "2026-10-31", cantidad: 10 },
  { budgetItemId: 1, fecha: "2026-11-30", cantidad: 20 },
  { budgetItemId: 2, fecha: "2026-10-31", cantidad: 5 },
];

describe("guardarPlan", () => {
  it("REEMPLAZAR dos veces el mismo cronograma no duplica", async () => {
    const { tx, del } = fakeTx();
    expect(await guardarPlan(tx, 4, "REEMPLAZAR", plan)).toBe(3);
    expect(await guardarPlan(tx, 4, "REEMPLAZAR", plan)).toBe(3);
    expect(del(4)).toEqual(["1|2026-10-31|10", "1|2026-11-30|20", "2|2026-10-31|5"]);
  });

  it("COMBINAR dos veces el mismo cronograma no duplica", async () => {
    const { tx, del } = fakeTx();
    await guardarPlan(tx, 4, "COMBINAR", plan);
    await guardarPlan(tx, 4, "COMBINAR", plan);
    expect(del(4)).toHaveLength(3);
  });

  it("REEMPLAZAR borra lo anterior de la obra, no de otras obras", async () => {
    const { tx, del } = fakeTx([
      { projectId: 4, budgetItemId: 9, fecha: "2026-09-30", cantidad: 1 },
      { projectId: 8, budgetItemId: 9, fecha: "2026-09-30", cantidad: 1 },
    ]);
    await guardarPlan(tx, 4, "REEMPLAZAR", plan);
    expect(del(4)).not.toContain("9|2026-09-30|1");
    expect(del(8)).toEqual(["9|2026-09-30|1"]);
  });

  it("COMBINAR pisa solo el ítem + período cargados y conserva el resto", async () => {
    const { tx, del } = fakeTx([
      { projectId: 4, budgetItemId: 1, fecha: "2026-10-31", cantidad: 99 },
      { projectId: 4, budgetItemId: 1, fecha: "2026-12-31", cantidad: 7 },
      { projectId: 4, budgetItemId: 3, fecha: "2026-10-31", cantidad: 4 },
    ]);
    await guardarPlan(tx, 4, "COMBINAR", [{ budgetItemId: 1, fecha: "2026-10-31", cantidad: 10 }]);
    expect(del(4)).toEqual(["1|2026-10-31|10", "1|2026-12-31|7", "3|2026-10-31|4"]);
  });

  it("cantidad 0 en COMBINAR borra ese período y no se guarda", async () => {
    const { tx, del } = fakeTx([
      { projectId: 4, budgetItemId: 1, fecha: "2026-10-31", cantidad: 10 },
      { projectId: 4, budgetItemId: 1, fecha: "2026-11-30", cantidad: 20 },
    ]);
    const n = await guardarPlan(tx, 4, "COMBINAR", [{ budgetItemId: 1, fecha: "2026-10-31", cantidad: 0 }]);
    expect(n).toBe(0);
    expect(del(4)).toEqual(["1|2026-11-30|20"]);
  });

  it("un ítem + período repetido en lo pegado se guarda una vez (gana el último)", async () => {
    const { tx, del } = fakeTx();
    const n = await guardarPlan(tx, 4, "REEMPLAZAR", [
      { budgetItemId: 1, fecha: "2026-10-31", cantidad: 10 },
      { budgetItemId: 1, fecha: "2026-10-31", cantidad: 12 },
    ]);
    expect(n).toBe(1);
    expect(del(4)).toEqual(["1|2026-10-31|12"]);
  });

  it("guarda la fecha como día (medianoche UTC)", async () => {
    const { tx } = fakeTx();
    const rows: any[] = [];
    tx.avancePlanificado.createMany = async ({ data }: any) => (rows.push(...data), { count: data.length });
    await guardarPlan(tx, 4, "REEMPLAZAR", [{ budgetItemId: 1, fecha: "2026-10-31", cantidad: 1 }]);
    expect(rows[0].fecha.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
});
