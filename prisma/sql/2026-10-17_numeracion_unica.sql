-- Numeración única de SF y NE: una secuencia por tipo y año para toda la empresa ("385/2026"),
-- compartida con el Taller. El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.
-- Las SF existentes son de prueba: se renumeran por fecha de creación dentro de su año.

CREATE TABLE "SecuenciaDocumento" (
    "tipo" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "siguiente" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "SecuenciaDocumento_pkey" PRIMARY KEY ("tipo", "anio")
);

CREATE TABLE "NumeroAsignado" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "sistema" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NumeroAsignado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NumeroAsignado_tipo_anio_numero_key" ON "NumeroAsignado"("tipo", "anio", "numero");
CREATE UNIQUE INDEX "NumeroAsignado_tipo_sistema_externalId_key" ON "NumeroAsignado"("tipo", "sistema", "externalId");

-- SolicitudFondo: año, sistema de origen y número único por año
ALTER TABLE "SolicitudFondo" ADD COLUMN "anio" INTEGER;
ALTER TABLE "SolicitudFondo" ADD COLUMN "sistemaOrigen" TEXT NOT NULL DEFAULT 'ERP';
UPDATE "SolicitudFondo" SET "anio" = EXTRACT(YEAR FROM "createdAt")::INTEGER;
UPDATE "SolicitudFondo" SET "sistemaOrigen" = 'ECMS' WHERE "origen" = 'CERT_SUBCONTRATISTA';

DROP INDEX "SolicitudFondo_projectId_numero_key";

-- Renumeración por fecha (y id para desempatar) dentro de cada año
WITH nuevo AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "anio" ORDER BY "createdAt", "id") AS n
  FROM "SolicitudFondo"
)
UPDATE "SolicitudFondo" s SET "numero" = nuevo.n FROM nuevo WHERE s."id" = nuevo."id";

ALTER TABLE "SolicitudFondo" ALTER COLUMN "anio" SET NOT NULL;
CREATE UNIQUE INDEX "SolicitudFondo_anio_numero_key" ON "SolicitudFondo"("anio", "numero");

-- Registra los números ya entregados y deja la secuencia en el próximo libre
INSERT INTO "NumeroAsignado" ("tipo", "anio", "numero", "sistema", "externalId")
SELECT 'SF', "anio", "numero", "sistemaOrigen", "sourceType" || ':' || "sourceId" FROM "SolicitudFondo";

INSERT INTO "SecuenciaDocumento" ("tipo", "anio", "siguiente")
SELECT 'SF', "anio", MAX("numero") + 1 FROM "SolicitudFondo" GROUP BY "anio";
