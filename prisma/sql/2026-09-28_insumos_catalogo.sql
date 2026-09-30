-- Catálogo de insumos: tipo/categoría/tolerancia + historial de precios.
-- El proyecto usa 'prisma db push'; este archivo es la SQL equivalente para aplicar a mano en producción.

-- CreateEnum
CREATE TYPE "InsumoTipo" AS ENUM ('DIRECTO', 'COMUN', 'TIEMPO');

-- CreateEnum
CREATE TYPE "InsumoCategoria" AS ENUM ('MATERIAL', 'MANO_OBRA', 'EQUIPO');

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "categoria" "InsumoCategoria" NOT NULL DEFAULT 'MATERIAL',
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "tipo" "InsumoTipo" NOT NULL DEFAULT 'COMUN',
ADD COLUMN     "toleranciaPct" DECIMAL(7,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MaterialPrice" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "validFrom" DATE NOT NULL,
    "source" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPrice_materialId_validFrom_key" ON "MaterialPrice"("materialId", "validFrom");

-- AddForeignKey
ALTER TABLE "MaterialPrice" ADD CONSTRAINT "MaterialPrice_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: el costo estimado actual pasa a ser el primer precio vigente de cada insumo.
INSERT INTO "MaterialPrice" ("materialId", "price", "validFrom", "source")
SELECT m."id", m."estimatedCost", DATE '2000-01-01', 'BACKFILL'
FROM "Material" m
WHERE NOT EXISTS (SELECT 1 FROM "MaterialPrice" p WHERE p."materialId" = m."id");
