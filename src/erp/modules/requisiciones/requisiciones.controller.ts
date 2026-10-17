import { Router } from "express";
import { DocumentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { ok } from "../../../http/respond";
import { DomainError, NotFoundError } from "../../../errors/domain";
import { rechazarRequisicion } from "../../domain/requisiciones";
import { pendienteDeCompra } from "../../domain/requisicionesMath";

/**
 * Bandeja de pedidos del ERP: pedidos de obra (ECMS) y del Taller, ya normalizados, para comprar.
 * Los de obra se compran con POST /compras (materialRequestId); los del Taller con
 * POST /compras/desde-requisicion.
 */
export const requisicionesRouter = Router();

const include = {
  project: { select: { id: true, code: true, name: true } },
  lineas: { orderBy: { position: "asc" as const } },
  purchaseOrders: { select: { id: true, number: true, status: true } },
} satisfies Prisma.RequisicionInclude;

type Row = Prisma.RequisicionGetPayload<{ include: typeof include }>;

/** Cada renglón con lo que ya cubren las OC vigentes y lo recibido, para saber qué falta comprar. */
async function presentar(rows: Row[]) {
  const lineaIds = rows.flatMap((r) => r.lineas.map((l) => l.id));
  const detalles = lineaIds.length
    ? await prisma.purchaseOrderDetail.findMany({
        where: { requisicionLineaId: { in: lineaIds }, order: { status: { not: DocumentStatus.ANULADO } } },
        select: { requisicionLineaId: true, quantity: true, order: { select: { status: true } } },
      })
    : [];
  return rows.map((r) => ({
    ...r,
    fecha: r.fecha.toISOString().slice(0, 10),
    lineas: r.lineas.map((l) => {
      const propios = detalles.filter((d) => d.requisicionLineaId === l.id);
      const cantidad = Number(l.cantidad);
      const pedida = propios.reduce((a, d) => a + Number(d.quantity), 0);
      const recibida = propios.filter((d) => d.order.status === DocumentStatus.RECIBIDO).reduce((a, d) => a + Number(d.quantity), 0);
      return { ...l, cantidad, pedida, recibida, pendiente: pendienteDeCompra({ cantidad, pedida }) };
    }),
  }));
}

requisicionesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        origen: z.enum(["ECMS", "TALLER"]).optional(),
        estado: z.enum(["RECIBIDA", "EN_COMPRA", "COMPRADA_PARCIAL", "COMPRADA", "RECHAZADA", "ANULADA"]).optional(),
        projectId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const rows = await prisma.requisicion.findMany({
      where: { sistemaOrigen: q.origen, estado: q.estado, projectId: q.projectId },
      include,
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      take: 500,
    });
    ok(res, await presentar(rows));
  })
);

requisicionesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.requisicion.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError("Requisición", id);
    ok(res, (await presentar([row]))[0]);
  })
);

requisicionesRouter.post(
  "/:id/rechazar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new DomainError("INVALID_ID", "Identificador inválido");
    const { motivo } = z.object({ motivo: z.string().trim().min(1, "Falta el motivo") }).parse(req.body);
    await prisma.$transaction((tx) => rechazarRequisicion(tx, id, motivo));
    ok(res, (await presentar([await prisma.requisicion.findUniqueOrThrow({ where: { id }, include })]))[0]);
  })
);
