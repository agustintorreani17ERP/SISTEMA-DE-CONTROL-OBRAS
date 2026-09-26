import { PrismaClient, Prisma } from "@prisma/client";
import { toDecimal } from "./money";
import fs from "fs";
import path from "path";

// In-memory data store for fallback/preview with JSON file persistence
const D = (v: string | number) => new Prisma.Decimal(v);
const STORE_FILE = path.resolve(process.cwd(), "mock-db-store.json");

function createInitialStore() {
  const personnel = [
    { id: 1, fullName: "Ana Urbina", role: "JEFE_OBRA", email: "ana.urbina@obra.local" },
    { id: 2, fullName: "Ing. Carlos Benítez", role: "JEFE_FRENTE", email: "cbenitez@obra.local" },
    { id: 3, fullName: "Lic. María Gómez", role: "COMPRAS", email: "mgomez@obra.local" },
    { id: 4, fullName: "Ing. Roberto Almirón", role: "GERENCIA", email: "ralmiron@obra.local" },
    { id: 5, fullName: "Sr. Jorge Duarte", role: "ALMACEN", email: "jduarte@obra.local" },
  ];

  return {
    project: [] as any[],
    budgetItem: [] as any[],
    personnel,
    workFront: [] as any[],
    partner: [] as any[],
    material: [] as any[],
    materialRequest: [] as any[],
    materialRequestDetail: [] as any[],
    purchaseOrder: [] as any[],
    purchaseOrderDetail: [] as any[],
    subcontractorContract: [] as any[],
    subcontractorCertificate: [] as any[],
    warehouseStock: [] as any[],
    stockMovement: [] as any[],
    certificacion: [] as any[],
    budgetMovement: [] as any[],
    budgetImport: [] as any[],
    pettyCashFund: [] as any[],
    pettyCashExpense: [] as any[],
    documentAuditLog: [] as any[],
    projectBackup: [] as any[],
    invoice: [] as any[],
    invoiceItem: [] as any[],
    payment: [] as any[],
    certification: [] as any[],
    certificationItem: [] as any[],
    auxiliaryCalculation: [] as any[],
    itemPhoto: [] as any[],
  };
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const content = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") {
        return { ...createInitialStore(), ...parsed };
      }
    }
  } catch (err) {
    console.warn("[Prisma Mock] Error al leer mock-db-store.json:", err);
  }
  return createInitialStore();
}

let mockStore = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(mockStore, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Prisma Mock] Error al guardar mock-db-store.json:", err);
  }
}

export function resetStore() {
  mockStore = createInitialStore();
  saveStore();
  return mockStore;
}

function expandRelations(modelName: string, item: any, include?: any) {
  if (!item) return item;
  const res = { ...item };

  if (modelName === "project" || include?.project) {
    if (include?.budgetItems && item.id) {
      res.budgetItems = mockStore.budgetItem.filter((b: any) => b.projectId === item.id);
    }
    if (include?.workFronts && item.id) {
      res.workFronts = mockStore.workFront.filter((w: any) => w.projectId === item.id);
    }
  }

  if (res.projectId && !res.project) {
    res.project = mockStore.project.find((p: any) => p.id === res.projectId) || null;
  }
  if (res.materialId && !res.material) {
    res.material = mockStore.material.find((m: any) => m.id === res.materialId) || null;
  }
  if (res.partnerId && !res.partner) {
    res.partner = mockStore.partner.find((p: any) => p.id === res.partnerId) || null;
  }
  if (res.chiefId && !res.chief) {
    res.chief = mockStore.personnel.find((p: any) => p.id === res.chiefId) || null;
  }
  if (res.requestedById && !res.requestedBy) {
    res.requestedBy = mockStore.personnel.find((p: any) => p.id === res.requestedById) || null;
  }
  if (res.workFrontId && !res.workFront) {
    res.workFront = mockStore.workFront.find((w: any) => w.id === res.workFrontId) || null;
  }
  if (res.budgetItemId && !res.budgetItem) {
    res.budgetItem = mockStore.budgetItem.find((b: any) => b.id === res.budgetItemId) || null;
  }
  if (res.materialRequestId && !res.materialRequest) {
    res.materialRequest = mockStore.materialRequest.find((mr: any) => mr.id === res.materialRequestId) || null;
  }

  if (res.subcontractId && !res.contract) {
    res.contract = mockStore.subcontractorContract.find((c: any) => c.id === res.subcontractId) || null;
  }
  // Relaciones uno-a-muchos pedidas en `include` que no se resolvieron arriba:
  // se buscan por clave foránea (<modelo>Id o <última palabra del modelo>Id).
  if (include && typeof include === "object" && item.id !== undefined) {
    const lastWord = modelName.replace(/^.*([A-Z])/, (m) => m.slice(-1)).toLowerCase();
    for (const key of Object.keys(include)) {
      if (res[key] !== undefined || !key.endsWith("s")) continue;
      const singular = key.slice(0, -1);
      const collectionName = Object.keys(mockStore).find(
        (name) => name === singular || name.endsWith(singular.charAt(0).toUpperCase() + singular.slice(1))
      );
      if (!collectionName) continue;
      const fkCandidates = [`${modelName}Id`, `${lastWord}Id`];
      res[key] = ((mockStore as any)[collectionName] as any[]).filter((row) =>
        fkCandidates.some((fk) => row[fk] === item.id)
      );
    }
  }
  if (res.contractId && !res.contract) {
    res.contract = mockStore.subcontractorContract.find((c: any) => c.id === res.contractId) || null;
  }
  if (res.fundId && !res.fund) {
    res.fund = (mockStore.pettyCashFund || []).find((f: any) => f.id === res.fundId) || null;
  }

  if (res.details && Array.isArray(res.details)) {
    res.details = res.details.map((d: any) => ({
      ...d,
      material: d.material || mockStore.material.find((m: any) => m.id === d.materialId) || null,
      budgetItem: d.budgetItem || mockStore.budgetItem.find((b: any) => b.id === d.budgetItemId) || null,
    }));
  }

  if (include?.certificates && item.certificates) {
    res.certificates = item.certificates;
  }

  if (modelName === "certification" || include?.items) {
    if (include?.items) {
      res.items = (mockStore.certificationItem || [])
        .filter((ci: any) => ci.certificationId === item.id)
        .map((ci: any) => expandRelations("certificationItem", ci, include.items.include));
    }
  }

  if (modelName === "certificationItem") {
    if (include?.auxiliaryCalculations) {
      res.auxiliaryCalculations = (mockStore.auxiliaryCalculation || []).filter(
        (ac: any) => ac.certificationItemId === item.id
      );
    }
    if (include?.photos) {
      res.photos = (mockStore.itemPhoto || []).filter((p: any) => p.certificationItemId === item.id);
    }
    if (include?.budgetItem && res.budgetItemId) {
      res.budgetItem = mockStore.budgetItem.find((b: any) => b.id === res.budgetItemId) || null;
    }
  }

  return res;
}

function matchesWhere(rawItem: any, where: any, modelName: string = ""): boolean {
  if (!where) return true;
  const item = expandRelations(modelName, rawItem);

  for (const [key, val] of Object.entries(where)) {
    if (val === null) {
      // In Prisma / SQL, where: { deletedAt: null } matches null or undefined
      if (item[key] !== null && item[key] !== undefined) return false;
      continue;
    }
    if (val === undefined) continue;

    if (typeof val === "object" && val !== null) {
      if ("in" in val && Array.isArray((val as any).in)) {
        if (!(val as any).in.includes(item[key])) return false;
      } else if ("notIn" in val && Array.isArray((val as any).notIn)) {
        if ((val as any).notIn.includes(item[key])) return false;
      } else if ("not" in val) {
        if (item[key] === (val as any).not) return false;
      } else {
        // Nested relation or composite key e.g. projectId_materialId or contract: { projectId }
        let target = item[key];
        if (!target && key === "project" && item.projectId) {
          target = mockStore.project.find((p: any) => p.id === item.projectId);
        } else if (!target && key === "contract" && item.subcontractId) {
          target = mockStore.subcontractorContract.find((c: any) => c.id === item.subcontractId);
        }

        let matched = true;
        for (const [subK, subV] of Object.entries(val)) {
          if (item[subK] !== undefined) {
            if (item[subK] !== subV) matched = false;
          } else if (target && typeof target === "object") {
            if (typeof subV === "object" && subV !== null) {
              if ("not" in (subV as any) && target[subK] === (subV as any).not) matched = false;
            } else if (target[subK] !== subV) {
              matched = false;
            }
          } else {
            matched = false;
          }
        }
        if (!matched) return false;
      }
    } else if (item[key] !== val) {
      return false;
    }
  }
  return true;
}

function applyUpdateData(item: any, data: any) {
  if (!data) return;
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      if ("increment" in val) {
        const inc = (val as any).increment;
        item[key] = toDecimal(item[key] ?? 0).plus(toDecimal(inc));
      } else if ("decrement" in val) {
        const dec = (val as any).decrement;
        item[key] = toDecimal(item[key] ?? 0).minus(toDecimal(dec));
      } else if ("set" in val) {
        item[key] = (val as any).set;
      } else if ("connect" in val) {
        if ((val as any).connect?.id !== undefined) {
          item[`${key}Id`] = (val as any).connect.id;
        }
      } else {
        item[key] = val;
      }
    } else {
      item[key] = val;
    }
  }
  item.updatedAt = new Date();
}

/** Valores por defecto de cada modelo según schema.prisma (lo que haría la base real). */
const MODEL_DEFAULTS = new Map<string, Record<string, unknown>>();
for (const model of Prisma.dmmf.datamodel.models) {
  const defaults: Record<string, unknown> = {};
  for (const field of model.fields) {
    if (field.name === "id") continue;
    if (field.isUpdatedAt) {
      defaults[field.name] = "__now__";
      continue;
    }
    if (!field.hasDefaultValue) continue;
    const d = field.default as unknown;
    if (d && typeof d === "object" && "name" in (d as object)) {
      if ((d as { name: string }).name === "now") defaults[field.name] = "__now__";
      continue;
    }
    defaults[field.name] = field.type === "Decimal" ? new Prisma.Decimal(d as number) : d;
  }
  MODEL_DEFAULTS.set(model.name.charAt(0).toLowerCase() + model.name.slice(1), defaults);
}

function withDefaults(modelName: string, data: Record<string, any>) {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(MODEL_DEFAULTS.get(modelName) ?? {})) {
    resolved[key] = value === "__now__" ? new Date() : value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

function createMockModel(modelName: string) {
  return {
    findMany: async (args?: any) => {
      const collection = (mockStore as any)[modelName] || [];
      let results = [...collection];

      if (args?.where) {
        results = results.filter((item) => matchesWhere(item, args.where, modelName));
      }

      if (args?.orderBy && typeof args.orderBy === "object") {
        const orderKey = Object.keys(args.orderBy)[0];
        const orderDir = args.orderBy[orderKey];
        if (orderKey) {
          results.sort((a, b) => {
            if (a[orderKey] < b[orderKey]) return orderDir === "desc" ? 1 : -1;
            if (a[orderKey] > b[orderKey]) return orderDir === "desc" ? -1 : 1;
            return 0;
          });
        }
      }

      if (args?.take && typeof args.take === "number") {
        results = results.slice(0, args.take);
      }

      return results.map((item) => expandRelations(modelName, item, args?.include));
    },
    findFirst: async (args?: any) => {
      const collection = (mockStore as any)[modelName] || [];
      if (!args?.where) return collection[0] ? expandRelations(modelName, collection[0], args?.include) : null;
      const found = collection.find((item: any) => matchesWhere(item, args.where, modelName)) || null;
      return expandRelations(modelName, found, args?.include);
    },
    findUnique: async (args?: any) => {
      const collection = (mockStore as any)[modelName] || [];
      if (!args?.where) return null;

      let found = null;
      if (args.where.id !== undefined) {
        found = collection.find((item: any) => item.id === args.where.id);
      } else {
        found = collection.find((item: any) => matchesWhere(item, args.where, modelName)) || null;
      }

      return expandRelations(modelName, found, args?.include);
    },
    create: async (args: any) => {
      if (!(mockStore as any)[modelName]) {
        (mockStore as any)[modelName] = [];
      }
      const collection = (mockStore as any)[modelName];
      const newId = collection.length > 0 ? Math.max(...collection.map((i: any) => i.id || 0)) + 1 : 1;

      let detailsArray: any[] = [];
      if (args.data.details?.create) {
        const createData = Array.isArray(args.data.details.create)
          ? args.data.details.create
          : [args.data.details.create];
        detailsArray = createData.map((d: any, idx: number) => ({
          id: Date.now() + idx,
          ...d,
        }));
      }

      const newItem = {
        id: newId,
        deletedAt: null,
        ...withDefaults(modelName, args.data),
        details: detailsArray.length > 0 ? detailsArray : args.data.details,
      };
      collection.push(newItem);
      saveStore();
      return expandRelations(modelName, newItem, args?.include);
    },
    update: async (args: any) => {
      const collection = (mockStore as any)[modelName] || [];
      const item = collection.find((i: any) => matchesWhere(i, args?.where, modelName));
      if (item) {
        applyUpdateData(item, args.data);
        saveStore();
        return expandRelations(modelName, item, args?.include);
      }
      return args.data ?? {};
    },
    updateMany: async (args: any) => {
      const collection = (mockStore as any)[modelName] || [];
      let count = 0;
      for (const item of collection) {
        if (!args?.where || matchesWhere(item, args.where, modelName)) {
          applyUpdateData(item, args.data);
          count++;
        }
      }
      saveStore();
      return { count };
    },
    upsert: async (args: any) => {
      if (!(mockStore as any)[modelName]) {
        (mockStore as any)[modelName] = [];
      }
      const collection = (mockStore as any)[modelName];
      let item = collection.find((i: any) => matchesWhere(i, args?.where, modelName));
      if (item) {
        if (args.update) {
          applyUpdateData(item, args.update);
        }
        saveStore();
        return expandRelations(modelName, item, args?.include);
      } else {
        const createData = { ...(args.create || {}) };
        if (args.where) {
          for (const [k, v] of Object.entries(args.where)) {
            if (typeof v === "object" && v !== null && k.includes("_")) {
              for (const [subK, subV] of Object.entries(v)) {
                if (createData[subK] === undefined) {
                  createData[subK] = subV;
                }
              }
            } else if (v !== undefined && typeof v !== "object" && createData[k] === undefined) {
              createData[k] = v;
            }
          }
        }
        const newId = collection.length > 0 ? Math.max(...collection.map((i: any) => i.id || 0)) + 1 : 1;
        const newItem = {
          id: newId,
          deletedAt: null,
          ...withDefaults(modelName, createData),
        };
        collection.push(newItem);
        saveStore();
        return expandRelations(modelName, newItem, args?.include);
      }
    },
    delete: async (args: any) => {
      const collection = (mockStore as any)[modelName] || [];
      const idx = collection.findIndex((i: any) => matchesWhere(i, args?.where, modelName));
      if (idx !== -1) {
        const [deleted] = collection.splice(idx, 1);
        saveStore();
        return deleted;
      }
      return {};
    },
    deleteMany: async (args?: any) => {
      if (!args?.where) {
        (mockStore as any)[modelName] = [];
        saveStore();
        return { count: 0 };
      }
      const collection = (mockStore as any)[modelName] || [];
      const remaining = collection.filter((i: any) => !matchesWhere(i, args.where, modelName));
      const deletedCount = collection.length - remaining.length;
      (mockStore as any)[modelName] = remaining;
      saveStore();
      return { count: deletedCount };
    },
    aggregate: async (args?: any) => {
      const collection = (mockStore as any)[modelName] || [];
      let filtered = collection;
      if (args?.where) {
        filtered = collection.filter((item: any) => matchesWhere(item, args.where));
      }
      const sumResult: Record<string, any> = {};
      if (args?._sum && typeof args._sum === "object") {
        for (const key of Object.keys(args._sum)) {
          let sum = new Prisma.Decimal(0);
          for (const item of filtered) {
            if (item[key] !== undefined && item[key] !== null) {
              sum = sum.plus(toDecimal(item[key]));
            }
          }
          sumResult[key] = sum;
        }
      } else {
        let totalAmount = new Prisma.Decimal(0);
        let amount = new Prisma.Decimal(0);
        for (const item of filtered) {
          if (item.totalAmount) totalAmount = totalAmount.plus(toDecimal(item.totalAmount));
          if (item.amount) amount = amount.plus(toDecimal(item.amount));
        }
        sumResult.totalAmount = totalAmount;
        sumResult.amount = amount;
      }
      return {
        _sum: sumResult,
        _count: filtered.length,
      };
    },
    count: async (args?: any) => {
      const collection = (mockStore as any)[modelName] || [];
      if (!args?.where) return collection.length;
      return collection.filter((item: any) => matchesWhere(item, args.where)).length;
    },
    createMany: async (args: any) => {
      if (!(mockStore as any)[modelName]) {
        (mockStore as any)[modelName] = [];
      }
      const collection = (mockStore as any)[modelName];
      const rows = Array.isArray(args?.data) ? args.data : [args?.data];
      for (const row of rows) {
        const newId = collection.length > 0 ? Math.max(...collection.map((i: any) => i.id || 0)) + 1 : 1;
        collection.push({ id: newId, ...withDefaults(modelName, row) });
      }
      saveStore();
      return { count: rows.length };
    },
    createManyAndReturn: async (args: any) => {
      if (!(mockStore as any)[modelName]) {
        (mockStore as any)[modelName] = [];
      }
      const collection = (mockStore as any)[modelName];
      const rows = Array.isArray(args?.data) ? args.data : [args?.data];
      const created = rows.map((row: any) => {
        const newId = collection.length > 0 ? Math.max(...collection.map((i: any) => i.id || 0)) + 1 : 1;
        const item = { id: newId, ...withDefaults(modelName, row) };
        collection.push(item);
        return item;
      });
      saveStore();
      return created;
    },
    groupBy: async (args: any) => {
      const collection = (mockStore as any)[modelName] || [];
      const filtered = args?.where
        ? collection.filter((item: any) => matchesWhere(item, args.where, modelName))
        : collection;
      const keys: string[] = args?.by ?? [];
      const groups = new Map<string, any[]>();
      for (const item of filtered) {
        const k = JSON.stringify(keys.map((key) => item[key]));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(item);
      }
      return [...groups.values()].map((items) => {
        const row: Record<string, any> = {};
        for (const key of keys) row[key] = items[0][key];
        if (args?._sum) {
          row._sum = {};
          for (const field of Object.keys(args._sum)) {
            row._sum[field] = items.reduce(
              (acc: Prisma.Decimal, it: any) => acc.plus(toDecimal(it[field])),
              new Prisma.Decimal(0)
            );
          }
        }
        if (args?._count) row._count = items.length;
        return row;
      });
    },
  };
}

const useMock = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock");

function createMockClient(): PrismaClient {
  const client: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "$connect" || prop === "$disconnect") return async () => {};
        if (prop === "$transaction") {
          return async (arg: any) => {
            if (typeof arg === "function") return arg(client);
            if (Array.isArray(arg)) return Promise.all(arg);
            return arg;
          };
        }
        return createMockModel(prop);
      },
    }
  );
  return client as PrismaClient;
}

if (useMock) {
  console.warn("[ERP] DATABASE_URL no configurada: usando almacenamiento simulado (solo desarrollo).");
}

/**
 * Con DATABASE_URL se usa PrismaClient real (transacciones atómicas reales).
 * Sin DATABASE_URL se usa el almacenamiento simulado en JSON, solo para desarrollo.
 * No hay cambio silencioso de modo: si la base real falla, el error se propaga.
 */
export const prisma: PrismaClient = useMock
  ? createMockClient()
  : new PrismaClient({ log: ["error"] });

export const isMockDatabase = useMock;
