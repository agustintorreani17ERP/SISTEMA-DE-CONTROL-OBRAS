/**
 * Prisma falso en memoria para tests de dominio que cruzan varias tablas (cierres, facturación,
 * libro mayor, stock). Cubre lo que usa el dominio: where con in/not/rangos/OR/AND, orderBy,
 * include/select de relaciones, create anidado, increment, upsert, aggregate _sum y $transaction.
 * No es el simulador de src/lib/prisma.ts (ese persiste en mock-db-store.json).
 */

type Row = Record<string, any>;

/** Relaciones a muchos (o uno a uno inversas) que no se deducen de un campo `<nombre>Id`. */
const RELACIONES: Record<string, { table: string; fk: string; many: boolean }> = {
  "cierrePeriodo.factura": { table: "invoice", fk: "cierreId", many: false },
  "certification.items": { table: "certificationItem", fk: "certificationId", many: true },
  "certification.invoices": { table: "invoice", fk: "certificationId", many: true },
  "invoice.items": { table: "invoiceItem", fk: "invoiceId", many: true },
  "asiento.lineas": { table: "lineaAsiento", fk: "asientoId", many: true },
};

const norm = (v: any) => (v instanceof Date ? v.getTime() : v && typeof v === "object" && typeof v.toNumber === "function" ? v.toNumber() : v);
const OPS = ["in", "notIn", "not", "gte", "gt", "lte", "lt", "equals"];

function matchValue(actual: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return actual === null || actual === undefined;
  if (cond instanceof Date || typeof cond !== "object" || typeof cond.toNumber === "function") return norm(actual) === norm(cond);
  if (!Object.keys(cond).some((k) => OPS.includes(k))) return true; // filtro de relación: no se resuelve
  const a = norm(actual);
  if ("equals" in cond && a !== norm(cond.equals)) return false;
  if ("in" in cond && !cond.in.map(norm).includes(a)) return false;
  if ("notIn" in cond && cond.notIn.map(norm).includes(a)) return false;
  if ("not" in cond && (cond.not === null ? actual === null || actual === undefined : matchValue(actual, cond.not))) return false;
  if ("gte" in cond && !(a >= norm(cond.gte))) return false;
  if ("gt" in cond && !(a > norm(cond.gt))) return false;
  if ("lte" in cond && !(a <= norm(cond.lte))) return false;
  if ("lt" in cond && !(a < norm(cond.lt))) return false;
  return true;
}

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "OR") return v.length === 0 || v.some((w: any) => matches(row, w));
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w: any) => matches(row, w));
    if (k === "NOT") return !(Array.isArray(v) ? v : [v]).some((w: any) => matches(row, w));
    // clave compuesta: { projectId_materialId: { projectId, materialId } }
    if (k.includes("_") && v && typeof v === "object" && !Object.keys(v).some((x) => OPS.includes(x)) && !(v instanceof Date)) return matches(row, v);
    return matchValue(row[k], v);
  });
}

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  const ids: Record<string, number> = {};
  const t = (name: string) => (tables[name] ??= []);
  const nextId = (name: string) => (ids[name] = Math.max(ids[name] ?? 0, ...t(name).map((r) => r.id ?? 0)) + 1);

  function attach(table: string, row: Row, spec: any): Row {
    if (!spec || typeof spec !== "object") return row;
    const out = { ...row };
    for (const [key, sub] of Object.entries<any>(spec)) {
      if (!sub) continue;
      const rel = RELACIONES[`${table}.${key}`];
      const subSpec = sub === true ? undefined : sub.include ?? sub.select;
      if (rel) {
        const kids = t(rel.table).filter((r) => r[rel.fk] === row.id && matches(r, sub?.where));
        out[key] = rel.many ? kids.map((k) => attach(rel.table, k, subSpec)) : kids[0] ? attach(rel.table, kids[0], subSpec) : null;
      } else if (`${key}Id` in row) {
        const parent = t(key).find((r) => r.id === row[`${key}Id`]);
        out[key] = parent ? attach(key, parent, subSpec) : null;
      }
    }
    return out;
  }

  function sortRows(rows: Row[], orderBy: any) {
    const list = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o: any) => Object.entries(o));
    return [...rows].sort((a, b) => {
      for (const [f, dir] of list as [string, string][]) {
        const x = norm(a[f]);
        const y = norm(b[f]);
        if (x < y) return dir === "desc" ? 1 : -1;
        if (x > y) return dir === "desc" ? -1 : 1;
      }
      return 0;
    });
  }

  function insert(table: string, data: Row): Row {
    const row: Row = { createdAt: new Date(), updatedAt: new Date() };
    const nested: [string, any][] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "create" in v && RELACIONES[`${table}.${k}`]) nested.push([k, v.create]);
      else row[k] = v;
    }
    row.id ??= nextId(table);
    t(table).push(row);
    for (const [k, create] of nested) {
      const rel = RELACIONES[`${table}.${k}`];
      for (const c of Array.isArray(create) ? create : [create]) insert(rel.table, { ...c, [rel.fk]: row.id });
    }
    return row;
  }

  function apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in v) row[k] = Number(norm(row[k]) ?? 0) + Number(norm(v.increment));
      else if (v && typeof v === "object" && "decrement" in v) row[k] = Number(norm(row[k]) ?? 0) - Number(norm(v.decrement));
      else row[k] = v;
    }
    row.updatedAt = new Date();
    return row;
  }

  const model = (table: string) => ({
    findMany: async (a: any = {}) => {
      let rows = sortRows(t(table).filter((r) => matches(r, a.where)), a.orderBy);
      if (a.take) rows = rows.slice(0, a.take);
      return rows.map((r) => attach(table, r, a.include ?? a.select));
    },
    findFirst: async (a: any = {}) => {
      const r = sortRows(t(table).filter((x) => matches(x, a.where)), a.orderBy)[0];
      return r ? attach(table, r, a.include ?? a.select) : null;
    },
    findUnique: async (a: any) => {
      const r = t(table).find((x) => matches(x, a.where));
      return r ? attach(table, r, a.include ?? a.select) : null;
    },
    findUniqueOrThrow: async (a: any) => {
      const r = t(table).find((x) => matches(x, a.where));
      if (!r) throw new Error(`${table} no encontrado`);
      return attach(table, r, a.include ?? a.select);
    },
    count: async (a: any = {}) => t(table).filter((r) => matches(r, a.where)).length,
    create: async (a: any) => attach(table, insert(table, a.data), a.include ?? a.select),
    createMany: async (a: any) => {
      for (const d of a.data) insert(table, d);
      return { count: a.data.length };
    },
    update: async (a: any) => {
      const r = t(table).find((x) => matches(x, a.where));
      if (!r) throw new Error(`${table} a actualizar no existe`);
      return attach(table, apply(r, a.data), a.include ?? a.select);
    },
    updateMany: async (a: any) => {
      const rows = t(table).filter((x) => matches(x, a.where));
      rows.forEach((r) => apply(r, a.data));
      return { count: rows.length };
    },
    upsert: async (a: any) => {
      const r = t(table).find((x) => matches(x, a.where));
      return r ? apply(r, a.update) : insert(table, a.create);
    },
    delete: async (a: any) => {
      const r = t(table).find((x) => matches(x, a.where));
      if (!r) throw new Error(`${table} a borrar no existe`);
      tables[table] = t(table).filter((x) => x !== r);
      return r;
    },
    deleteMany: async (a: any = {}) => {
      const before = t(table).length;
      tables[table] = t(table).filter((x) => !matches(x, a.where));
      return { count: before - t(table).length };
    },
    aggregate: async (a: any) => {
      const rows = t(table).filter((r) => matches(r, a.where));
      const _sum: Row = {};
      for (const f of Object.keys(a._sum ?? {})) _sum[f] = rows.length ? rows.reduce((s, r) => s + Number(norm(r[f]) ?? 0), 0) : null;
      return { _sum };
    },
  });

  for (const [name, rows] of Object.entries(seed)) for (const r of rows) insert(name, r);

  const db: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "__tables") return tables;
        if (prop === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(db) : Promise.all(fn));
        return model(prop);
      },
    }
  );
  return db as any;
}

/** Filas de una tabla del fake (para los asserts). */
export const rows = (db: any, table: string): Row[] => db.__tables[table] ?? [];
