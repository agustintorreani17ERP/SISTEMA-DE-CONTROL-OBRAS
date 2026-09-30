-- Avance fechado, cronograma y cierres oficiales.
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano. Tablas nuevas: no hay datos que completar.

-- CreateEnum
CREATE TYPE "AvanceOrigen" AS ENUM ('PARTE_DIARIO', 'MEDICION_OFICIAL');

-- CreateTable
CREATE TABLE "AvanceItem" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "budgetItemId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "origen" "AvanceOrigen" NOT NULL,
    "sourceType" TEXT,
    "sourceId" INTEGER,
    "nota" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvancePlanificado" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "budgetItemId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvancePlanificado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CierrePeriodo" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "notas" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CierrePeriodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvanceItem_projectId_fecha_idx" ON "AvanceItem"("projectId", "fecha");

-- CreateIndex
CREATE INDEX "AvanceItem_budgetItemId_fecha_idx" ON "AvanceItem"("budgetItemId", "fecha");

-- CreateIndex
CREATE INDEX "AvanceItem_sourceType_sourceId_idx" ON "AvanceItem"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AvancePlanificado_projectId_fecha_idx" ON "AvancePlanificado"("projectId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "AvancePlanificado_budgetItemId_fecha_key" ON "AvancePlanificado"("budgetItemId", "fecha");

-- CreateIndex
CREATE INDEX "CierrePeriodo_projectId_hasta_idx" ON "CierrePeriodo"("projectId", "hasta");

-- AddForeignKey
ALTER TABLE "AvanceItem" ADD CONSTRAINT "AvanceItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvanceItem" ADD CONSTRAINT "AvanceItem_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvancePlanificado" ADD CONSTRAINT "AvancePlanificado_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvancePlanificado" ADD CONSTRAINT "AvancePlanificado_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CierrePeriodo" ADD CONSTRAINT "CierrePeriodo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

