-- Notas de envío (ERP/ECMS/Taller), bandeja de pedidos del ERP (Requisicion), cola de avisos al Taller
-- y copia de las SF del Taller. Además las OC dejan de exigir obra y pedido de obra: una OC puede salir
-- de un pedido del Taller. El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano,
-- DESPUÉS de 2026-10-17_numeracion_unica.sql.

-- CreateEnum
CREATE TYPE "NotaEnvioEstado" AS ENUM ('ENVIADA', 'RECIBIDA', 'ANULADA');

-- CreateEnum
CREATE TYPE "NotaEnvioLugar" AS ENUM ('OFICINA', 'OBRA', 'TALLER');

-- CreateEnum
CREATE TYPE "NotaEnvioContenido" AS ENUM ('DOCUMENTOS', 'MATERIALES');

-- CreateEnum
CREATE TYPE "NotaEnvioLineaTipo" AS ENUM ('PEDIDO', 'OC', 'RECEPCION', 'SF', 'CERTIFICADO', 'FACTURA', 'REMITO', 'MATERIAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "RequisicionEstado" AS ENUM ('RECIBIDA', 'EN_COMPRA', 'COMPRADA_PARCIAL', 'COMPRADA', 'RECHAZADA', 'ANULADA');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "requisicionId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL,
ALTER COLUMN "materialRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseOrderDetail" ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "requisicionLineaId" INTEGER,
ALTER COLUMN "materialId" DROP NOT NULL,
ALTER COLUMN "requestDetailId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "NotaEnvio" (
    "id" SERIAL NOT NULL,
    "anio" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "sistemaOrigen" TEXT NOT NULL,
    "externalId" TEXT,
    "origenTipo" "NotaEnvioLugar" NOT NULL,
    "origenProjectId" INTEGER,
    "destinoTipo" "NotaEnvioLugar" NOT NULL,
    "destinoProjectId" INTEGER,
    "contenido" "NotaEnvioContenido" NOT NULL,
    "chofer" TEXT,
    "observaciones" TEXT,
    "estado" "NotaEnvioEstado" NOT NULL DEFAULT 'ENVIADA',
    "recibidoFecha" DATE,
    "recibidoPor" TEXT,
    "anuladoMotivo" TEXT,
    "creadoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotaEnvioLinea" (
    "id" SERIAL NOT NULL,
    "notaId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "NotaEnvioLineaTipo" NOT NULL,
    "materialRequestId" INTEGER,
    "purchaseOrderId" INTEGER,
    "solicitudFondoId" INTEGER,
    "certificationId" INTEGER,
    "invoiceId" INTEGER,
    "materialId" INTEGER,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4),
    "unidad" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotaEnvioLinea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisicion" (
    "id" SERIAL NOT NULL,
    "sistemaOrigen" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "numeroOrigen" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "projectId" INTEGER,
    "obraTexto" TEXT,
    "maquinaTexto" TEXT,
    "compraCentral" BOOLEAN NOT NULL DEFAULT false,
    "estado" "RequisicionEstado" NOT NULL DEFAULT 'RECIBIDA',
    "observaciones" TEXT,
    "materialRequestId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisicionLinea" (
    "id" SERIAL NOT NULL,
    "requisicionId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "unidad" TEXT,
    "materialId" INTEGER,
    "budgetItemId" INTEGER,
    "materialRequestDetailId" INTEGER,
    "nroParte" TEXT,
    "maquinaCodigo" TEXT,
    "rubro" TEXT,
    "externalLineId" TEXT,

    CONSTRAINT "RequisicionLinea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoSalida" (
    "id" SERIAL NOT NULL,
    "destino" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximoIntento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoAt" TIMESTAMP(3),

    CONSTRAINT "EventoSalida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudFondoTaller" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "proveedor" TEXT NOT NULL,
    "proveedorRuc" TEXT,
    "monto" DECIMAL(18,2) NOT NULL,
    "moneda" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "maquinaCodigo" TEXT,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolicitudFondoTaller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotaEnvio_estado_idx" ON "NotaEnvio"("estado");

-- CreateIndex
CREATE INDEX "NotaEnvio_destinoTipo_estado_idx" ON "NotaEnvio"("destinoTipo", "estado");

-- CreateIndex
CREATE INDEX "NotaEnvio_origenProjectId_idx" ON "NotaEnvio"("origenProjectId");

-- CreateIndex
CREATE INDEX "NotaEnvio_destinoProjectId_idx" ON "NotaEnvio"("destinoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "NotaEnvio_anio_numero_key" ON "NotaEnvio"("anio", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "NotaEnvio_sistemaOrigen_externalId_key" ON "NotaEnvio"("sistemaOrigen", "externalId");

-- CreateIndex
CREATE INDEX "NotaEnvioLinea_materialRequestId_idx" ON "NotaEnvioLinea"("materialRequestId");

-- CreateIndex
CREATE INDEX "NotaEnvioLinea_purchaseOrderId_idx" ON "NotaEnvioLinea"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "NotaEnvioLinea_solicitudFondoId_idx" ON "NotaEnvioLinea"("solicitudFondoId");

-- CreateIndex
CREATE UNIQUE INDEX "NotaEnvioLinea_notaId_position_key" ON "NotaEnvioLinea"("notaId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Requisicion_materialRequestId_key" ON "Requisicion"("materialRequestId");

-- CreateIndex
CREATE INDEX "Requisicion_estado_idx" ON "Requisicion"("estado");

-- CreateIndex
CREATE INDEX "Requisicion_projectId_idx" ON "Requisicion"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Requisicion_sistemaOrigen_externalId_key" ON "Requisicion"("sistemaOrigen", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RequisicionLinea_materialRequestDetailId_key" ON "RequisicionLinea"("materialRequestDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "RequisicionLinea_requisicionId_position_key" ON "RequisicionLinea"("requisicionId", "position");

-- CreateIndex
CREATE INDEX "EventoSalida_destino_estado_proximoIntento_idx" ON "EventoSalida"("destino", "estado", "proximoIntento");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitudFondoTaller_externalId_key" ON "SolicitudFondoTaller"("externalId");

-- CreateIndex
CREATE INDEX "SolicitudFondoTaller_fecha_idx" ON "SolicitudFondoTaller"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitudFondoTaller_anio_numero_key" ON "SolicitudFondoTaller"("anio", "numero");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requisicionId_fkey" FOREIGN KEY ("requisicionId") REFERENCES "Requisicion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDetail" ADD CONSTRAINT "PurchaseOrderDetail_requisicionLineaId_fkey" FOREIGN KEY ("requisicionLineaId") REFERENCES "RequisicionLinea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaEnvio" ADD CONSTRAINT "NotaEnvio_origenProjectId_fkey" FOREIGN KEY ("origenProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaEnvio" ADD CONSTRAINT "NotaEnvio_destinoProjectId_fkey" FOREIGN KEY ("destinoProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaEnvioLinea" ADD CONSTRAINT "NotaEnvioLinea_notaId_fkey" FOREIGN KEY ("notaId") REFERENCES "NotaEnvio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisicion" ADD CONSTRAINT "Requisicion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisicion" ADD CONSTRAINT "Requisicion_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisicionLinea" ADD CONSTRAINT "RequisicionLinea_requisicionId_fkey" FOREIGN KEY ("requisicionId") REFERENCES "Requisicion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un documento solo puede estar en una nota de envío vigente (la nota anulada libera sus renglones).
CREATE UNIQUE INDEX "NotaEnvioLinea_un_pedido_vigente" ON "NotaEnvioLinea"("materialRequestId") WHERE "vigente" AND "materialRequestId" IS NOT NULL;
CREATE UNIQUE INDEX "NotaEnvioLinea_una_oc_vigente" ON "NotaEnvioLinea"("purchaseOrderId") WHERE "vigente" AND "purchaseOrderId" IS NOT NULL;
CREATE UNIQUE INDEX "NotaEnvioLinea_una_sf_vigente" ON "NotaEnvioLinea"("solicitudFondoId") WHERE "vigente" AND "solicitudFondoId" IS NOT NULL;
CREATE UNIQUE INDEX "NotaEnvioLinea_un_certificado_vigente" ON "NotaEnvioLinea"("certificationId") WHERE "vigente" AND "certificationId" IS NOT NULL;
CREATE UNIQUE INDEX "NotaEnvioLinea_una_factura_vigente" ON "NotaEnvioLinea"("invoiceId") WHERE "vigente" AND "invoiceId" IS NOT NULL;

-- Reglas de la nota que la base también cuida (como en el Taller)
ALTER TABLE "NotaEnvio" ADD CONSTRAINT "NotaEnvio_recibida_con_datos" CHECK ("estado" <> 'RECIBIDA' OR ("recibidoFecha" IS NOT NULL AND "recibidoPor" IS NOT NULL));
ALTER TABLE "NotaEnvio" ADD CONSTRAINT "NotaEnvio_anulada_con_motivo" CHECK ("estado" <> 'ANULADA' OR "anuladoMotivo" IS NOT NULL);
ALTER TABLE "NotaEnvio" ADD CONSTRAINT "NotaEnvio_recepcion_posterior" CHECK ("recibidoFecha" IS NULL OR "recibidoFecha" >= "fecha");

-- Backfill: cada pedido de obra ya aprobado pasa a la bandeja del ERP, con sus renglones y sus OC.
INSERT INTO "Requisicion" ("sistemaOrigen", "externalId", "numeroOrigen", "fecha", "projectId", "estado", "observaciones", "materialRequestId", "updatedAt")
SELECT 'ECMS', mr."id"::text, mr."number", mr."requestedDate"::date, mr."projectId",
  CASE mr."status"::text
    WHEN 'ANULADO' THEN 'ANULADA'
    WHEN 'RECIBIDO' THEN 'COMPRADA'
    WHEN 'EMITIDA' THEN 'EN_COMPRA'
    ELSE 'RECIBIDA'
  END::"RequisicionEstado",
  mr."notes", mr."id", NOW()
FROM "MaterialRequest" mr
WHERE mr."status"::text <> 'BORRADOR';

INSERT INTO "RequisicionLinea" ("requisicionId", "position", "descripcion", "cantidad", "unidad", "materialId", "budgetItemId", "materialRequestDetailId")
SELECT r."id", ROW_NUMBER() OVER (PARTITION BY d."requestId" ORDER BY d."id"), m."description", d."quantity", m."unit", d."materialId", d."budgetItemId", d."id"
FROM "MaterialRequestDetail" d
JOIN "Requisicion" r ON r."materialRequestId" = d."requestId"
JOIN "Material" m ON m."id" = d."materialId";

UPDATE "PurchaseOrder" po SET "requisicionId" = r."id" FROM "Requisicion" r WHERE r."materialRequestId" = po."materialRequestId";
UPDATE "PurchaseOrderDetail" pd SET "requisicionLineaId" = rl."id" FROM "RequisicionLinea" rl WHERE rl."materialRequestDetailId" = pd."requestDetailId";
