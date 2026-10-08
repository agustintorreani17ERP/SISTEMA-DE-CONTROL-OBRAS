-- Frentes de trabajo: código, orden y tipo (AREA del presupuesto / AUXILIAR manual).
-- Equivalente a `prisma db push` para este cambio. Después correr scripts/sync-frentes.ts
-- para completar código, nombre y orden de los frentes de Área.

CREATE TYPE "WorkFrontTipo" AS ENUM ('AREA', 'AUXILIAR');

ALTER TABLE "WorkFront" ADD COLUMN "codigo" TEXT;
ALTER TABLE "WorkFront" ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkFront" ADD COLUMN "tipo" "WorkFrontTipo" NOT NULL DEFAULT 'AUXILIAR';

UPDATE "WorkFront" SET "tipo" = 'AREA' WHERE "budgetItemId" IS NOT NULL;
