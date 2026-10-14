import { Router, Request, Response } from "express";
import { z } from "zod";
import { CertificationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { recalculateProjectFinancials } from "../../../bridge/domain/projectFinancials";
import {
  assertImputableItem,
  postCost,
  postMovement,
  type BudgetWarning,
} from "../../domain/budget";
import { moneyNumber } from "../../../lib/money";
import { auxSubtotal, buildCertificate, measuredQuantity } from "./certMath";
import {
  controlMedicionSubcontratistas,
  measurementDate,
  modoControlMedicion,
} from "../../domain/medicion";
import { preciosSugeridosMO } from "../../domain/laborPrice";
import { alertasPrecio, type PrecioFuente } from "../../domain/laborPriceMath";
import { today } from "../../../core/domain/prices";
import { evaluateMatch } from "../../../bridge/finance";
import { facturarCertificadoCliente } from "../../../bridge/domain/clientBilling";
import { solicitudDesdeCertificacion } from "../../../bridge/finance";
import { usuarioDe } from "../../../http/usuario";
import {
  acumuladoPorLinea,
  contextoItems,
  lineasSinRubro,
  mensajeLineasSinRubro,
} from "../../domain/asignacionMO";
import {
  assertSinLineasPendientes,
  limpiarLineasHuerfanas,
  resolverLinea,
} from "../../domain/subPlanilla";
import { GENERAL_EXPENSES_ROOT_PATH } from "../../domain/generalExpenses";

/**
 * Mediciones y certificados.
 * Flujo: Medición (MEDICION_BORRADOR) → borrador de certificado (CERTIFICADO_BORRADOR) → APROBADO.
 * Destino: avance de obra al cliente (sin partner, precio de venta) o subcontratista
 * (partner, precio de la lista de mano de obra).
 */
export const advancedCertificationsRouter = Router();

const auxiliaryCalculationSchema = z.object({
  descripcion: z.string().trim().default(""),
  location: z.string().trim().max(200).optional().nullable(),
  largo: z.coerce.number().min(0).default(0),
  ancho: z.coerce.number().min(0).default(0),
  alto: z.coerce.number().min(0).default(0),
  factor_repeticion: z.coerce.number().min(0).default(1),
  isDeduction: z.coerce.boolean().default(false),
  needsReview: z.coerce.boolean().default(false),
});

const itemPhotoSchema = z.object({
  url: z.string().min(1),
  comentario: z.string().optional().nullable(),
  fechaCaptura: z.string().optional().nullable(),
});

const itemInputSchema = z.object({
  /** Subcontratista: puede faltar en borrador (se exige al aprobar). */
  budgetItemId: z.coerce.number().int().positive().optional().nullable(),
  /** Planilla del subcontratista: frente + rubro de la lista de MO (y la línea, si ya existe). */
  planillaLineaId: z.coerce.number().int().positive().optional().nullable(),
  workFrontId: z.coerce.number().int().positive().optional().nullable(),
  laborPriceId: z.coerce.number().int().positive().optional().nullable(),
  cantidadPresente: z.coerce.number().min(0).default(0),
  precioUnitario: z.coerce.number().min(0).optional(),
  priceSource: z.enum(["VENTA", "MANO_DE_OBRA"]).optional(),
  auxiliaryCalculations: z.array(auxiliaryCalculationSchema).default([]),
  photos: z.array(itemPhotoSchema).default([]),
});

const measurementSchema = z.object({
  projectId: z.coerce.number().int().positive("La obra es obligatoria"),
  partnerId: z.coerce.number().int().positive().optional().nullable(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
  fecha: z.string().optional(),
  periodFrom: z.string().optional().nullable(),
  periodTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z
    .array(itemInputSchema)
    .min(1, "Agregá al menos un rubro a la medición"),
});

const certificationInclude = {
  project: true,
  partner: true,
  contract: true,
  items: {
    include: {
      budgetItem: true,
      auxiliaryCalculations: true,
      photos: true,
      planillaLinea: { include: { workFront: true, laborPrice: true } },
    },
    orderBy: { id: "asc" as const },
  },
  invoices: { include: { payments: true } },
} satisfies Prisma.CertificationInclude;

const parseOptionalId = (raw: unknown) =>
  raw && raw !== "null" && raw !== "undefined" ? Number(raw) : null;

async function nextNumber(projectId: number, partnerId: number | null) {
  const latest = await prisma.certification.findFirst({
    where: { projectId, partnerId },
    orderBy: { numero: "desc" },
  });
  return (latest?.numero || 0) + 1;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Acumulado anterior: solo certificados APROBADOS del mismo destino. Al cliente va por rubro;
 * el subcontratista va por línea de planilla (`porLinea`).
 */
async function approvedHistory(
  db: Db,
  projectId: number,
  partnerId: number | null,
  excludeId?: number,
) {
  const certs = await db.certification.findMany({
    where: { projectId, partnerId, estado: CertificationStatus.APROBADO },
    include: { items: true },
  });
  const items = certs.filter((c) => c.id !== excludeId).flatMap((c) => c.items);
  const porRubro = new Map<number, number>();
  for (const i of items)
    if (i.budgetItemId !== null)
      porRubro.set(
        i.budgetItemId,
        (porRubro.get(i.budgetItemId) ?? 0) + moneyNumber(i.cantidadPresente),
      );
  const porLinea = acumuladoPorLinea(
    items.map((i) => ({
      planillaLineaId: i.planillaLineaId,
      cantidad: moneyNumber(i.cantidadPresente),
    })),
  );
  return { porRubro, porLinea };
}

const anteriorDe = (
  h: Awaited<ReturnType<typeof approvedHistory>>,
  partnerId: number | null,
  i: { budgetItemId: number | null; planillaLineaId: number | null },
) =>
  partnerId
    ? i.planillaLineaId !== null
      ? (h.porLinea.get(i.planillaLineaId) ?? 0)
      : 0
    : i.budgetItemId !== null
      ? (h.porRubro.get(i.budgetItemId) ?? 0)
      : 0;

/** Cantidad medida de cada renglón por ítem (control de subcontratistas y libro mayor). */
const medidoItems = (
  items: {
    budgetItemId: number | null;
    cantidadPresente: Prisma.Decimal;
  }[],
) =>
  items
    .filter(
      (i): i is typeof i & { budgetItemId: number } => i.budgetItemId !== null,
    )
    .map((i) => ({
      budgetItemId: i.budgetItemId,
      quantity: moneyNumber(i.cantidadPresente),
    }))
    .filter((l) => l.quantity > 0);

const labelOf = (i: {
  budgetItem: { code: string; name: string } | null;
  planillaLinea?: {
    numero: string;
    laborPrice: { description: string };
  } | null;
}) =>
  i.planillaLinea
    ? {
        code: i.planillaLinea.numero,
        name: i.planillaLinea.laborPrice.description,
      }
    : {
        code: i.budgetItem?.code ?? "—",
        name: i.budgetItem?.name ?? "Sin rubro",
      };

/** Avisos de precio de un certificado de subcontratista: distinto del sugerido o sin referencia. */
function priceWarningsOf(
  items: {
    precioUnitario: Prisma.Decimal;
    precioSugerido: Prisma.Decimal | null;
    precioFuente: string | null;
    budgetItem: { code: string; name: string } | null;
    planillaLinea?: {
      numero: string;
      laborPrice: { description: string };
    } | null;
  }[],
) {
  return alertasPrecio(
    items.map((i) => ({
      ...labelOf(i),
      precio: moneyNumber(i.precioUnitario),
      sugerido:
        i.precioSugerido === null ? null : moneyNumber(i.precioSugerido),
      fuente: (i.precioFuente as PrecioFuente | null) ?? null,
    })),
  );
}

advancedCertificationsRouter.get(
  "/next-number",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0)
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = parseOptionalId(req.query.partnerId);
    const n = await nextNumber(projectId, partnerId);
    ok(res, {
      projectId,
      partnerId,
      tipo: partnerId ? "SUBCONTRATISTA" : "OBRA_CLIENTE",
      nextNumber: n,
      displayLabel: `Medición N° ${String(n).padStart(2, "0")}`,
    });
  }),
);

/**
 * GET /api/certifications/rubros-disponibles?projectId&partnerId
 * Rubros medibles con cantidad contratada, acumulado aprobado del destino y precio:
 * venta (avance de obra) o mano de obra (subcontratista).
 */
advancedCertificationsRouter.get(
  "/rubros-disponibles",
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0)
      throw new DomainError("INVALID_PROJECT", "La obra es obligatoria");
    const partnerId = parseOptionalId(req.query.partnerId);

    const [items, history] = await Promise.all([
      prisma.budgetItem.findMany({
        where: { projectId, nodeKind: "ITEM", isSystem: false },
        orderBy: { sortOrder: "asc" },
      }),
      approvedHistory(prisma, projectId, partnerId),
    ]);
    const labor = partnerId
      ? await preciosSugeridosMO(
          prisma,
          projectId,
          items.map((i) => i.id),
          today(),
        )
      : new Map();

    const rubros = items.map((bi) => {
      const salePrice = moneyNumber(bi.unitPrice);
      const sugerido = labor.get(bi.id) ?? null;
      const laborPrice = sugerido?.precio ?? null;
      const unitPrice = partnerId ? (laborPrice ?? 0) : salePrice;
      const cantidadAnterior = history.porRubro.get(bi.id) ?? 0;
      return {
        id: bi.id,
        code: bi.code,
        name: bi.name,
        category: bi.category,
        unit: bi.unit || "un",
        unitPrice,
        salePrice,
        laborPrice,
        /** De dónde sale el precio sugerido: lista de MO de la obra o MO del ACU. */
        laborPriceSource: sugerido?.fuente ?? null,
        priceSource: partnerId ? "MANO_DE_OBRA" : "VENTA",
        missingPrice: partnerId ? laborPrice === null : false,
        totalContractQuantity: moneyNumber(bi.totalQuantity),
        cantidadAnterior,
        montoAnterior: Math.round(cantidadAnterior * unitPrice),
      };
    });
    if (!partnerId) return ok(res, rubros);
    ok(res, await planillaSub(projectId, partnerId, rubros, history.porLinea));
  }),
);

/**
 * Datos de la planilla del subcontratista: frentes, lista de MO, ítems con Área y capítulo
 * (los códigos se repiten dentro de un Área), líneas del contratista con su acumulado aprobado
 * e historial de asignaciones de la obra (memoria de la sugerencia).
 */
async function planillaSub<T extends { id: number }>(
  projectId: number,
  partnerId: number,
  rubros: T[],
  acumulado: Map<number, number>,
) {
  const [frentes, listaMO, nodos, lineas, gg] = await Promise.all([
    prisma.workFront.findMany({
      where: { projectId },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        codigo: true,
        tipo: true,
        budgetItemId: true,
      },
    }),
    prisma.laborPrice.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        unitPrice: true,
        sector: true,
      },
    }),
    prisma.budgetItem.findMany({
      where: { projectId, isSystem: false },
      select: { id: true, parentId: true, code: true, name: true },
    }),
    prisma.subPlanillaLinea.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
    }),
    prisma.budgetItem.findFirst({
      where: { projectId, path: `${GENERAL_EXPENSES_ROOT_PATH}/GG.03` },
      select: { id: true, code: true, name: true, unit: true },
    }),
  ]);
  const ctx = contextoItems(nodos);
  return {
    tipo: "SUBCONTRATISTA" as const,
    items: rubros.map((r) => ({
      ...r,
      areaId: ctx.get(r.id)?.areaId ?? null,
      capitulo: ctx.get(r.id)?.capitulo ?? "",
    })),
    frentes,
    listaMO: listaMO.map((l) => ({
      ...l,
      unitPrice: moneyNumber(l.unitPrice),
    })),
    lineas: lineas
      .filter((l) => l.partnerId === partnerId)
      .map((l) => ({
        ...l,
        cantidadAnterior: acumulado.get(l.id) ?? 0,
      })),
    historial: lineas.map((l) => ({
      id: l.id,
      workFrontId: l.workFrontId,
      laborPriceId: l.laborPriceId,
      budgetItemId: l.budgetItemId,
    })),
    gastosGenerales: gg,
  };
}

advancedCertificationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, partnerId, estado } = req.query;
    const where: Prisma.CertificationWhereInput = {};
    if (projectId) where.projectId = Number(projectId);
    if (partnerId !== undefined && partnerId !== "") {
      where.partnerId =
        partnerId === "null" || partnerId === "0" ? null : Number(partnerId);
    }
    if (estado) where.estado = String(estado) as CertificationStatus;
    ok(
      res,
      await prisma.certification.findMany({
        where,
        include: certificationInclude,
        orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      }),
    );
  }),
);

/**
 * GET /api/certifications/:id/summary
 * Medición N y Cert N con acumulados, % de avance, saldo, fondo de reparo, neto y
 * verificaciones finales (formato de certificados de subcontratistas).
 */
advancedCertificationsRouter.get(
  "/:id/summary",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: certificationInclude,
    });
    if (!cert) throw new NotFoundError("Certificación", id);
    const history = await approvedHistory(
      prisma,
      cert.projectId,
      cert.partnerId,
      cert.id,
    );

    const rows = cert.items.map((i) => ({
      ...labelOf(i),
      unit: i.planillaLinea?.laborPrice.unit || i.budgetItem?.unit || "un",
      contractedQuantity: cert.partnerId
        ? 0
        : moneyNumber(i.budgetItem?.totalQuantity ?? 0),
      previousQuantity:
        cert.estado === CertificationStatus.APROBADO
          ? moneyNumber(i.cantidadAnterior)
          : anteriorDe(history, cert.partnerId, i),
      periodQuantity: moneyNumber(i.cantidadPresente),
      unitPrice: moneyNumber(i.precioUnitario),
    }));
    const summary = buildCertificate(rows, moneyNumber(cert.retentionPct));
    const pendingReview = cert.items.flatMap((i) =>
      i.auxiliaryCalculations.filter((a) => a.needsReview),
    ).length;
    const itemsTotal = cert.items.reduce(
      (acc, i) => acc + moneyNumber(i.montoTotal),
      0,
    );

    ok(res, {
      certification: cert,
      summary,
      checks: {
        measurementMatchesCertificate:
          Math.abs(itemsTotal - summary.periodAmount) < 1,
        previousMatchesHistory: rows.every(
          (r, idx) =>
            Math.abs(
              r.previousQuantity -
                moneyNumber(cert.items[idx].cantidadAnterior),
            ) < 1e-6,
        ),
        noPendingReview: pendingReview === 0,
        pendingReview,
        overContract: summary.rows
          .filter((r) => r.overContract)
          .map((r) => r.code),
        sinRubro: cert.partnerId
          ? lineasSinRubro(
              cert.items.map((i) => ({
                budgetItemId: i.budgetItemId,
                numero: i.planillaLinea?.numero ?? null,
              })),
            )
          : [],
        priceWarnings: cert.partnerId ? priceWarningsOf(cert.items) : [],
        controlMedicionSub: await modoControlMedicion(prisma, cert.projectId),
        overMeasured:
          cert.partnerId && cert.estado !== CertificationStatus.APROBADO
            ? await controlMedicionSubcontratistas(
                prisma,
                cert.projectId,
                medidoItems(cert.items),
                { soloAvisar: true },
              )
            : [],
      },
    });
  }),
);

advancedCertificationsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: certificationInclude,
    });
    if (!cert) throw new NotFoundError("Certificación", id);
    ok(res, cert);
  }),
);

/** Guarda los ítems de una medición (con cálculo auxiliar y fotos) y devuelve el total. */
async function writeItems(
  tx: Prisma.TransactionClient,
  certificationId: number,
  projectId: number,
  partnerId: number | null,
  items: z.infer<typeof itemInputSchema>[],
  fecha: Date,
) {
  const history = await approvedHistory(
    tx,
    projectId,
    partnerId,
    certificationId,
  );
  if (partnerId)
    return writeSubItems(
      tx,
      certificationId,
      projectId,
      partnerId,
      items,
      history.porLinea,
    );

  let total = 0;
  for (const input of items) {
    if (!input.budgetItemId)
      throw new DomainError("RUBRO_REQUIRED", "El rubro es obligatorio", 422);
    const budgetItem = await assertImputableItem(
      tx,
      projectId,
      input.budgetItemId,
    );
    const priceSource = input.priceSource ?? "VENTA";
    const unitPrice =
      input.precioUnitario !== undefined
        ? input.precioUnitario
        : moneyNumber(budgetItem.unitPrice);
    const presentQty = input.auxiliaryCalculations.length
      ? measuredQuantity(input.auxiliaryCalculations)
      : input.cantidadPresente;
    const previous = history.porRubro.get(budgetItem.id) ?? 0;
    const amount = Math.round(presentQty * unitPrice);
    total += amount;

    const created = await tx.certificationItem.create({
      data: {
        certificationId,
        budgetItemId: budgetItem.id,
        cantidadAnterior: previous,
        cantidadPresente: presentQty,
        cantidadAcumulada: previous + presentQty,
        precioUnitario: unitPrice,
        montoTotal: amount,
        priceSource,
      },
    });
    await writeDetail(tx, created.id, input);
  }
  return total;
}

/** Cómputo auxiliar y fotos de un renglón. */
async function writeDetail(
  tx: Prisma.TransactionClient,
  certificationItemId: number,
  input: z.infer<typeof itemInputSchema>,
) {
  for (const ac of input.auxiliaryCalculations) {
    await tx.auxiliaryCalculation.create({
      data: {
        certificationItemId,
        descripcion: ac.descripcion || ac.location || "Medición",
        location: ac.location ?? null,
        largo: ac.largo,
        ancho: ac.ancho,
        alto: ac.alto,
        factor_repeticion: ac.factor_repeticion,
        isDeduction: ac.isDeduction,
        needsReview: ac.needsReview,
        subtotal: auxSubtotal(ac),
      },
    });
  }
  for (const photo of input.photos) {
    await tx.itemPhoto.create({
      data: {
        certificationItemId,
        url: photo.url,
        comentario: photo.comentario ?? null,
        fechaCaptura: photo.fechaCaptura
          ? new Date(photo.fechaCaptura)
          : new Date(),
      },
    });
  }
}

/**
 * Renglones de un certificado de subcontratista: cada uno es una línea de planilla (frente +
 * rubro MO + rubro presupuestario), reutilizada entre certificados. Precio = lista de MO de la
 * obra (editable); el sugerido queda guardado para el aviso. El rubro puede faltar en borrador.
 */
async function writeSubItems(
  tx: Prisma.TransactionClient,
  certificationId: number,
  projectId: number,
  partnerId: number,
  items: z.infer<typeof itemInputSchema>[],
  acumulado: Map<number, number>,
) {
  let total = 0;
  for (const input of items) {
    if (!input.workFrontId || !input.laborPriceId) {
      throw new DomainError(
        "PLANILLA_REQUIRED",
        "Cada renglón del subcontratista lleva frente y rubro de la lista de MO",
        422,
      );
    }
    if (input.budgetItemId)
      await assertImputableItem(tx, projectId, input.budgetItemId);
    const linea = await resolverLinea(tx, projectId, partnerId, {
      planillaLineaId: input.planillaLineaId ?? null,
      workFrontId: input.workFrontId,
      laborPriceId: input.laborPriceId,
      budgetItemId: input.budgetItemId ?? null,
    });
    const lp = await tx.laborPrice.findUniqueOrThrow({
      where: { id: input.laborPriceId },
    });
    const sugerido = moneyNumber(lp.unitPrice);
    const insumo = await tx.material.findFirst({
      where: { code: `MO-${lp.code}` },
      select: { id: true },
    });
    const unitPrice =
      input.precioUnitario !== undefined ? input.precioUnitario : sugerido;
    const presentQty = input.auxiliaryCalculations.length
      ? measuredQuantity(input.auxiliaryCalculations)
      : input.cantidadPresente;
    const previous = acumulado.get(linea.id) ?? 0;
    const amount = Math.round(presentQty * unitPrice);
    total += amount;
    const created = await tx.certificationItem.create({
      data: {
        certificationId,
        budgetItemId: linea.budgetItemId,
        planillaLineaId: linea.id,
        cantidadAnterior: previous,
        cantidadPresente: presentQty,
        cantidadAcumulada: previous + presentQty,
        precioUnitario: unitPrice,
        montoTotal: amount,
        priceSource: "MANO_DE_OBRA",
        precioSugerido: sugerido,
        precioFuente: "LISTA_OBRA",
        insumoId: insumo?.id ?? null,
      },
    });
    await writeDetail(tx, created.id, input);
  }
  await limpiarLineasHuerfanas(tx, partnerId);
  return total;
}

/** POST /api/certifications — crea la medición (borrador) con su planilla. */
advancedCertificationsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = measurementSchema.parse(req.body);
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
    });
    if (!project) throw new NotFoundError("Obra", body.projectId);
    const partnerId = body.partnerId ?? null;

    let retentionPct = 0;
    if (partnerId) {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
      });
      if (!partner) throw new NotFoundError("Subcontratista", partnerId);
      if (partner.kind === "SUPPLIER")
        throw new DomainError(
          "INVALID_PARTNER",
          "Elegí un subcontratista",
          422,
        );
    }
    if (body.contractId) {
      const contract = await prisma.subcontractorContract.findUnique({
        where: { id: body.contractId },
      });
      if (!contract || contract.partnerId !== partnerId)
        throw new NotFoundError("Contrato del subcontratista", body.contractId);
      retentionPct = moneyNumber(contract.retentionPct);
    }

    const numero = await nextNumber(body.projectId, partnerId);
    const created = await prisma.$transaction(
      async (tx) => {
        const cert = await tx.certification.create({
          data: {
            projectId: body.projectId,
            partnerId,
            contractId: body.contractId ?? null,
            numero,
            fecha: body.fecha ? new Date(body.fecha) : new Date(),
            periodFrom: body.periodFrom ? new Date(body.periodFrom) : null,
            periodTo: body.periodTo ? new Date(body.periodTo) : null,
            estado: CertificationStatus.MEDICION_BORRADOR,
            retentionPct,
            notes: body.notes ?? null,
          },
        });
        const total = await writeItems(
          tx,
          cert.id,
          body.projectId,
          partnerId,
          body.items,
          cert.fecha,
        );
        return tx.certification.update({
          where: { id: cert.id },
          data: { montoTotal: total, netAmount: total },
          include: certificationInclude,
        });
      },
      { timeout: 60_000 },
    );
    ok(res, created, 201);
  }),
);

/** PUT /api/certifications/:id — edita la medición mientras está en borrador. */
advancedCertificationsRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundError("Certificación", id);
    if (cert.estado === CertificationStatus.APROBADO) {
      throw new DomainError(
        "MEASUREMENT_LOCKED",
        "El certificado ya está aprobado y no se puede modificar",
        409,
      );
    }
    const body = measurementSchema.partial().parse(req.body);
    const updated = await prisma.$transaction(
      async (tx) => {
        const data: Prisma.CertificationUpdateInput = {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.periodFrom !== undefined
            ? { periodFrom: body.periodFrom ? new Date(body.periodFrom) : null }
            : {}),
          ...(body.periodTo !== undefined
            ? { periodTo: body.periodTo ? new Date(body.periodTo) : null }
            : {}),
        };
        if (body.items?.length) {
          await tx.certificationItem.deleteMany({
            where: { certificationId: id },
          });
          const total = await writeItems(
            tx,
            id,
            cert.projectId,
            cert.partnerId,
            body.items,
            cert.fecha,
          );
          const retention = Math.round(
            (total * moneyNumber(cert.retentionPct)) / 100,
          );
          Object.assign(data, {
            montoTotal: total,
            retentionAmount: retention,
            netAmount: total - retention,
          });
        }
        const next = await tx.certification.update({
          where: { id },
          data,
          include: certificationInclude,
        });
        return next;
      },
      { timeout: 60_000 },
    );
    ok(res, updated);
  }),
);

/** Fondo de reparo del certificado (solo en borrador; lo confirma el usuario). */
advancedCertificationsRouter.patch(
  "/:id/retention",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { retentionPct } = z
      .object({ retentionPct: z.coerce.number().min(0).max(30) })
      .parse(req.body);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundError("Certificación", id);
    if (cert.estado === CertificationStatus.APROBADO) {
      throw new DomainError(
        "CERT_LOCKED",
        "El certificado ya está aprobado",
        409,
      );
    }
    const total = moneyNumber(cert.montoTotal);
    const retentionAmount = Math.round((total * retentionPct) / 100);
    ok(
      res,
      await prisma.certification.update({
        where: { id },
        data: {
          retentionPct,
          retentionAmount,
          netAmount: total - retentionAmount,
        },
        include: certificationInclude,
      }),
    );
  }),
);

/** POST /api/certifications/:id/close-measurement — cierra la medición y crea el borrador del certificado. */
advancedCertificationsRouter.post(
  "/:id/close-measurement",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({
      where: { id },
      include: { items: { include: { auxiliaryCalculations: true } } },
    });
    if (!existing) throw new NotFoundError("Certificación", id);
    const history = await approvedHistory(
      prisma,
      existing.projectId,
      existing.partnerId,
      id,
    );
    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError(
        "ALREADY_APPROVED",
        "El certificado ya está aprobado",
        409,
      );
    }
    let measurementWarnings: string[] = [];
    let priceWarnings: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const item of existing.items) {
        const qty = item.auxiliaryCalculations.length
          ? measuredQuantity(
              item.auxiliaryCalculations.map((a) => ({
                largo: moneyNumber(a.largo),
                ancho: moneyNumber(a.ancho),
                alto: moneyNumber(a.alto),
                factor_repeticion: moneyNumber(a.factor_repeticion),
                isDeduction: a.isDeduction,
              })),
            )
          : moneyNumber(item.cantidadPresente);
        const amount = Math.round(qty * moneyNumber(item.precioUnitario));
        total += amount;
        const anterior = anteriorDe(history, existing.partnerId, item);
        await tx.certificationItem.update({
          where: { id: item.id },
          data: {
            cantidadPresente: qty,
            cantidadAnterior: anterior,
            cantidadAcumulada: anterior + qty,
            montoTotal: amount,
          },
        });
      }
      const retentionAmount = Math.round(
        (total * moneyNumber(existing.retentionPct)) / 100,
      );
      const next = await tx.certification.update({
        where: { id },
        data: {
          estado: CertificationStatus.CERTIFICADO_BORRADOR,
          montoTotal: total,
          retentionAmount,
          netAmount: total - retentionAmount,
        },
        include: certificationInclude,
      });
      if (existing.partnerId) {
        // Subcontratista: se controla contra la medición oficial, no se mide de nuevo.
        measurementWarnings = await controlMedicionSubcontratistas(
          tx,
          existing.projectId,
          medidoItems(next.items),
        );
        priceWarnings = priceWarningsOf(next.items);
      }
      return next;
    });
    ok(res, { ...updated, measurementWarnings, priceWarnings });
  }),
);

/**
 * POST /api/certifications/:id/approve
 * Aprueba el certificado: descuenta del presupuesto (libro mayor), actualiza el contrato del
 * subcontratista y genera la factura.
 */
advancedCertificationsRouter.post(
  "/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const cert = await prisma.certification.findUnique({
      where: { id },
      include: {
        project: true,
        partner: true,
        items: {
          include: {
            budgetItem: true,
            planillaLinea: { include: { laborPrice: true } },
          },
        },
        invoices: true,
      },
    });
    if (!cert) throw new NotFoundError("Certificación", id);
    if (cert.partnerId && cert.estado !== CertificationStatus.APROBADO) {
      const pendientes = lineasSinRubro(
        cert.items.map((i) => ({
          budgetItemId: i.budgetItemId,
          numero: i.planillaLinea?.numero ?? null,
        })),
      );
      assertSinLineasPendientes(pendientes, mensajeLineasSinRubro(pendientes));
    }

    const usuario = usuarioDe(req) || "sistema";

    // Ya aprobado: no se vuelve a descontar del presupuesto ni a facturar. La solicitud de fondos
    // es idempotente: si faltaba (certificado anterior al módulo), se genera.
    if (cert.estado === CertificationStatus.APROBADO) {
      const solicitudFondo = cert.partnerId
        ? await prisma.$transaction((tx) =>
            solicitudDesdeCertificacion(tx, cert.id, usuario),
          )
        : null;
      ok(res, {
        certification: cert,
        invoice: cert.invoices[0] ?? null,
        solicitudFondo,
        budgetWarnings: [],
        message: "El certificado ya se encontraba aprobado.",
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let measurementWarnings: string[] = [];
      let priceWarnings: string[] = [];
      const avisos: string[] = [];
      const hoy = today();
      if (cert.partnerId) {
        measurementWarnings = await controlMedicionSubcontratistas(
          tx,
          cert.projectId,
          medidoItems(cert.items),
        );
        priceWarnings = priceWarningsOf(cert.items);
      } else if (cert.estado === CertificationStatus.MEDICION_BORRADOR) {
        // El certificado al cliente sale de su medición: tiene que estar cerrada antes de aprobarse.
        throw new DomainError(
          "MEASUREMENT_OPEN",
          "Cerrá la medición antes de aprobar el certificado (botón «Cerrar medición» en el certificado).",
          409,
        );
      }
      const total = moneyNumber(cert.montoTotal);
      const retentionAmount = Math.round(
        (total * moneyNumber(cert.retentionPct)) / 100,
      );
      const approvedCert = await tx.certification.update({
        where: { id },
        data: {
          estado: CertificationStatus.APROBADO,
          retentionAmount,
          netAmount: total - retentionAmount,
          approvedAt: hoy,
        },
        include: certificationInclude,
      });

      // Presupuesto: al cliente = avance real; de subcontratista = costo interno
      const budgetWarnings: BudgetWarning[] = [];
      for (const item of cert.items) {
        if (item.budgetItemId === null) continue; // no pasa: se valida arriba
        const base = {
          projectId: cert.projectId,
          budgetItemId: item.budgetItemId,
          insumoId: item.insumoId,
          amount: item.montoTotal,
          // Subcontratista: cantidad = avance que aporta la línea (0 si es complementaria).
          quantity: cert.partnerId
            ? new Prisma.Decimal(medidoItems([item])[0]?.quantity ?? 0)
            : item.cantidadPresente,
          sourceType: "Certification",
          sourceId: cert.id,
          sourceNumber: `CERT-${String(cert.numero).padStart(2, "0")}${cert.partner ? ` ${cert.partner.name}` : ""}`,
          fecha: hoy,
        };
        if (cert.partnerId) {
          budgetWarnings.push(
            ...(await postCost(tx, { ...base, source: "SUBCONTRACT" })),
          );
        } else {
          const { warnings } = await postMovement(tx, {
            ...base,
            source: "CLIENT_CERTIFICATE",
            stage: "ACTUAL",
          });
          budgetWarnings.push(...warnings);
        }
      }
      if (cert.contractId) {
        // Techo duro del contrato: lo certificado no puede superar su monto (wiki, puente, regla 1).
        const contrato = await tx.subcontractorContract.findUniqueOrThrow({ where: { id: cert.contractId } });
        const saldo = moneyNumber(contrato.contractAmount) - moneyNumber(contrato.certifiedAmount);
        if (total > saldo + 0.0001) {
          throw new DomainError(
            "CONTRACT_CEILING_EXCEEDED",
            `El certificado ${cert.numero} excede el saldo del contrato ${contrato.number}: saldo ${saldo.toLocaleString("es-PY")} Gs`,
            409,
          );
        }
        await tx.subcontractorContract.update({
          where: { id: cert.contractId },
          data: { certifiedAmount: { increment: total } },
        });
      }
      await recalculateProjectFinancials(tx, cert.projectId);

      // Factura recibida del subcontratista. Al cliente se factura al aprobar (abajo); el cierre
      // oficial factura solo lo que todavía no se facturó.
      const isSubcontractor = Boolean(cert.partnerId);
      const now = new Date();
      const dueDate = new Date(now.getTime() + 30 * 86400000);
      const iva10 = Math.round(total / 11);
      let invoice = cert.invoices[0] ?? null;
      if (!invoice && isSubcontractor) {
        // Certificado ya aprobado (estado APROBADO arriba) con el mismo monto que la factura:
        // control de 2 vías vía evaluateMatch (certificado + factura, sin recepción física porque
        // es un servicio), no un true hardcodeado — ver src/domain/threeWayMatch.ts.
        const matchResult = evaluateMatch({
          tipo: "RECIBIDA",
          total,
          certificado: {
            ref: `N° ${cert.numero}`,
            estado: approvedCert.estado,
            estadosAprobados: ["APROBADO"],
            monto: total,
          },
        });
        const notas = retentionAmount
          ? `Fondo de reparo ${moneyNumber(cert.retentionPct)}%: ${retentionAmount.toLocaleString("es-PY")} Gs. Neto a pagar ${(total - retentionAmount).toLocaleString("es-PY")} Gs. ${matchResult.notes}`
          : matchResult.notes;
        invoice = await tx.invoice.create({
          data: {
            projectId: cert.projectId,
            partnerId: cert.partnerId || null,
            certificationId: cert.id,
            numeroFactura: `${isSubcontractor ? "001-002" : "001-001"}-${String(cert.numero).padStart(7, "0")}`,
            timbrado: "PENDIENTE",
            tipo: isSubcontractor ? "RECIBIDA" : "EMITIDA",
            estado: matchResult.passed ? "APROBADA" : "EN_REVISION",
            fechaEmision: now,
            fechaVencimiento: dueDate,
            condicionVenta: "CREDITO",
            concepto: isSubcontractor
              ? `Cert. N° ${cert.numero} — ${cert.partner?.name ?? ""} — ${cert.project.name}`
              : `Certificado N° ${cert.numero} de avance de obra — ${cert.project.name}`,
            subtotal: total - iva10,
            montoExento: 0,
            montoIva5: 0,
            montoIva10: iva10,
            total,
            threeWayMatchPassed: matchResult.passed,
            matchNotes: notas,
          },
        });
        for (const item of cert.items) {
          const amount = moneyNumber(item.montoTotal);
          const itemIva = Math.round(amount / 11);
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              description: `${labelOf(item).code} - ${labelOf(item).name}`,
              quantity: moneyNumber(item.cantidadPresente) || 1,
              unitPrice: moneyNumber(item.precioUnitario),
              vatType: "IVA10",
              montoExento: 0,
              montoIva5: 0,
              montoIva10: itemIva,
              subtotal: amount - itemIva,
            },
          });
        }
      }
      if (!isSubcontractor) {
        // Factura al cliente (EMITIDA, IVA desglosado), enlazada al certificado; sin doble facturación con el cierre.
        const facturado = await facturarCertificadoCliente(tx, cert.id, {
          fechaEmision: now,
          usuario,
        });
        invoice = facturado.invoice ?? invoice;
        avisos.push(...facturado.avisos);
      }
      // Pedido de pago a tesorería: neto = total − fondo de reparo − retenciones − anticipo aplicado.
      const solicitudFondo = isSubcontractor
        ? await solicitudDesdeCertificacion(tx, cert.id, usuario)
        : null;
      return {
        certification: approvedCert,
        invoice,
        solicitudFondo,
        budgetWarnings,
        measurementWarnings,
        priceWarnings,
        avisos,
        message: isSubcontractor
          ? undefined
          : invoice
            ? `Certificado aprobado y facturado al cliente (factura ${invoice.numeroFactura}).`
            : "Certificado aprobado.",
      };
    });
    ok(res, result, 201);
  }),
);

advancedCertificationsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.certification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Certificación", id);
    if (existing.estado === CertificationStatus.APROBADO) {
      throw new DomainError(
        "CANNOT_DELETE_APPROVED",
        "No se puede borrar un certificado aprobado",
        409,
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.certification.delete({ where: { id } });
    });
    ok(res, { deleted: true, id });
  }),
);
