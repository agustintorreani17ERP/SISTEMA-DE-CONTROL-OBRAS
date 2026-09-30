-- Cuentas financieras (bancos y cajas), cheques con fecha diferida y transferencias entre cuentas.
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- CreateEnum
CREATE TYPE "TipoCuentaFinanciera" AS ENUM ('BANCO', 'CAJA');
CREATE TYPE "MovimientoCuentaTipo" AS ENUM ('INGRESO', 'EGRESO');
CREATE TYPE "ChequeTipo" AS ENUM ('EMITIDO', 'RECIBIDO');
CREATE TYPE "ChequeEstado" AS ENUM ('PENDIENTE', 'DEPOSITADO', 'ACREDITADO', 'RECHAZADO', 'ANULADO');

-- CreateTable
CREATE TABLE "CuentaFinanciera" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoCuentaFinanciera" NOT NULL DEFAULT 'BANCO',
    "moneda" TEXT NOT NULL DEFAULT 'PYG',
    "banco" TEXT,
    "numeroCuenta" TEXT,
    "cuentaContableId" INTEGER,
    "saldoInicial" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaFinanciera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCuentaFinanciera" (
    "id" SERIAL NOT NULL,
    "cuentaFinancieraId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" "MovimientoCuentaTipo" NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "concepto" TEXT NOT NULL,
    "confirmado" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCuentaFinanciera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cheque" (
    "id" SERIAL NOT NULL,
    "cuentaFinancieraId" INTEGER NOT NULL,
    "tipo" "ChequeTipo" NOT NULL,
    "numero" TEXT NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "fechaEmision" DATE NOT NULL,
    "fechaPago" DATE NOT NULL,
    "estado" "ChequeEstado" NOT NULL DEFAULT 'PENDIENTE',
    "partnerId" INTEGER,
    "paymentId" INTEGER,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferenciaCuenta" (
    "id" SERIAL NOT NULL,
    "cuentaOrigenId" INTEGER NOT NULL,
    "cuentaDestinoId" INTEGER NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "concepto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferenciaCuenta_pkey" PRIMARY KEY ("id")
);

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN "cuentaFinancieraId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "CuentaFinanciera_projectId_idx" ON "CuentaFinanciera"("projectId");
CREATE INDEX "MovimientoCuentaFinanciera_cuentaFinancieraId_fecha_idx" ON "MovimientoCuentaFinanciera"("cuentaFinancieraId", "fecha");
CREATE INDEX "MovimientoCuentaFinanciera_sourceType_sourceId_idx" ON "MovimientoCuentaFinanciera"("sourceType", "sourceId");
CREATE INDEX "Cheque_cuentaFinancieraId_estado_idx" ON "Cheque"("cuentaFinancieraId", "estado");
CREATE UNIQUE INDEX "Cheque_paymentId_key" ON "Cheque"("paymentId");
CREATE INDEX "TransferenciaCuenta_cuentaOrigenId_idx" ON "TransferenciaCuenta"("cuentaOrigenId");
CREATE INDEX "TransferenciaCuenta_cuentaDestinoId_idx" ON "TransferenciaCuenta"("cuentaDestinoId");
CREATE INDEX "Payment_cuentaFinancieraId_idx" ON "Payment"("cuentaFinancieraId");

-- AddForeignKey
ALTER TABLE "CuentaFinanciera" ADD CONSTRAINT "CuentaFinanciera_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaFinanciera" ADD CONSTRAINT "CuentaFinanciera_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MovimientoCuentaFinanciera" ADD CONSTRAINT "MovimientoCuentaFinanciera_cuentaFinancieraId_fkey" FOREIGN KEY ("cuentaFinancieraId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_cuentaFinancieraId_fkey" FOREIGN KEY ("cuentaFinancieraId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransferenciaCuenta" ADD CONSTRAINT "TransferenciaCuenta_cuentaOrigenId_fkey" FOREIGN KEY ("cuentaOrigenId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferenciaCuenta" ADD CONSTRAINT "TransferenciaCuenta_cuentaDestinoId_fkey" FOREIGN KEY ("cuentaDestinoId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cuentaFinancieraId_fkey" FOREIGN KEY ("cuentaFinancieraId") REFERENCES "CuentaFinanciera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
