-- Módulos de dinero con obra + ítem + insumo + fecha; facturación al cliente desde el cierre.
-- Equivalente a `prisma db push` para este cambio. Aditivo salvo PettyCashExpense.budgetItemId (pasa a opcional).

ALTER TYPE "BudgetMovementSource" ADD VALUE IF NOT EXISTS 'INVOICE';

-- Libro mayor: insumo del hecho
ALTER TABLE "BudgetMovement" ADD COLUMN "insumoId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BudgetMovement_insumoId_idx" ON "BudgetMovement"("insumoId");

-- Caja chica: insumo y cantidad; el ítem solo para DIRECTO/TIEMPO
ALTER TABLE "PettyCashExpense" ALTER COLUMN "budgetItemId" DROP NOT NULL;
ALTER TABLE "PettyCashExpense"
  ADD COLUMN "insumoId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "quantity" DECIMAL(18,4);

-- Facturas: imputación por renglón y factura al cliente por cierre
ALTER TABLE "InvoiceItem"
  ADD COLUMN "insumoId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "budgetItemId" INTEGER REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD COLUMN "cierreId" INTEGER REFERENCES "CierrePeriodo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Invoice_cierreId_key" ON "Invoice"("cierreId");

-- Certificados: fecha contable de aprobación y precio sugerido de MO
ALTER TABLE "Certification" ADD COLUMN "approvedAt" DATE;
ALTER TABLE "CertificationItem"
  ADD COLUMN "precioSugerido" DECIMAL(18,4),
  ADD COLUMN "precioFuente" TEXT,
  ADD COLUMN "insumoId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Datos existentes: fecha de aprobación = fecha del asiento del certificado en el libro mayor
UPDATE "Certification" c SET "approvedAt" = m.fecha
FROM (SELECT "sourceId", MIN("fecha") AS fecha FROM "BudgetMovement" WHERE "sourceType" = 'Certification' GROUP BY "sourceId") m
WHERE c.id = m."sourceId" AND c.estado = 'APROBADO' AND c."approvedAt" IS NULL;
