import { DocumentStatus, Prisma, PrismaClient } from "@prisma/client";
import { ensureGeneralExpenses } from "../src/domain/generalExpenses";
import { postMovement } from "../src/domain/budget";
import { recalculateProjectFinancials } from "../src/domain/projectFinancials";

/**
 * Datos de ejemplo para desarrollo: una obra genérica con presupuesto en árbol, un pedido
 * y una OC emitida (ya descontada del presupuesto vía libro mayor).
 *
 * No borra nada salvo que se ejecute con SEED_RESET=true, y aun así se niega si la base
 * ya tiene obras que no son de ejemplo.
 */
const prisma = new PrismaClient();
const D = (v: string | number) => new Prisma.Decimal(v);
const DEMO_CODE = "OBRA-DEMO";

async function reset() {
  const real = await prisma.project.count({ where: { code: { not: DEMO_CODE } } });
  if (real > 0) {
    throw new Error("La base tiene obras reales: SEED_RESET no se aplica. Usá una base de desarrollo.");
  }
  await prisma.budgetMovement.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.warehouseStock.deleteMany();
  await prisma.documentAuditLog.deleteMany();
  await prisma.purchaseOrderDetail.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.materialRequestDetail.deleteMany();
  await prisma.materialRequest.deleteMany();
  await prisma.workFront.deleteMany();
  await prisma.budgetItem.updateMany({ data: { parentId: null } });
  await prisma.budgetItem.deleteMany();
  await prisma.budgetImport.deleteMany();
  await prisma.project.deleteMany();
}

async function main() {
  if (process.env.SEED_RESET === "true") await reset();
  if (await prisma.project.findUnique({ where: { code: DEMO_CODE } })) {
    console.log(`La obra ${DEMO_CODE} ya existe; no se vuelve a crear.`);
    return;
  }

  const chief =
    (await prisma.personnel.findFirst({ where: { role: "JEFE_FRENTE" } })) ??
    (await prisma.personnel.create({ data: { fullName: "Jefe de frente (ejemplo)", role: "JEFE_FRENTE" } }));

  const project = await prisma.project.create({
    data: {
      code: DEMO_CODE,
      name: "Obra de ejemplo",
      location: "Asunción, Paraguay",
      clientName: "Comitente de ejemplo",
      currency: "PYG",
      globalBudget: D("1950000000"),
      montoContractualManual: D("1950000000"),
    },
  });

  // Árbol: 2 rubros con sus ítems (los rubros no llevan monto propio).
  const rubro = (code: string, name: string, sortOrder: number) =>
    prisma.budgetItem.create({
      data: { projectId: project.id, code, name, category: name, path: code, nodeKind: "RUBRO", sortOrder },
    });
  const item = (
    parent: { id: number; path: string; name: string },
    code: string,
    name: string,
    unit: string,
    qty: number,
    pu: number,
    sortOrder: number
  ) =>
    prisma.budgetItem.create({
      data: {
        projectId: project.id,
        parentId: parent.id,
        code,
        name,
        category: parent.name,
        unit,
        totalQuantity: D(qty),
        unitPrice: D(pu),
        originalAmount: D(qty * pu),
        path: `${parent.path}/${code}`,
        hierarchyLevel: 1,
        nodeKind: "ITEM",
        sortOrder,
      },
    });

  const fundaciones = await rubro("1", "FUNDACIONES", 1);
  const zapatas = await item(fundaciones, "1.1", "Zapatas de hormigón armado", "m3", 120, 3_500_000, 2);
  await item(fundaciones, "1.2", "Vigas de fundación", "m3", 60, 3_800_000, 3);
  const albanileria = await rubro("2", "ALBAÑILERÍA", 4);
  await item(albanileria, "2.1", "Muro de ladrillo común 0,15", "m2", 2500, 180_000, 5);
  await item(albanileria, "2.2", "Revoque interior", "m2", 4000, 45_000, 6);
  await prisma.$transaction((tx) => ensureGeneralExpenses(tx, project.id));

  const frente = await prisma.workFront.create({
    data: { projectId: project.id, name: "Frente 1", chiefId: chief.id },
  });

  const proveedor =
    (await prisma.partner.findFirst({ where: { kind: { in: ["SUPPLIER", "BOTH"] } } })) ??
    (await prisma.partner.create({ data: { kind: "SUPPLIER", name: "Proveedor de ejemplo S.A.", taxId: "80000001-0" } }));
  const cemento =
    (await prisma.material.findUnique({ where: { code: "CEM-DEMO" } })) ??
    (await prisma.material.create({
      data: { code: "CEM-DEMO", description: "Cemento Portland (bolsa 50 kg)", unit: "bolsa", category: "CONGLOMERANTES", estimatedCost: D(65_000) },
    }));

  const request = await prisma.materialRequest.create({
    data: {
      number: "PM-DEMO-1",
      projectId: project.id,
      workFrontId: frente.id,
      requestedById: chief.id,
      status: DocumentStatus.EMITIDA,
      notes: "Cemento para zapatas",
      details: { create: [{ materialId: cemento.id, budgetItemId: zapatas.id, quantity: D(400) }] },
    },
    include: { details: true },
  });

  const qty = D(400);
  const price = D(65_000);
  const subtotal = qty.times(price);
  const po = await prisma.purchaseOrder.create({
    data: {
      number: "OC-DEMO-1",
      projectId: project.id,
      partnerId: proveedor.id,
      materialRequestId: request.id,
      status: DocumentStatus.EMITIDA,
      issueDate: new Date(),
      totalAmount: subtotal,
      details: {
        create: {
          materialId: cemento.id,
          requestDetailId: request.details[0].id,
          budgetItemId: zapatas.id,
          quantity: qty,
          unitPrice: price,
          subtotal,
        },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    await postMovement(tx, {
      projectId: project.id,
      budgetItemId: zapatas.id,
      amount: subtotal,
      source: "PURCHASE_ORDER",
      stage: "COMMITTED",
      sourceType: "PurchaseOrder",
      sourceId: po.id,
      sourceNumber: po.number,
      note: "Datos de ejemplo",
    });
    await recalculateProjectFinancials(tx, project.id);
  });

  console.log("Seed listo:", { obra: project.code, oc: po.number, pedido: request.number });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
