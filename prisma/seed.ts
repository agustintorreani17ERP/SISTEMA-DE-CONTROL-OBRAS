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
  await prisma.conteoInventario.deleteMany();
  await prisma.avanceItem.deleteMany();
  await prisma.avancePlanificado.deleteMany();
  await prisma.cierrePeriodo.deleteMany();
  await prisma.parteEquipo.deleteMany();
  await prisma.parteHoraPersonal.deleteMany();
  await prisma.cargaCombustible.deleteMany();
  await prisma.viajeCamion.deleteMany();
  await prisma.parteDiario.deleteMany();
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

/** Insumos sin historial: su costo estimado pasa a ser el primer precio vigente. Idempotente. */
async function backfillMaterialPrices() {
  const sinPrecio = await prisma.material.findMany({ where: { prices: { none: {} } }, select: { id: true, estimatedCost: true } });
  if (!sinPrecio.length) return;
  await prisma.materialPrice.createMany({
    data: sinPrecio.map((m) => ({
      materialId: m.id,
      price: m.estimatedCost,
      validFrom: new Date("2000-01-01T00:00:00Z"),
      source: "BACKFILL",
    })),
  });
  console.log(`Precio inicial cargado para ${sinPrecio.length} insumos.`);
}

/** Plan de cuentas básico de constructora (PY). Idempotente por código; no depende de la obra demo. */
async function ensurePlanDeCuentas() {
  type Cuenta = { codigo: string; nombre: string; tipo: "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO"; imputable?: boolean };
  const cuentas: Cuenta[] = [
    { codigo: "1", nombre: "ACTIVO", tipo: "ACTIVO", imputable: false },
    { codigo: "1.1", nombre: "Disponibilidades", tipo: "ACTIVO", imputable: false },
    { codigo: "1.1.01", nombre: "Caja", tipo: "ACTIVO" },
    { codigo: "1.1.02", nombre: "Caja chica", tipo: "ACTIVO" },
    { codigo: "1.1.03", nombre: "Bancos", tipo: "ACTIVO" },
    { codigo: "1.2", nombre: "Créditos", tipo: "ACTIVO", imputable: false },
    { codigo: "1.2.01", nombre: "Deudores por certificados", tipo: "ACTIVO" },
    { codigo: "1.2.02", nombre: "Anticipos a proveedores", tipo: "ACTIVO" },
    { codigo: "1.2.03", nombre: "Anticipos a subcontratistas", tipo: "ACTIVO" },
    { codigo: "1.2.04", nombre: "Fondo de reparo a cobrar", tipo: "ACTIVO" },
    { codigo: "1.2.05", nombre: "IVA crédito fiscal", tipo: "ACTIVO" },
    { codigo: "1.3", nombre: "Bienes de cambio", tipo: "ACTIVO", imputable: false },
    { codigo: "1.3.01", nombre: "Stock de obra", tipo: "ACTIVO" },

    { codigo: "2", nombre: "PASIVO", tipo: "PASIVO", imputable: false },
    { codigo: "2.1", nombre: "Deudas comerciales", tipo: "PASIVO", imputable: false },
    { codigo: "2.1.01", nombre: "Proveedores", tipo: "PASIVO" },
    { codigo: "2.1.02", nombre: "Subcontratistas", tipo: "PASIVO" },
    { codigo: "2.1.03", nombre: "Fondo de reparo a pagar", tipo: "PASIVO" },
    { codigo: "2.2", nombre: "Deudas fiscales y sociales", tipo: "PASIVO", imputable: false },
    { codigo: "2.2.01", nombre: "IVA débito fiscal", tipo: "PASIVO" },
    { codigo: "2.2.02", nombre: "Retenciones a pagar", tipo: "PASIVO" },
    { codigo: "2.2.03", nombre: "Sueldos a pagar", tipo: "PASIVO" },
    { codigo: "2.2.04", nombre: "IPS a pagar", tipo: "PASIVO" },

    { codigo: "3", nombre: "PATRIMONIO", tipo: "PATRIMONIO", imputable: false },
    { codigo: "3.1", nombre: "Capital", tipo: "PATRIMONIO" },
    { codigo: "3.2", nombre: "Resultados acumulados", tipo: "PATRIMONIO" },

    { codigo: "4", nombre: "INGRESOS", tipo: "INGRESO", imputable: false },
    { codigo: "4.1", nombre: "Ingresos por obra", tipo: "INGRESO" },

    { codigo: "5", nombre: "EGRESOS", tipo: "EGRESO", imputable: false },
    { codigo: "5.1", nombre: "Costos de obra", tipo: "EGRESO", imputable: false },
    { codigo: "5.1.01", nombre: "Costo de obra - materiales", tipo: "EGRESO" },
    { codigo: "5.1.02", nombre: "Costo de obra - mano de obra", tipo: "EGRESO" },
    { codigo: "5.1.03", nombre: "Costo de obra - subcontratos", tipo: "EGRESO" },
    { codigo: "5.1.04", nombre: "Costo de obra - equipos", tipo: "EGRESO" },
    { codigo: "5.2", nombre: "Gastos generales", tipo: "EGRESO" },
  ];

  const idByCodigo = new Map<string, number>();
  for (const c of cuentas) {
    const parentCodigo = c.codigo.includes(".") ? c.codigo.slice(0, c.codigo.lastIndexOf(".")) : null;
    const parentId = parentCodigo ? idByCodigo.get(parentCodigo) ?? null : null;
    const row = await prisma.cuentaContable.upsert({
      where: { codigo: c.codigo },
      update: { nombre: c.nombre, tipo: c.tipo, imputable: c.imputable ?? true, parentId },
      create: { codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, imputable: c.imputable ?? true, parentId },
    });
    idByCodigo.set(c.codigo, row.id);
  }
  return idByCodigo;
}

/**
 * Reglas de asiento por evento contable: qué cuenta se debita/acredita en cada postAsientoDesdeRegla().
 * Editable desde la base (tabla ReglaAsientoContable), no toca código para cambiar una cuenta.
 */
async function ensureReglasAsiento(idByCodigo: Map<string, number>) {
  const reglas: { evento: string; debe: string; haber: string }[] = [
    { evento: "OC_RECIBIDA", debe: "5.1.01", haber: "2.1.01" },
    { evento: "FACTURA_RECIBIDA", debe: "5.1.01", haber: "2.1.01" },
    { evento: "CERTIFICADO_SUBCONTRATISTA_APROBADO", debe: "5.1.03", haber: "2.1.02" },
    { evento: "LIQUIDACION_APROBADA", debe: "5.1.02", haber: "2.2.03" },
    { evento: "CAJA_CHICA_RENDIDA", debe: "5.2", haber: "1.1.02" },
    { evento: "FACTURA_CLIENTE_EMITIDA", debe: "1.2.01", haber: "4.1" },
    { evento: "PAGO_FACTURA", debe: "2.1.01", haber: "1.1.03" },
  ];
  for (const r of reglas) {
    const cuentaDebeId = idByCodigo.get(r.debe);
    const cuentaHaberId = idByCodigo.get(r.haber);
    if (!cuentaDebeId || !cuentaHaberId) throw new Error(`Regla ${r.evento}: cuenta ${r.debe} o ${r.haber} no existe en el plan de cuentas`);
    await prisma.reglaAsientoContable.upsert({
      where: { evento: r.evento },
      update: { cuentaDebeId, cuentaHaberId },
      create: { evento: r.evento, cuentaDebeId, cuentaHaberId },
    });
  }
}

async function main() {
  if (process.env.SEED_RESET === "true") await reset();
  await ensureReglasAsiento(await ensurePlanDeCuentas());
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
  .then(backfillMaterialPrices)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
