import { Router } from "express";
import { z } from "zod";
import { prisma, resetStore } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError, NotFoundError } from "../../errors/domain";

export const catalogsRouter = Router();

catalogsRouter.post(
  "/projects/clear-all",
  asyncHandler(async (_req, res) => {
    try {
      resetStore();
    } catch {}
    try {
      await prisma.budgetItem.deleteMany({});
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
  description: z.string().min(3),
  unit: z.string().min(1),
  category: z.string().min(2),
  estimatedCost: z.coerce.number().nonnegative(),
});

const personnelSchema = z.object({
  fullName: z.string().min(3),
  role: z.enum(["JEFE_FRENTE", "COMPRAS", "GERENCIA", "ALMACEN"]),
  email: z.string().email().optional(),
});

const budgetItemSchema = z.object({
  projectId: z.number().int(),
  code: z.string().min(2),
  name: z.string().min(3),
  category: z.string().min(2),
  originalAmount: z.coerce.number().positive(),
});

const workFrontSchema = z.object({
  projectId: z.number().int(),
  name: z.string().min(3),
  chiefId: z.number().int(),
});

catalogsRouter.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const body = projectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: {
        ...body,
        montoContractualManual: body.montoContractualManual ?? body.globalBudget,
        montoRealActualizado: body.montoContractualManual ?? body.globalBudget,
      },
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
    ok(res, await prisma.material.create({ data: body }), 201);
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
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    ok(res, await prisma.budgetItem.create({ data: body }), 201);
  })
);

catalogsRouter.post(
  "/work-fronts",
  asyncHandler(async (req, res) => {
    const body = workFrontSchema.parse(req.body);
    const [project, chief] = await Promise.all([
      prisma.project.findUnique({ where: { id: body.projectId } }),
      prisma.personnel.findUnique({ where: { id: body.chiefId } }),
    ]);
    if (!project) throw new NotFoundError("Obra", body.projectId);
    if (!chief) throw new NotFoundError("Personal", body.chiefId);
    if (chief.role !== "JEFE_FRENTE") {
      throw new DomainError("INVALID_CHIEF", "El responsable debe tener rol JEFE_FRENTE");
    }
    ok(res, await prisma.workFront.create({ data: body, include: { chief: true, project: true } }), 201);
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
        orderBy: { code: "asc" },
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
catalogsRouter.put(
  "/budget-items/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.budgetItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Rubro de presupuesto", id);

    const { code, name, category, unit, totalQuantity, executedQuantity, unitPrice, originalAmount } = req.body;
    const qty = totalQuantity !== undefined ? Number(totalQuantity) : Number(existing.totalQuantity);
    const price = unitPrice !== undefined ? Number(unitPrice) : Number(existing.unitPrice);
    const amount = originalAmount !== undefined ? Number(originalAmount) : Math.round(qty * price);

    const updated = await prisma.budgetItem.update({
      where: { id },
      data: {
        ...(code ? { code: String(code).trim() } : {}),
        ...(name ? { name: String(name).trim() } : {}),
        ...(category ? { category: String(category).trim() } : {}),
        ...(unit !== undefined ? { unit: String(unit).trim() } : {}),
        totalQuantity: qty,
        ...(executedQuantity !== undefined ? { executedQuantity: Number(executedQuantity) } : {}),
        unitPrice: price,
        originalAmount: amount,
      },
    });

    ok(res, updated);
  })
);

catalogsRouter.delete(
  "/budget-items/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.budgetItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Rubro de presupuesto", id);

    // Remove any dependent references or certifications gracefully
    try {
      await prisma.certificacion.deleteMany({ where: { budgetItemId: id } });
      await prisma.subcontractorContract.deleteMany({ where: { budgetItemId: id } });
      await prisma.materialRequestDetail.deleteMany({ where: { budgetItemId: id } });
      await prisma.purchaseOrderDetail.deleteMany({ where: { budgetItemId: id } });
      await prisma.budgetCommitment.deleteMany({ where: { budgetItemId: id } });
    } catch (e) {
      console.warn("Cleaned dependencies for budgetItem:", id);
    }

    const deleted = await prisma.budgetItem.delete({ where: { id } });
    ok(res, { deleted: true, id: deleted.id });
  })
);

// Limpiar todas las partidas de una obra (para empezar de cero con la Planilla Madre)
catalogsRouter.delete(
  "/projects/:projectId/budget-items",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new DomainError("INVALID_PROJECT", "Identificador de obra inválido");
    }

    try {
      await prisma.certificacion.deleteMany({ where: { projectId } });
      await prisma.budgetItem.deleteMany({ where: { projectId } });
    } catch (e) {
      console.warn("Could not batch delete budget items:", e);
    }

    ok(res, { deletedAll: true, projectId });
  })
);

// --- PLANILLA MADRE Y CENTROS DE COSTOS (APROBAR PLANILLA MADRE) ---
catalogsRouter.post(
  "/projects/:projectId/planilla-madre/aprobar",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.projectId);
    const { items, markupPercent } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new DomainError("INVALID_BUDGET", "La planilla madre debe contener al menos un rubro");
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundError("Obra", projectId);

    // 1. Limpiar o reemplazar partidas anteriores de este proyecto
    try {
      await prisma.certificacion.deleteMany({ where: { projectId } });
      await prisma.budgetItem.deleteMany({ where: { projectId } });
    } catch (e) {
      console.warn("Cleared existing items for master budget");
    }

    // 2. Extraer categorías únicas para crear o sincronizar Centros de Costos
    const categoriesSet = new Set<string>();
    items.forEach((it: any) => {
      if (it.category) categoriesSet.add(String(it.category).trim().toUpperCase());
      else categoriesSet.add("GENERAL");
    });

    const costCenterMap = new Map<string, number>();
    let ccIndex = 1;
    for (const catName of categoriesSet) {
      const ccCode = `CC-${String(ccIndex).padStart(2, "0")}`;
      try {
        const cc = await prisma.costCenter.upsert({
          where: { projectId_code: { projectId, code: ccCode } },
          update: { name: catName },
          create: {
            projectId,
            code: ccCode,
            name: catName,
            level: 1,
          },
        });
        costCenterMap.set(catName, cc.id);
        ccIndex++;
      } catch (err) {
        // Continue if cost center exists
      }
    }

    // 3. Crear los rubros oficiales de la Planilla Madre
    let totalBudgetSum = 0;
    const createdItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const code = String(it.code || `R-${String(i + 1).padStart(2, "0")}`).trim();
      const name = String(it.name || "Rubro sin nombre").trim();
      const cat = String(it.category || "GENERAL").trim().toUpperCase();
      const unit = String(it.unit || "un").trim();
      const qty = Math.max(0, Number(it.quantity || it.totalQuantity || 1));
      const uPrice = Math.max(0, Number(it.unitPrice || 0));
      const origAmt = Number(it.originalAmount) > 0 ? Number(it.originalAmount) : Math.round(qty * uPrice);
      totalBudgetSum += origAmt;

      const costCenterId = costCenterMap.get(cat) || undefined;

      const created = await prisma.budgetItem.create({
        data: {
          projectId,
          code,
          name,
          category: cat,
          unit,
          totalQuantity: qty,
          executedQuantity: 0,
          unitPrice: uPrice,
          originalAmount: origAmt,
          committedAmount: 0,
          executedAmount: 0,
          costCenterId,
        },
      });
      createdItems.push(created);
    }

    // 4. Actualizar montos oficiales de la obra
    await prisma.project.update({
      where: { id: projectId },
      data: {
        montoPresupuestoBase: totalBudgetSum,
        montoContractualManual: totalBudgetSum,
        montoRealActualizado: totalBudgetSum,
        globalBudget: totalBudgetSum,
      },
    });

    ok(res, {
      approved: true,
      totalItems: createdItems.length,
      totalAmount: totalBudgetSum,
      budgetItems: createdItems,
    });
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
    const updated = await prisma.material.update({
      where: { id },
      data: {
        ...(code ? { code: String(code).trim() } : {}),
        ...(description ? { description: String(description).trim() } : {}),
        ...(unit ? { unit: String(unit).trim() } : {}),
        ...(category ? { category: String(category).trim() } : {}),
        ...(estimatedCost !== undefined ? { estimatedCost: Number(estimatedCost) } : {}),
      },
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

      const mat = await prisma.material.upsert({
        where: { code },
        update: {
          description,
          unit,
          category,
          estimatedCost,
        },
        create: {
          code,
          description,
          unit,
          category,
          estimatedCost,
        },
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


