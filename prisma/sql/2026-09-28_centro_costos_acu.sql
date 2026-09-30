-- Centro de Costos: K e IVA por obra + ACU (ComponenteItem).
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "coeficienteK" DECIMAL(10,4),
ADD COLUMN     "ivaPct" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "ComponenteItem" (
    "id" SERIAL NOT NULL,
    "budgetItemId" INTEGER NOT NULL,
    "insumoId" INTEGER NOT NULL,
    "consumo" DECIMAL(18,6) NOT NULL,
    "desperdicioPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponenteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComponenteItem_insumoId_idx" ON "ComponenteItem"("insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponenteItem_budgetItemId_insumoId_key" ON "ComponenteItem"("budgetItemId", "insumoId");

-- AddForeignKey
ALTER TABLE "ComponenteItem" ADD CONSTRAINT "ComponenteItem_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponenteItem" ADD CONSTRAINT "ComponenteItem_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

