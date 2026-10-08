-- Planilla de subcontratistas: línea = frente + rubro de la lista de MO + rubro presupuestario,
-- numerada "<código del frente>.<correlativo>" y reutilizada entre certificados.
-- Equivalente a `prisma db push`. Después correr scripts/migrar-planilla-sub.ts para generar las
-- líneas de los certificados de subcontratistas existentes.

CREATE TABLE "SubPlanillaLinea" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "partnerId" INTEGER NOT NULL REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "workFrontId" INTEGER NOT NULL REFERENCES "WorkFront"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "laborPriceId" INTEGER NOT NULL REFERENCES "LaborPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "budgetItemId" INTEGER REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "numero" TEXT NOT NULL,
  "correlativo" INTEGER NOT NULL,
  "factorAvance" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "aportaAvance" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SubPlanillaLinea_partnerId_workFrontId_laborPriceId_budgetItemId_key"
  ON "SubPlanillaLinea"("partnerId", "workFrontId", "laborPriceId", "budgetItemId");
CREATE UNIQUE INDEX "SubPlanillaLinea_partnerId_workFrontId_correlativo_key"
  ON "SubPlanillaLinea"("partnerId", "workFrontId", "correlativo");
CREATE INDEX "SubPlanillaLinea_projectId_idx" ON "SubPlanillaLinea"("projectId");

ALTER TABLE "CertificationItem" ALTER COLUMN "budgetItemId" DROP NOT NULL;
ALTER TABLE "CertificationItem" ADD COLUMN "planillaLineaId" INTEGER
  REFERENCES "SubPlanillaLinea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CertificationItem_planillaLineaId_idx" ON "CertificationItem"("planillaLineaId");
