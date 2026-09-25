import { DocumentStatus, PrismaClient, SubcontractStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const D = (v: string | number) => new Prisma.Decimal(v);

async function main() {
  await prisma.stockMovement.deleteMany();
  await prisma.warehouseStock.deleteMany();
  await prisma.documentAuditLog.deleteMany();
  await prisma.budgetCommitment.deleteMany();
  await prisma.purchaseOrderDetail.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.materialRequestDetail.deleteMany();
  await prisma.materialRequest.deleteMany();
  await prisma.subcontractorCertificate.deleteMany();
  await prisma.subcontractorContract.deleteMany();
  await prisma.workFront.deleteMany();
  await prisma.budgetItem.deleteMany();
  await prisma.project.deleteMany();
  await prisma.personnel.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.material.deleteMany();

  const chief = await prisma.personnel.create({
    data: {
      fullName: "Ing. Carlos Benítez",
      role: "JEFE_FRENTE",
      email: "cbenitez@obra.local",
    },
  });

  const project = await prisma.project.create({
    data: {
      code: "PY02-T3",
      name: "Ruta Nacional PY02 — Tramo Caaguazú–Coronel Oviedo",
      location: "Caaguazú, Paraguay",
      roadSection: "Km 132 – Km 168",
      contractNumber: "MOPC-2024-VIAL-041",
      globalBudget: D("18500000000"),
      startDate: new Date("2025-03-01"),
      endDate: new Date("2027-08-31"),
    },
  });

  const [movimiento, estructuras, pavimento] = await Promise.all([
    prisma.budgetItem.create({
      data: {
        projectId: project.id,
        code: "01-MS",
        name: "Movimiento de suelo",
        category: "TERRAPLEN",
        originalAmount: D("4200000000"),
      },
    }),
    prisma.budgetItem.create({
      data: {
        projectId: project.id,
        code: "02-EST",
        name: "Estructuras (alcantarillas y puentes menores)",
        category: "ESTRUCTURAS",
        originalAmount: D("5100000000"),
      },
    }),
    prisma.budgetItem.create({
      data: {
        projectId: project.id,
        code: "03-PAV",
        name: "Pavimento asfáltico",
        category: "PAVIMENTO",
        originalAmount: D("9200000000"),
      },
    }),
  ]);

  const frente = await prisma.workFront.create({
    data: {
      projectId: project.id,
      name: "Frente 1 — Calzada Este",
      chiefId: chief.id,
    },
  });

  const [asfaltos, aceros, subPav] = await Promise.all([
    prisma.partner.create({
      data: {
        kind: "SUPPLIER",
        name: "Asfaltos del Este S.A.",
        taxId: "80012345-6",
        fiscalAddress: "Ruta 2 km 14, Ciudad del Este",
        phone: "+595 21 555-010",
        classification: "EMULSION_ASFALTICA",
      },
    }),
    prisma.partner.create({
      data: {
        kind: "SUPPLIER",
        name: "Aceros Guaraní S.A.",
        taxId: "80098765-1",
        fiscalAddress: "Av. Artigas 2450, Asunción",
        phone: "+595 21 555-220",
        classification: "ACERO_CORUGADO",
      },
    }),
    prisma.partner.create({
      data: {
        kind: "SUBCONTRACTOR",
        name: "Pavimentadora del Sur Ltda.",
        taxId: "80112233-4",
        fiscalAddress: "Encarnación",
        classification: "PAVIMENTO_FLEXIBLE",
      },
    }),
  ]);

  const [cemento, emulsion, acero, aridos] = await Promise.all([
    prisma.material.create({
      data: {
        code: "CEM-CPC40",
        description: "Cemento Portland CPC-40",
        unit: "ton",
        category: "CONGLOMERANTES",
        estimatedCost: D("1850000"),
      },
    }),
    prisma.material.create({
      data: {
        code: "EMU-CRS1",
        description: "Emulsión asfáltica CRS-1",
        unit: "ton",
        category: "LIGANTES",
        estimatedCost: D("6200000"),
      },
    }),
    prisma.material.create({
      data: {
        code: "ACE-12",
        description: "Acero corrugado Ø12 mm",
        unit: "kg",
        category: "ACERO",
        estimatedCost: D("8500"),
      },
    }),
    prisma.material.create({
      data: {
        code: "ARI-3/4",
        description: "Árido triturado 3/4\"",
        unit: "m3",
        category: "AGREGADOS",
        estimatedCost: D("210000"),
      },
    }),
  ]);

  const request = await prisma.materialRequest.create({
    data: {
      number: "PM-000001",
      projectId: project.id,
      workFrontId: frente.id,
      requestedById: chief.id,
      status: DocumentStatus.APROBADO_PARA_COMPRA,
      notes: "Riego de liga tramo km 140-142",
      details: {
        create: [
          {
            materialId: emulsion.id,
            budgetItemId: pavimento.id,
            quantity: D("18"),
          },
          {
            materialId: aridos.id,
            budgetItemId: pavimento.id,
            quantity: D("120"),
          },
        ],
      },
    },
    include: { details: true },
  });

  const emuLine = request.details.find((d) => d.materialId === emulsion.id)!;
  const qty = D("12");
  const price = D("6150000");
  const subtotal = qty.times(price).toDecimalPlaces(2);

  const po = await prisma.purchaseOrder.create({
    data: {
      number: "OC-000001",
      projectId: project.id,
      partnerId: asfaltos.id,
      materialRequestId: request.id,
      status: DocumentStatus.EMITIDA,
      issueDate: new Date(),
      totalAmount: subtotal,
      details: {
        create: {
          materialId: emulsion.id,
          requestDetailId: emuLine.id,
          budgetItemId: pavimento.id,
          quantity: qty,
          unitPrice: price,
          subtotal,
        },
      },
    },
  });

  await prisma.budgetItem.update({
    where: { id: pavimento.id },
    data: { committedAmount: { increment: subtotal } },
  });
  await prisma.budgetCommitment.create({
    data: {
      budgetItemId: pavimento.id,
      kind: "PURCHASE_ORDER",
      amount: subtotal,
      sourceType: "PurchaseOrder",
      sourceId: po.id,
      note: "Seed OC-000001",
    },
  });
  await prisma.materialRequest.update({
    where: { id: request.id },
    data: { status: DocumentStatus.EMITIDA },
  });

  const contract = await prisma.subcontractorContract.create({
    data: {
      number: "SC-000001",
      projectId: project.id,
      partnerId: subPav.id,
      budgetItemId: pavimento.id,
      description: "Colocación de carpeta asfáltica 5 cm — km 132 a 145",
      contractAmount: D("1800000000"),
      status: SubcontractStatus.BORRADOR,
    },
  });

  await prisma.documentAuditLog.createMany({
    data: [
      {
        entity: "PurchaseOrder",
        entityId: po.id,
        action: "SEED_ISSUE",
        toStatus: DocumentStatus.EMITIDA,
      },
      {
        entity: "SubcontractorContract",
        entityId: contract.id,
        action: "SEED_CREATE",
        toStatus: SubcontractStatus.BORRADOR,
      },
    ],
  });

  console.log("Seed vial listo:", {
    project: project.code,
    po: po.number,
    request: request.number,
    suppliers: [asfaltos.name, aceros.name],
    unused: { cemento: cemento.code, estructuras: estructuras.code, movimiento: movimiento.code },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
