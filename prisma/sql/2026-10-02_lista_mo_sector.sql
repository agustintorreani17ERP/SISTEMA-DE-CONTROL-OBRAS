-- Lista de precios de MO por obra: sector (planta baja / alta). budgetItemId queda solo como legado.
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- AlterTable
ALTER TABLE "LaborPrice" ADD COLUMN "sector" TEXT;
