-- Frentes de trabajo generados desde las Áreas (rubros raíz) del presupuesto.
-- Equivalente a `prisma db push` para este cambio. Aditivo: no toca datos existentes.

ALTER TABLE "WorkFront" ADD COLUMN "budgetItemId" INTEGER;

CREATE UNIQUE INDEX "WorkFront_budgetItemId_key" ON "WorkFront"("budgetItemId");

ALTER TABLE "WorkFront"
  ADD CONSTRAINT "WorkFront_budgetItemId_fkey"
  FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carga inicial: un frente por cada rubro raíz no de sistema que todavía no tenga el suyo.
INSERT INTO "WorkFront" ("projectId", "name", "budgetItemId")
SELECT b."projectId", b."name", b."id"
FROM "BudgetItem" b
WHERE b."parentId" IS NULL
  AND b."nodeKind" <> 'ITEM'
  AND b."isSystem" = false
  AND NOT EXISTS (SELECT 1 FROM "WorkFront" w WHERE w."budgetItemId" = b."id");
