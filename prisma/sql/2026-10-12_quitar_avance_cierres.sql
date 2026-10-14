-- Quita avance por parte diario/cronograma y cierres de período. La única cantidad oficial es la
-- medición del certificado al cliente (CertificationItem). Lo aprobado se protege por su estado.
-- Equivalente a `prisma db push` sobre el schema actual. Los SQL anteriores no se tocan.
-- Antes de correr: si hay facturas con cierreId, esa columna desaparece (la factura queda por su certificationId).

DROP TABLE IF EXISTS "CierreReapertura";
DROP TABLE IF EXISTS "CierrePeriodo";
DROP TABLE IF EXISTS "AvancePlanificado";
DROP TABLE IF EXISTS "AvanceItem";
DROP TYPE IF EXISTS "AvanceOrigen";

ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_cierreId_key";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "cierreId";

ALTER TABLE "BudgetMovement" DROP COLUMN IF EXISTS "fechaDocumento";
ALTER TABLE "StockMovement" DROP COLUMN IF EXISTS "fechaDocumento";

ALTER TABLE "SubPlanillaLinea" DROP COLUMN IF EXISTS "factorAvance";
ALTER TABLE "SubPlanillaLinea" DROP COLUMN IF EXISTS "aportaAvance";
