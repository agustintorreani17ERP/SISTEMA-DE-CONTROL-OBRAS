-- Motor de costos: horas de equipo (vía C) e índice por fecha del libro mayor.
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- CreateTable
CREATE TABLE "ParteEquipo" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "insumoId" INTEGER NOT NULL,
    "budgetItemId" INTEGER,
    "horas" DECIMAL(10,2) NOT NULL,
    "nota" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParteEquipo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParteEquipo_projectId_fecha_idx" ON "ParteEquipo"("projectId", "fecha");

-- CreateIndex
CREATE INDEX "BudgetMovement_projectId_fecha_idx" ON "BudgetMovement"("projectId", "fecha");

-- AddForeignKey
ALTER TABLE "ParteEquipo" ADD CONSTRAINT "ParteEquipo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParteEquipo" ADD CONSTRAINT "ParteEquipo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParteEquipo" ADD CONSTRAINT "ParteEquipo_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

