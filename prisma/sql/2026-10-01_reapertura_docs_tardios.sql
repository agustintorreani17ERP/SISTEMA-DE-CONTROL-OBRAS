-- Reapertura del último cierre oficial, fecha real de documentos tardíos y una factura por
-- certificado y tipo. Equivalente a `prisma db push` para este cambio.

-- 1) Antes de crear el índice único: no tiene que haber dos facturas del mismo tipo para un certificado.
--    Si esta consulta devuelve filas, resolverlas (anular/desvincular) antes de seguir.
-- SELECT "certificationId", "tipo", COUNT(*) FROM "Invoice"
-- WHERE "certificationId" IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX "Invoice_certificationId_tipo_key" ON "Invoice"("certificationId", "tipo");

-- 2) Fecha real del documento cuando se contabilizó en el primer día abierto.
ALTER TABLE "BudgetMovement" ADD COLUMN "fechaDocumento" DATE;
ALTER TABLE "StockMovement" ADD COLUMN "fechaDocumento" DATE;

-- 3) Cierres reabiertos (copia del cierre y su snapshot).
CREATE TABLE "CierreReapertura" (
  "id" SERIAL NOT NULL,
  "projectId" INTEGER NOT NULL,
  "cierreIdOriginal" INTEGER NOT NULL,
  "desde" DATE NOT NULL,
  "hasta" DATE NOT NULL,
  "snapshot" JSONB NOT NULL,
  "notas" TEXT,
  "cerradoPor" TEXT,
  "cerradoEl" TIMESTAMP(3) NOT NULL,
  "facturaId" INTEGER,
  "motivo" TEXT NOT NULL,
  "reabiertoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CierreReapertura_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CierreReapertura_projectId_hasta_idx" ON "CierreReapertura"("projectId", "hasta");

ALTER TABLE "CierreReapertura"
  ADD CONSTRAINT "CierreReapertura_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
