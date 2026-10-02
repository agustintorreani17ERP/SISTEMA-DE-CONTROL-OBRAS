import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, resetStore } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../domain/audit";
import { ensureGeneralExpenses } from "../../domain/generalExpenses";
import { recalculateProjectFinancials } from "../../domain/projectFinancials";
import { syncWorkFrontsFromAreas } from "../../domain/workFrontSync";
import { recordEstimate } from "../../domain/prices";

export const catalogsRouter = Router();

catalogsRouter.post(
  "/projects/clear-all",
  asyncHandler(async (_req, res) => {
    try {
      resetStore();
    } catch {}
    try {
      await prisma.budgetMovement.deleteMany({});
      await prisma.pettyCashExpense.deleteMany({});
      await prisma.pettyCashFund.deleteMany({});
      await prisma.budgetItem.updateMany({ data: { parentId: null } });
      await prisma.budgetItem.deleteMany({});
      await prisma.budgetImport.deleteMany({});
      await prisma.certificacion.deleteMany({});
      await prisma.materialRequestDetail.deleteMany({});
      await prisma.materialRequest.deleteMany({});
      await prisma.purchaseOrderDetail.deleteMany({});
      await prisma.purchaseOrder.deleteMany({});
      await prisma.subcontractorCertificate.deleteMany({});
      await prisma.subcontractorContract.deleteMany({});
      await prisma.warehouseStock.deleteMany({});
      await prisma.stockMovement.deleteMany({});
      await prisma.workFront.deleteMany({});
      await prisma.projectBackup.deleteMany({});
      await prisma.project.deleteMany({});
    } catch {}
    ok(res, { success: true, message: "Todos los proyectos y datos han sido eliminados correctamente" });
  })
);

catalogsRouter.get(
  "/projects",
  asyncHandler(async (_req, res) => {
    const data = await prisma.project.findMany({
      where: { deletedAt: null },
      include: { budgetItems: true, workFronts: { include: { chief: true } } },
      orderBy: { id: "asc" },
    });
    ok(res, data);
  })
);

catalogsRouter.get(
  "/projects/archived",
  asyncHandler(async (_req, res) => {
    ok(res, await prisma.projectBackup.findMany({ orderBy: { deletedAt: "desc" } }));
  })
);

catalogsRouter.get(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const project = await prisma.project.findUnique({
      where: { id },
      include: { budgetItems: true, workFronts: true },
    });
    if (!project) throw new NotFoundError("Obra", id);
    ok(res, project);
  })
);

const projectSchema = z.object({
  code: z.string().trim().min(1, "El código de obra es requerido"),
  name: z.string().trim().min(1, "El nombre de la obra es requerido"),
  location: z.string().trim().optional().default("Paraguay"),
  clientName: z.string().trim().optional().default("Cliente"),
  executionMonths: z.coerce.number().int().nonnegative().default(12),
  roadSection: z.string().trim().optional(),
  contractNumber: z.string().trim().optional(),
  globalBudget: z.coerce.number().nonnegative().default(0),
  montoContractualManual: z.coerce.number().nonnegative().optional(),
  currency: z.enum(["PYG", "USD"]).optional().default("PYG"),
});

const partnerSchema = z.object({
  kind: z.enum(["SUPPLIER", "SUBCONTRACTOR", "BOTH"]),
  name: z.string().min(3),
  taxId: z.string().min(3),
  fiscalAddress: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  classification: z.string().optional(),
});

const materialSchema = z.object({
  code: z.string().min(2),
  description: z.string().trim().min(2),
  unit: z.string().min(1),
  category: z.string().min(2),
  estimatedCost: z.coerce.number().nonnegative().default(0),
});

const personnelSchema = z.object({
  fullName: z.string().min(3),
  role: z.enum(["JEFE_FRENTE", "COMPRAS", "GERENCIA", "ALMACEN"]),
  email: z.string().email().optional(),
});

const budgetItemSchema = z.object({
  projectId: z.coerce.number().int(),
  parentId: z.coerce.number().int().positive().optional(),
  nodeKind: z.enum(["RUBRO", "ITEM"]).default("ITEM"),
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(40).optional(),
  totalQuantity: z.coerce.number().nonnegative().optional(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  originalAmount: z.coerce.number().nonnegative().optional(),
});

const workFrontSchema = z.object({
  projectId: z.coerce.number().int(),
  name: z.string().trim().min(2, "Poné un nombre para el frente"),
  chiefId: z.coerce.number().int().positive().optional().nullable(),
});

catalogsRouter.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const body = projectSchema.parse(req.body);
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          ...body,
          montoContractualManual: body.montoContractualManual ?? body.globalBudget,
          montoRealActualizado: body.montoContractualManual ?? body.globalBudget,
        },
      });
      // Gastos Generales disponible desde el día uno, aunque todavía no se importe el presupuesto.
      await ensureGeneralExpenses(tx, created.id);
      return created;
    });
    ok(res, project, 201);
  })
);

catalogsRouter.patch(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(req.body.name ? { name: String(req.body.name) } : {}),
        ...(req.body.code ? { code: String(req.body.code) } : {}),
        ...(req.body.location ? { location: String(req.body.location) } : {}),
        ...(req.body.clientName ? { clientName: String(req.body.clientName) } : {}),
        ...(req.body.globalBudget ? { globalBudget: Number(req.body.globalBudget) } : {}),
        ...(req.body.montoContractualManual ? { montoContractualManual: Number(req.body.montoContractualManual) } : {}),
        ...(req.body.montoRealActualizado ? { montoRealActualizado: Number(req.body.montoRealActualizado) } : {}),
      },
    });
    ok(res, updated);
  })
);

catalogsRouter.delete(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new DomainError("INVALID_PROJECT", "El identificador de la obra no es válido");
    }

    await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id },
        include: {
          budgetItems: true,
          workFronts: { include: { chief: true } },
          materialRequests: { include: { details: true, purchaseOrders: true } },
          purchaseOrders: { include: { details: true } },
          subcontracts: { include: { partner: true, budgetItem: true, certificates: true } },
          warehouseStock: { include: { material: true } },
          stockMovements: { include: { material: true } },
          certificaciones: { include: { partner: true, budgetItem: true } },
        },
      });
      if (!project) throw new NotFoundError("Obra", id);
      if (project.deletedAt) throw new DomainError("PROJECT_ALREADY_ARCHIVED", "La obra ya está archivada", 409);
      const snapshot = JSON.parse(JSON.stringify(project));
      await tx.projectBackup.create({
        data: {
          originalProjectId: id,
          projectCode: project.code,
          projectName: project.name,
          snapshot,
        },
      });
      await tx.project.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: "usuario-actual" },
      });
    });

    ok(res, { deleted: true, id });
  })
);

catalogsRouter.get(
  "/projects/:id/backup",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const backup = await prisma.projectBackup.findUnique({ where: { originalProjectId: id } });
    if (!backup) throw new NotFoundError("Respaldo de obra", id);
    ok(res, backup);
  })
);

catalogsRouter.post(
  "/partners",
  asyncHandler(async (req, res) => {
    const body = partnerSchema.parse(req.body);
    ok(res, await prisma.partner.create({ data: body }), 201);
  })
);

catalogsRouter.post(
  "/materials",
  asyncHandler(async (req, res) => {
    const body = materialSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.material.create({ data: body });
      await recordEstimate(tx, m.id, body.estimatedCost, "MANUAL");
      return tx.material.findUniqueOrThrow({ where: { id: m.id } });
    });
    ok(res, created, 201);
  })
);

catalogsRouter.post(
  "/personnel",
  asyncHandler(async (req, res) => {
    const body = personnelSchema.parse(req.body);
    ok(res, await prisma.personnel.create({ data: body }), 201);
  })
);

catalogsRouter.post(
  "/budget-items",
  asyncHandler(async (req, res) => {
    const body = budgetItemSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: body.projectId } });
      if (!project) throw new NotFoundError("Obra", body.projectId);

      let parent = null;
      if (body.parentId) {
        parent = await tx.budgetItem.findUnique({ where: { id: body.parentId } });
        if (!parent || parent.projectId !== body.projectId) throw new NotFoundError("Rubro", body.parentId);
        if (parent.nodeKind === "ITEM") {
          throw new DomainError("PARENT_IS_ITEM", "Solo se pueden agregar partidas dentro de un rubro", 422);
        }
      }
      const path = parent ? `${parent.path}/${body.code}` : body.code;
      if (await tx.budgetItem.findUnique({ where: { projectId_path: { projectId: body.projectId, path } } })) {
        throw new DomainError("DUPLICATE_CODE", `Ya existe "${body.code}" en ese rubro`, 409);
      }
      const qty = body.totalQuantity ?? (body.nodeKind === "ITEM" ? 1 : 0);
      const price = body.unitPrice ?? 0;
      const isItem = body.nodeKind === "ITEM";
      const item = await tx.budgetItem.create({
        data: {
          projectId: body.projectId,
          parentId: parent?.id ?? null,
          code: body.code,
          name: body.name,
          category: parent ? parent.category : body.name,
          unit: isItem ? body.unit || "un" : null,
          totalQuantity: isItem ? qty : 0,
          unitPrice: isItem ? price : 0,
          originalAmount: isItem ? body.originalAmount ?? Math.round(qty * price * 100) / 100 : 0,
          path,
          hierarchyLevel: parent ? parent.hierarchyLevel + 1 : 0,
          nodeKind: isItem ? "ITEM" : parent ? "SUBRUBRO" : "RUBRO",
          sortOrder: (await tx.budgetItem.count({ where: { projectId: body.projectId } })) + 1,
        },
      });
      await audit(tx, { entity: "BudgetItem", entityId: item.id, action: "CREATE" });
      await recalculateProjectFinancials(tx, body.projectId);
      await syncWorkFrontsFromAreas(tx, body.projectId);
      return item;
    });
    ok(res, created, 201);
  })
);

catalogsRouter.post(
  "/work-fronts",
  asyncHandler(async (req, res) => {
    const body = workFrontSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    if (body.chiefId && !(await prisma.personnel.findUnique({ where: { id: body.chiefId } }))) {
      throw new NotFoundError("Personal", body.chiefId);
    }
    ok(
      res,
      await prisma.workFront.create({
        data: { projectId: body.projectId, name: body.name, chiefId: body.chiefId ?? null },
        include: { chief: true },
      }),
      201
    );
  })
);

catalogsRouter.patch(
  "/work-fronts/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = workFrontSchema.partial().omit({ projectId: true }).parse(req.body);
    ok(res, await prisma.workFront.update({ where: { id }, data: body, include: { chief: true } }));
  })
);

catalogsRouter.delete(
  "/work-fronts/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const used = await prisma.materialRequest.count({ where: { workFrontId: id } });
    if (used > 0) {
      throw new DomainError("WORK_FRONT_IN_USE", `El frente tiene ${used} pedido(s): no se puede borrar`, 409);
    }
    await prisma.workFront.delete({ where: { id } });
    ok(res, { deleted: true, id });
  })
);

catalogsRouter.get(
  "/partners",
  asyncHandler(async (_req, res) => {
    ok(res, await prisma.partner.findMany({ orderBy: { name: "asc" } }));
  })
);

catalogsRouter.get(
  "/materials",
  asyncHandler(async (_req, res) => {
    ok(res, await prisma.material.findMany({ orderBy: { code: "asc" } }));
  })
);

catalogsRouter.get(
  "/personnel",
  asyncHandler(async (_req, res) => {
    ok(res, await prisma.personnel.findMany({ where: { active: true } }));
  })
);

catalogsRouter.get(
  "/budget-items",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.budgetItem.findMany({
        where: projectId ? { projectId } : undefined,
        include: { project: true },
        orderBy: { sortOrder: "asc" },
      })
    );
  })
);

catalogsRouter.get(
  "/work-fronts",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    ok(
      res,
      await prisma.workFront.findMany({
        where: projectId ? { projectId } : undefined,
        include: { chief: true, project: true },
        orderBy: { id: "asc" },
      })
    );
  })
);

// --- MODIFICAR Y ELIMINAR PARTIDAS / RUBROS DEL PRESUPUESTO ---
// Solo datos del presupuesto (código, nombre, unidad, cantidad, PU). Lo ejecutado sale
// exclusivamente del libro mayor y no se edita a mano.
const budgetItemUpdateSchema = z.object({
  code: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(500).optional(),
  unit: z.string().trim().max(40).optional(),
  totalQuantity: z.coerce.number().nonnegative().optional(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  originalAmount: z.coerce.number().nonnegative().optional(),
});

catalogsRouter.put(
  "/budget-items/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = budgetItemUpdateSchema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.budgetItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Partida de presupuesto", id);

      const data: Prisma.BudgetItemUpdateInput = {
        ...(body.code ? { code: body.code } : {}),
        ...(body.name ? { name: body.name } : {}),
      };
      if (existing.nodeKind === "ITEM") {
        const qty = body.totalQuantity ?? Number(existing.totalQuantity);
        const price = body.unitPrice ?? Number(existing.unitPrice);
        Object.assign(data, {
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          totalQuantity: qty,
          unitPrice: price,
          originalAmount:
            body.originalAmount ??
            (body.totalQuantity !== undefined || body.unitPrice !== undefined
              ? Math.round(qty * price * 100) / 100
              : Number(existing.originalAmount)),
        });
      }

      const next = await tx.budgetItem.update({ where: { id }, data });
      await audit(tx, {
        entity: "BudgetItem",
        entityId: id,
        action: "UPDATE",
        payload: {
          before: {
            code: existing.code,
            name: existing.name,
            totalQuantity: existing.totalQuantity.toString(),
            unitPrice: existing.unitPrice.toString(),
            originalAmount: existing.originalAmount.toString(),
          },
          after: body,
        } as Prisma.InputJsonValue,
      });
      await recalculateProjectFinancials(tx, existing.projectId);
      await syncWorkFrontsFromAreas(tx, existing.projectId);
      return next;
    });

    ok(res, updated);
  })
);

/** Motivo por el que una partida no se puede borrar, o null si se puede. */
async function budgetItemDeleteBlocker(tx: Prisma.TransactionClient, ids: number[]): Promise<string | null> {
  const where = { budgetItemId: { in: ids } };
  const [movements, requests, orders, subcontracts, certs, certItems, petty, stockIssues, avances, partesEq] = await Promise.all([
    tx.budgetMovement.count({ where }),
    tx.materialRequestDetail.count({ where }),
    tx.purchaseOrderDetail.count({ where }),
    tx.subcontractorContract.count({ where }),
    tx.certificacion.count({ where }),
    tx.certificationItem.count({ where }),
    tx.pettyCashExpense.count({ where }),
    tx.stockMovement.count({ where }),
    tx.avanceItem.count({ where }),
    tx.parteEquipo.count({ where }),
  ]);
  const [horasPers, viajes] = await Promise.all([tx.parteHoraPersonal.count({ where }), tx.viajeCamion.count({ where })]);
  if (movements) return "tiene movimientos imputados (OC, certificados o caja chica)";
  if (stockIssues) return `tiene ${stockIssues} salida(s) de stock asignadas`;
  if (avances) return `tiene ${avances} registro(s) de avance`;
  if (partesEq) return `tiene ${partesEq} parte(s) de horas de equipo`;
  if (horasPers || viajes) return `tiene ${horasPers + viajes} renglón(es) de parte diario (horas de personal o viajes)`;
  const refs = requests + orders + subcontracts + certs + certItems + petty;
  if (refs) return `la usan ${refs} documento(s) (pedidos, OC, subcontratos, certificados o caja chica)`;
  return null;
}

catalogsRouter.delete(
  "/budget-items/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.budgetItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Partida de presupuesto", id);
      if (existing.isSystem) {
        throw new DomainError("SYSTEM_BUDGET_ITEM", "Las partidas de Gastos Generales no se pueden borrar", 409);
      }
      if ((await tx.budgetItem.count({ where: { parentId: id } })) > 0) {
        throw new DomainError("BUDGET_ITEM_HAS_CHILDREN", `"${existing.name}" tiene ítems: borralos primero`, 409);
      }
      const blocker = await budgetItemDeleteBlocker(tx, [id]);
      if (blocker) {
        throw new DomainError("BUDGET_ITEM_IN_USE", `No se puede borrar "${existing.name}": ${blocker}`, 409);
      }
      await tx.budgetItem.delete({ where: { id } });
      await audit(tx, { entity: "BudgetItem", entityId: id, action: "DELETE" });
      await recalculateProjectFinancials(tx, existing.projectId);
      await syncWorkFrontsFromAreas(tx, existing.projectId);
    });
    ok(res, { deleted: true, id });
  })
);

// Limpiar el presupuesto de una obra (solo si todavía no tiene nada imputado).
catalogsRouter.delete(
  "/projects/:projectId/budget-items",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
    }
    await prisma.$transaction(async (tx) => {
      const items = await tx.budgetItem.findMany({ where: { projectId, isSystem: false }, select: { id: true } });
      const ids = items.map((i) => i.id);
      if (!ids.length) return;
      const blocker = await budgetItemDeleteBlocker(tx, ids);
      if (blocker) {
        throw new DomainError("BUDGET_IN_USE", `No se puede limpiar el presupuesto: ${blocker}`, 409);
      }
      await tx.budgetItem.updateMany({ where: { id: { in: ids } }, data: { parentId: null } });
      await tx.budgetItem.deleteMany({ where: { id: { in: ids } } });
      await recalculateProjectFinancials(tx, projectId);
      await syncWorkFrontsFromAreas(tx, projectId);
    });
    ok(res, { deletedAll: true, projectId });
  })
);

// --- MODIFICAR Y ELIMINAR MATERIALES + CARGA MASIVA ---
catalogsRouter.put(
  "/materials/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.material.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Material", id);

    const { code, description, unit, category, estimatedCost } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.material.update({
        where: { id },
        data: {
          ...(code ? { code: String(code).trim() } : {}),
          ...(description ? { description: String(description).trim() } : {}),
          ...(unit ? { unit: String(unit).trim() } : {}),
          ...(category ? { category: String(category).trim() } : {}),
        },
      });
      if (estimatedCost !== undefined) await recordEstimate(tx, id, Number(estimatedCost), "MANUAL");
      return tx.material.findUniqueOrThrow({ where: { id } });
    });
    ok(res, updated);
  })
);

catalogsRouter.delete(
  "/materials/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.material.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Material", id);
    const [enAcu, enUso] = await Promise.all([
      prisma.componenteItem.count({ where: { insumoId: id } }),
      Promise.all([prisma.stockMovement.count({ where: { materialId: id } }), prisma.parteEquipo.count({ where: { insumoId: id } }), prisma.conteoInventario.count({ where: { materialId: id } }), prisma.cargaCombustible.count({ where: { equipoId: id } }), prisma.viajeCamion.count({ where: { OR: [{ equipoId: id }, { materialId: id }] } })]),
    ]);
    if (enUso.some(Boolean)) {
      throw new DomainError("INSUMO_IN_USE", "El insumo tiene movimientos de stock, conteos o partes de equipo: desactivalo en vez de borrarlo", 409);
    }
    if (enAcu) {
      throw new DomainError("INSUMO_IN_ACU", `El insumo se usa en ${enAcu} ACU: sacalo de esos ítems o desactivalo`, 409);
    }

    try {
      await prisma.materialRequestDetail.deleteMany({ where: { materialId: id } });
      await prisma.warehouseStock.deleteMany({ where: { materialId: id } });
    } catch (e) {
      console.warn("Cleaned material relations:", id);
    }

    const deleted = await prisma.material.delete({ where: { id } });
    ok(res, { deleted: true, id: deleted.id });
  })
);

catalogsRouter.post(
  "/materials/bulk",
  asyncHandler(async (req, res) => {
    const { materials } = req.body;
    if (!Array.isArray(materials) || materials.length === 0) {
      throw new DomainError("INVALID_MATERIALS", "La lista de materiales no puede estar vacía");
    }

    const created = [];
    for (const m of materials) {
      const code = String(m.code || "").trim();
      const description = String(m.description || m.name || "").trim();
      if (!code || !description) continue;

      const unit = String(m.unit || "un").trim();
      const category = String(m.category || "GENERAL").trim().toUpperCase();
      const estimatedCost = Number(m.estimatedCost || m.unitPrice || 0);

      const mat = await prisma.$transaction(async (tx) => {
        const m = await tx.material.upsert({
          where: { code },
          update: { description, unit, category },
          create: { code, description, unit, category },
        });
        await recordEstimate(tx, m.id, estimatedCost, "IMPORT:carga masiva");
        return tx.material.findUniqueOrThrow({ where: { id: m.id } });
      });
      created.push(mat);
    }

    ok(res, { count: created.length, materials: created });
  })
);

// --- MODIFICAR Y ELIMINAR PROVEEDORES / SUBCONTRATISTAS (PARTNERS) ---
catalogsRouter.put(
  "/partners/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Proveedor/Subcontratista", id);

    const { kind, name, taxId, fiscalAddress, phone, email, classification, active } = req.body;
    const updated = await prisma.partner.update({
      where: { id },
      data: {
        ...(kind ? { kind } : {}),
        ...(name ? { name: String(name).trim() } : {}),
        ...(taxId ? { taxId: String(taxId).trim() } : {}),
        ...(fiscalAddress !== undefined ? { fiscalAddress: String(fiscalAddress).trim() } : {}),
        ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
        ...(email !== undefined ? { email: String(email).trim() } : {}),
        ...(classification !== undefined ? { classification: String(classification).trim() } : {}),
        ...(active !== undefined ? { active: Boolean(active) } : {}),
      },
    });
    ok(res, updated);
  })
);

catalogsRouter.delete(
  "/partners/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Proveedor/Subcontratista", id);

    try {
      await prisma.subcontractorContract.deleteMany({ where: { partnerId: id } });
      await prisma.purchaseOrder.deleteMany({ where: { partnerId: id } });
    } catch (e) {
      console.warn("Cleaned partner dependencies:", id);
    }

    const deleted = await prisma.partner.delete({ where: { id } });
    ok(res, { deleted: true, id: deleted.id });
  })
);


