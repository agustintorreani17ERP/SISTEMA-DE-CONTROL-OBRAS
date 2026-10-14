-- Presupuesto original congelado + adendas (cambian CANTIDADES; los precios unitarios no cambian).
-- BudgetItem.totalQuantity / originalAmount pasan a ser la cantidad y el monto VIGENTES (contrato ± adendas
-- aprobadas); contractQuantity / contractAmount guardan el original congelado.
-- Equivalente a `prisma db push`. Los SQL anteriores no se tocan.

CREATE TYPE "AdendaEstado" AS ENUM ('BORRADOR', 'APROBADA', 'ANULADA');
CREATE TYPE "AdendaLineaTipo" AS ENUM ('VARIACION', 'EXTRA');

ALTER TABLE "BudgetItem" ADD COLUMN "contractQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "BudgetItem" ADD COLUMN "contractAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "BudgetItem" ADD COLUMN "isExtra" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BudgetItem" ADD COLUMN "origenAdendaId" INTEGER;

ALTER TABLE "Project" ADD COLUMN "presupuestoCongeladoAt" TIMESTAMP(3);

CREATE TABLE "Adenda" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "numero" INTEGER NOT NULL,
  "titulo" TEXT NOT NULL,
  "motivo" TEXT,
  "resolucion" TEXT,
  "fecha" DATE NOT NULL,
  "estado" "AdendaEstado" NOT NULL DEFAULT 'BORRADOR',
  "approvedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Adenda_projectId_numero_key" ON "Adenda"("projectId", "numero");
CREATE INDEX "Adenda_projectId_estado_idx" ON "Adenda"("projectId", "estado");

CREATE TABLE "AdendaLinea" (
  "id" SERIAL PRIMARY KEY,
  "adendaId" INTEGER NOT NULL REFERENCES "Adenda"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tipo" "AdendaLineaTipo" NOT NULL DEFAULT 'VARIACION',
  "budgetItemId" INTEGER REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "deltaQuantity" DECIMAL(18,4) NOT NULL,
  "nota" TEXT,
  "codigo" TEXT,
  "nombre" TEXT,
  "unidad" TEXT,
  "parentId" INTEGER,
  "precioUnitario" DECIMAL(18,4)
);
CREATE INDEX "AdendaLinea_adendaId_idx" ON "AdendaLinea"("adendaId");
CREATE INDEX "AdendaLinea_budgetItemId_idx" ON "AdendaLinea"("budgetItemId");

-- Backfill: el presupuesto actual pasa a ser el original congelado (sin adendas todavía).
UPDATE "BudgetItem"
   SET "contractQuantity" = "totalQuantity", "contractAmount" = "originalAmount"
 WHERE "nodeKind" = 'ITEM' AND "isSystem" = false;
UPDATE "Project" p
   SET "presupuestoCongeladoAt" = now()
 WHERE EXISTS (SELECT 1 FROM "BudgetItem" b WHERE b."projectId" = p."id" AND b."nodeKind" = 'ITEM' AND b."isSystem" = false);
