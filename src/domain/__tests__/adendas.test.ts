import { describe, expect, it } from "vitest";
import { fakeDb, rows } from "./fakeDb";
import {
  actualizarAdendaBorrador,
  anularAdenda,
  aprobarAdenda,
  congelarPresupuesto,
  crearAdenda,
  eliminarAdendaBorrador,
  recalcularVigente,
} from "../../ecms/domain/adendas";

/** Obra con un rubro (A) y un ítem (1.1: 100 m3 × 11.000 Gs = 1.100.000), congelado como contrato original. */
function obra(opts: { congelado?: boolean; certificado?: number } = {}) {
  const congelado = opts.congelado ?? true;
  return fakeDb({
    project: [{ id: 1, name: "Obra", code: "OB-1", presupuestoCongeladoAt: congelado ? new Date("2026-09-01") : null, montoPresupuestoBase: 0, montoRealActualizado: 0, totalGastado: 0 }],
    budgetItem: [
      { id: 10, projectId: 1, parentId: null, code: "A", name: "Obra civil", category: "Obra civil", path: "A", hierarchyLevel: 0, nodeKind: "RUBRO", isSystem: false, sortOrder: 1, unit: null, totalQuantity: 0, unitPrice: 0, originalAmount: 0, contractQuantity: 0, contractAmount: 0, isExtra: false, costActualAmount: 0, certifiedQuantity: 0 },
      { id: 11, projectId: 1, parentId: 10, code: "1.1", name: "Excavación", category: "Obra civil", path: "A/1.1", hierarchyLevel: 1, nodeKind: "ITEM", isSystem: false, sortOrder: 2, unit: "m3", totalQuantity: 100, unitPrice: 11_000, originalAmount: 1_100_000, contractQuantity: 100, contractAmount: 1_100_000, isExtra: false, costActualAmount: 0, certifiedQuantity: opts.certificado ?? 0 },
    ],
  });
}

const variacion = (delta: number) => ({ tipo: "VARIACION" as const, budgetItemId: 11, deltaQuantity: delta });
const nueva = (lineas: any[], titulo = "Adenda de prueba") => ({ titulo, fecha: "2026-10-05", lineas });
const item11 = (db: any) => rows(db, "budgetItem").find((i) => i.id === 11)!;

describe("congelar el presupuesto", () => {
  it("copia cantidad y monto al contrato original, una sola vez", async () => {
    const db = obra({ congelado: false });
    const r = await congelarPresupuesto(db, 1);
    expect(r.items).toBe(1);
    expect(item11(db)).toMatchObject({ contractQuantity: 100, contractAmount: 1_100_000 });
    expect(rows(db, "project")[0].presupuestoCongeladoAt).toBeInstanceOf(Date);
    await expect(congelarPresupuesto(db, 1)).rejects.toMatchObject({ code: "ALREADY_FROZEN" });
  });

  it("no se cargan adendas con el presupuesto sin congelar", async () => {
    const db = obra({ congelado: false });
    await expect(crearAdenda(db, 1, nueva([variacion(5)]))).rejects.toMatchObject({ code: "NOT_FROZEN" });
  });
});

describe("adendas que cambian cantidades", () => {
  it("aprobar una variación: la real cambia, el contrato queda y el precio no cambia", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([variacion(20)]));
    expect(a.numero).toBe(1);
    expect(item11(db).totalQuantity).toBe(100);
    await aprobarAdenda(db, a.id);
    expect(item11(db)).toMatchObject({ totalQuantity: 120, originalAmount: 1_320_000, contractQuantity: 100, contractAmount: 1_100_000, unitPrice: 11_000 });
    expect(rows(db, "adenda")[0].estado).toBe("APROBADA");
    expect({ base: Number(rows(db, "project")[0].montoPresupuestoBase), real: Number(rows(db, "project")[0].montoRealActualizado) }).toEqual({ base: 1_100_000, real: 1_320_000 });
  });

  it("las adendas se numeran por obra y se suman (incluida una deducción)", async () => {
    const db = obra();
    const a1 = await crearAdenda(db, 1, nueva([variacion(20)]));
    const a2 = await crearAdenda(db, 1, nueva([variacion(-30)], "Deducción"));
    expect([a1.numero, a2.numero]).toEqual([1, 2]);
    await aprobarAdenda(db, a1.id);
    await aprobarAdenda(db, a2.id);
    expect(item11(db).totalQuantity).toBe(90);
    expect(item11(db).originalAmount).toBe(990_000);
  });

  it("no deja bajar la cantidad real por debajo de lo ya ejecutado", async () => {
    const db = obra({ certificado: 90 });
    const a = await crearAdenda(db, 1, nueva([variacion(-20)]));
    await expect(aprobarAdenda(db, a.id)).rejects.toMatchObject({ code: "ADENDA_BAJO_EJECUTADO", status: 409 });
    expect(item11(db).totalQuantity).toBe(100);
    expect(rows(db, "adenda")[0].estado).toBe("BORRADOR");
  });

  it("no permite una cantidad real negativa", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([variacion(-101)]));
    await expect(aprobarAdenda(db, a.id)).rejects.toMatchObject({ code: "ADENDA_BAJO_EJECUTADO" });
  });

  it("anular recalcula sin esa adenda, salvo que lo ejecutado dependa de ella", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([variacion(20)]));
    await aprobarAdenda(db, a.id);
    await db.budgetItem.update({ where: { id: 11 }, data: { certifiedQuantity: 110 } });
    await expect(anularAdenda(db, a.id)).rejects.toMatchObject({ code: "ADENDA_BAJO_EJECUTADO" });
    expect(item11(db).totalQuantity).toBe(120);
    await db.budgetItem.update({ where: { id: 11 }, data: { certifiedQuantity: 50 } });
    await anularAdenda(db, a.id);
    expect(item11(db)).toMatchObject({ totalQuantity: 100, originalAmount: 1_100_000 });
    expect(rows(db, "adenda")[0].estado).toBe("ANULADA");
    expect(Number(rows(db, "project")[0].montoRealActualizado)).toBe(1_100_000);
  });

  it("solo se edita o borra un borrador", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([variacion(5)]));
    await actualizarAdendaBorrador(db, a.id, nueva([variacion(8)], "Editada"));
    expect(rows(db, "adendaLinea").map((l) => l.deltaQuantity)).toEqual([8]);
    await aprobarAdenda(db, a.id);
    await expect(actualizarAdendaBorrador(db, a.id, nueva([variacion(1)]))).rejects.toMatchObject({ code: "ADENDA_NO_EDITABLE" });
    await expect(eliminarAdendaBorrador(db, a.id)).rejects.toMatchObject({ code: "ADENDA_NO_EDITABLE" });
    await expect(aprobarAdenda(db, a.id)).rejects.toMatchObject({ code: "ADENDA_ESTADO" });
  });

  it("valida las líneas: cantidad distinta de 0, ítem de la obra, no un rubro", async () => {
    const db = obra();
    await expect(crearAdenda(db, 1, nueva([variacion(0)]))).rejects.toMatchObject({ code: "ADENDA_LINEA" });
    await expect(crearAdenda(db, 1, nueva([{ tipo: "VARIACION", budgetItemId: 10, deltaQuantity: 5 }]))).rejects.toMatchObject({ code: "ADENDA_LINEA" });
    await expect(crearAdenda(db, 1, nueva([]))).rejects.toMatchObject({ code: "ADENDA_VACIA" });
  });
});

describe("adendas que suman ítems extra", () => {
  const extra = { tipo: "EXTRA" as const, deltaQuantity: 10, codigo: "E1", nombre: "Muro extra", unidad: "m2", parentId: 10, precioUnitario: 5_000 };

  it("aprobar crea el ítem con contrato 0 y su cantidad inicial", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([extra]));
    await aprobarAdenda(db, a.id);
    const e = rows(db, "budgetItem").find((i) => i.code === "E1")!;
    expect(e).toMatchObject({ isExtra: true, origenAdendaId: a.id, contractQuantity: 0, contractAmount: 0, totalQuantity: 10, unitPrice: 5_000, originalAmount: 50_000, path: "A/E1", nodeKind: "ITEM" });
    expect(rows(db, "adendaLinea")[0].budgetItemId).toBe(e.id);
    expect({ base: Number(rows(db, "project")[0].montoPresupuestoBase), real: Number(rows(db, "project")[0].montoRealActualizado) }).toEqual({ base: 1_100_000, real: 1_150_000 });
  });

  it("anular borra el extra si nadie lo usa", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([extra]));
    await aprobarAdenda(db, a.id);
    await anularAdenda(db, a.id);
    expect(rows(db, "budgetItem").find((i) => i.code === "E1")).toBeUndefined();
    expect(Number(rows(db, "project")[0].montoRealActualizado)).toBe(1_100_000);
  });

  it("anular deja el extra en 0 si ya tiene documentos", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([extra]));
    await aprobarAdenda(db, a.id);
    const e = rows(db, "budgetItem").find((i) => i.code === "E1")!;
    await db.budgetMovement.create({ data: { projectId: 1, budgetItemId: e.id, amount: 1 } });
    await anularAdenda(db, a.id);
    expect(rows(db, "budgetItem").find((i) => i.code === "E1")).toMatchObject({ totalQuantity: 0, originalAmount: 0 });
  });

  it("rechaza un código repetido en el rubro", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([{ ...extra, codigo: "1.1" }]));
    await expect(aprobarAdenda(db, a.id)).rejects.toMatchObject({ code: "DUPLICATE_CODE" });
  });

  it("valida el extra: precio y rubro obligatorios, cantidad positiva", async () => {
    const db = obra();
    await expect(crearAdenda(db, 1, nueva([{ ...extra, precioUnitario: null }]))).rejects.toMatchObject({ code: "ADENDA_LINEA" });
    await expect(crearAdenda(db, 1, nueva([{ ...extra, parentId: null }]))).rejects.toMatchObject({ code: "ADENDA_LINEA" });
    await expect(crearAdenda(db, 1, nueva([{ ...extra, deltaQuantity: -3 }]))).rejects.toMatchObject({ code: "ADENDA_LINEA" });
  });
});

describe("recalcularVigente", () => {
  it("rehace el caché desde el contrato y las adendas aprobadas (idempotente)", async () => {
    const db = obra();
    const a = await crearAdenda(db, 1, nueva([variacion(7)]));
    await aprobarAdenda(db, a.id);
    await db.budgetItem.update({ where: { id: 11 }, data: { totalQuantity: 999, originalAmount: 1 } });
    await recalcularVigente(db, 1);
    await recalcularVigente(db, 1);
    expect(item11(db)).toMatchObject({ totalQuantity: 107, originalAmount: 1_177_000 });
  });
});
