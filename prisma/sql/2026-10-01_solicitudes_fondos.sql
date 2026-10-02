-- Solicitudes de fondos (pedido de pago a tesorería) y sus pagos.
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- CreateEnum
CREATE TYPE "OrigenSolicitudFondo" AS ENUM ('CERT_SUBCONTRATISTA', 'ANTICIPO', 'FACTURA');
CREATE TYPE "EstadoSolicitudFondo" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'PROGRAMADA', 'PAGADA_PARCIAL', 'PAGADA', 'ANULADA');

-- AlterTable
ALTER TABLE "Anticipo" ADD COLUMN "anuladoAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SolicitudFondo" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "origen" "OrigenSolicitudFondo" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "anticipoId" INTEGER,
    "concepto" TEXT NOT NULL,
    "montoBruto" DECIMAL(18,2) NOT NULL,
    "descuentoReparo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "descuentoRetenciones" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "descuentoAnticipo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "montoNeto" DECIMAL(18,2) NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "estado" "EstadoSolicitudFondo" NOT NULL DEFAULT 'PENDIENTE',
    "fechaProgramada" DATE,
    "cuentaFinancieraId" INTEGER,
    "montoPagado" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "motivoRechazo" TEXT,
    "creadoPor" TEXT NOT NULL,
    "aprobadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitudFondo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoSolicitudFondo" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER NOT NULL,
    "cuentaFinancieraId" INTEGER NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "metodo" "PaymentMethod" NOT NULL DEFAULT 'TRANSFERENCIA',
    "referencia" TEXT NOT NULL,
    "paymentId" INTEGER,
    "grupoPagoId" TEXT,
    "usuario" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoSolicitudFondo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SolicitudFondo_sourceType_sourceId_key" ON "SolicitudFondo"("sourceType", "sourceId");
CREATE UNIQUE INDEX "SolicitudFondo_projectId_numero_key" ON "SolicitudFondo"("projectId", "numero");
CREATE INDEX "SolicitudFondo_projectId_estado_idx" ON "SolicitudFondo"("projectId", "estado");
CREATE INDEX "SolicitudFondo_partnerId_idx" ON "SolicitudFondo"("partnerId");
CREATE INDEX "SolicitudFondo_fechaVencimiento_idx" ON "SolicitudFondo"("fechaVencimiento");
CREATE UNIQUE INDEX "PagoSolicitudFondo_paymentId_key" ON "PagoSolicitudFondo"("paymentId");
CREATE INDEX "PagoSolicitudFondo_solicitudId_idx" ON "PagoSolicitudFondo"("solicitudId");
CREATE INDEX "PagoSolicitudFondo_grupoPagoId_idx" ON "PagoSolicitudFondo"("grupoPagoId");

-- AddForeignKey
ALTER TABLE "SolicitudFondo" ADD CONSTRAINT "SolicitudFondo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolicitudFondo" ADD CONSTRAINT "SolicitudFondo_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolicitudFondo" ADD CONSTRAINT "SolicitudFondo_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolicitudFondo" ADD CONSTRAINT "SolicitudFondo_anticipoId_fkey" FOREIGN KEY ("anticipoId") REFERENCES "Anticipo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolicitudFondo" ADD CONSTRAINT "SolicitudFondo_cuentaFinancieraId_fkey" FOREIGN KEY ("cuentaFinancieraId") REFERENCES "CuentaFinanciera"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PagoSolicitudFondo" ADD CONSTRAINT "PagoSolicitudFondo_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "SolicitudFondo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoSolicitudFondo" ADD CONSTRAINT "PagoSolicitudFondo_cuentaFinancieraId_fkey" FOREIGN KEY ("cuentaFinancieraId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoSolicitudFondo" ADD CONSTRAINT "PagoSolicitudFondo_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reglas de asiento del pago (cuentas del plan del seed: 1.2.02 Anticipos a proveedores, 2.1.02 Subcontratistas, 1.1.03 Bancos)
INSERT INTO "ReglaAsientoContable" ("evento", "cuentaDebeId", "cuentaHaberId")
SELECT 'PAGO_ANTICIPO_PROVEEDOR', d.id, h.id FROM "CuentaContable" d, "CuentaContable" h WHERE d.codigo = '1.2.02' AND h.codigo = '1.1.03'
ON CONFLICT ("evento") DO NOTHING;
INSERT INTO "ReglaAsientoContable" ("evento", "cuentaDebeId", "cuentaHaberId")
SELECT 'PAGO_CERTIFICADO_SUBCONTRATISTA', d.id, h.id FROM "CuentaContable" d, "CuentaContable" h WHERE d.codigo = '2.1.02' AND h.codigo = '1.1.03'
ON CONFLICT ("evento") DO NOTHING;
