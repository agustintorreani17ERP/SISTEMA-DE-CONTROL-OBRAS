-- Compras y stock con la regla de imputación (DIRECTO / COMÚN / TIEMPO).
-- El proyecto usa 'prisma db push'; esta es la SQL equivalente para aplicar a mano.
-- A diferencia de lo que generaría db push, las fechas nuevas se completan con la fecha real
-- de cada documento antes de volverlas obligatorias (db push pondría la fecha de hoy).
-- Después correr: npx tsx prisma/scripts/migrar-imputacion.ts  (ver el script)

BEGIN;

-- Enums (Postgres 12+ permite varios ADD VALUE; fuera de la transacción en PG ≤ 11)
ALTER TYPE "BudgetMovementSource" ADD VALUE IF NOT EXISTS 'STOCK_TRANSFER';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'DIRECT_ISSUE';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'INVENTORY_ADJUSTMENT';

-- Libro mayor: fecha del hecho
ALTER TABLE "BudgetMovement" ADD COLUMN "fecha" DATE;
UPDATE "BudgetMovement" SET "fecha" = "createdAt"::date;
ALTER TABLE "BudgetMovement" ALTER COLUMN "fecha" SET NOT NULL, ALTER COLUMN "fecha" SET DEFAULT CURRENT_DATE;

-- OC: fecha del documento, fecha y remito de recepción
ALTER TABLE "PurchaseOrder" ADD COLUMN "fecha" DATE,
  ADD COLUMN "receivedDate" DATE,
  ADD COLUMN "receiptNumber" TEXT;
UPDATE "PurchaseOrder" SET "fecha" = COALESCE("issueDate", "createdAt")::date;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "fecha" SET NOT NULL, ALTER COLUMN "fecha" SET DEFAULT CURRENT_DATE;
-- Recepción: la fecha en que se registró la entrada de stock de la OC
UPDATE "PurchaseOrder" po SET "receivedDate" = sm.d
FROM (SELECT "sourceId", MIN("createdAt")::date AS d FROM "StockMovement"
      WHERE "sourceType" = 'PurchaseOrder' AND "kind" = 'RECEIPT' GROUP BY "sourceId") sm
WHERE po."id" = sm."sourceId" AND po."status" = 'RECIBIDO';
UPDATE "PurchaseOrder" SET "receivedDate" = "updatedAt"::date WHERE "status" = 'RECIBIDO' AND "receivedDate" IS NULL;
-- Los compromisos y costos ya asentados de OC toman la fecha de su documento
UPDATE "BudgetMovement" bm SET "fecha" = CASE WHEN bm."stage" = 'ACTUAL' THEN COALESCE(po."receivedDate", po."fecha") ELSE po."fecha" END
FROM "PurchaseOrder" po
WHERE bm."sourceType" = 'PurchaseOrder' AND bm."sourceId" = po."id" AND bm."reversalOfId" IS NULL;

-- Líneas de OC: ítem opcional + tipo congelado. Todo lo existente ya se imputó a un ítem,
-- así que queda como DIRECTO: su compromiso y su costo siguen en el mismo ítem.
ALTER TABLE "PurchaseOrderDetail" ADD COLUMN "tipo" "InsumoTipo" NOT NULL DEFAULT 'DIRECTO',
  ALTER COLUMN "budgetItemId" DROP NOT NULL;

-- Movimientos de stock fechados
ALTER TABLE "StockMovement" ADD COLUMN "fecha" DATE,
  ADD COLUMN "budgetItemId" INTEGER,
  ADD COLUMN "counterpartProjectId" INTEGER,
  ADD COLUMN "unitCost" DECIMAL(18,4),
  ADD COLUMN "createdBy" TEXT;
UPDATE "StockMovement" sm SET "fecha" = COALESCE(po."receivedDate", sm."createdAt"::date)
FROM "PurchaseOrder" po WHERE sm."sourceType" = 'PurchaseOrder' AND sm."sourceId" = po."id";
UPDATE "StockMovement" SET "fecha" = "createdAt"::date WHERE "fecha" IS NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "fecha" SET NOT NULL, ALTER COLUMN "fecha" SET DEFAULT CURRENT_DATE;
-- Costo unitario de las compras ya recibidas (precio de la OC)
UPDATE "StockMovement" sm SET "unitCost" = d."unitPrice"
FROM "PurchaseOrderDetail" d
WHERE sm."sourceType" = 'PurchaseOrder' AND sm."kind" = 'RECEIPT' AND d."orderId" = sm."sourceId" AND d."materialId" = sm."materialId";

DROP INDEX IF EXISTS "StockMovement_projectId_materialId_idx";
CREATE INDEX "StockMovement_projectId_materialId_fecha_idx" ON "StockMovement"("projectId", "materialId", "fecha");
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_counterpartProjectId_fkey" FOREIGN KEY ("counterpartProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conteos de inventario
CREATE TABLE "ConteoInventario" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cantidadContada" DECIMAL(18,4) NOT NULL,
    "fotoUrl" TEXT,
    "nota" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConteoInventario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConteoInventario_projectId_materialId_fecha_idx" ON "ConteoInventario"("projectId", "materialId", "fecha");
ALTER TABLE "ConteoInventario" ADD CONSTRAINT "ConteoInventario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConteoInventario" ADD CONSTRAINT "ConteoInventario_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
