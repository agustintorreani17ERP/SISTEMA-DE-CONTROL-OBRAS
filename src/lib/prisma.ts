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
    costCenter: [] as any[],
    budgetCommitment: [] as any[],
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
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...args.data,
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
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...createData,
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
  };
}

let rawPrisma: PrismaClient | null = null;
let isDbOffline = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock") || process.env.DATABASE_URL.includes("servidor");

if (!isDbOffline) {
  try {
    rawPrisma = new PrismaClient({
      log: ["error"],
    });
  } catch (err) {
    isDbOffline = true;
    console.warn("[InfraTrack ERP] No se pudo instanciar PrismaClient real, usando mock:", err);
  }
}

export const prisma: PrismaClient = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === "$connect") return async () => {};
      if (prop === "$disconnect") return async () => {};
      if (prop === "$transaction") {
        return async (arg: any) => {
          if (typeof arg === "function") {
            return arg(prisma);
          }
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return arg;
        };
      }

      const mockModel = createMockModel(prop);

      if (!isDbOffline && rawPrisma && prop in rawPrisma) {
        const realModel = (rawPrisma as any)[prop];
        return new Proxy(realModel, {
          get(targetModel, method: string) {
            const originalMethod = targetModel[method];
            if (typeof originalMethod !== "function") return targetModel[method];
            return async (...args: any[]) => {
              if (isDbOffline) {
                const mockFn = (mockModel as any)[method];
                return typeof mockFn === "function" ? mockFn(...args) : null;
              }
              try {
                return await originalMethod.apply(targetModel, args);
              } catch (dbErr: any) {
                isDbOffline = true;
                console.warn(
                  `[InfraTrack ERP] Base de datos no disponible (${dbErr?.code || "offline"}), activando modo memoria simulada.`
                );
                const mockFn = (mockModel as any)[method];
                return typeof mockFn === "function" ? mockFn(...args) : null;
              }
            };
          },
        });
      }

      return mockModel;
    },
  }
) as unknown as PrismaClient;

