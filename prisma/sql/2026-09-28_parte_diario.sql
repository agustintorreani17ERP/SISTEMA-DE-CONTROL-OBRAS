-- Parte diario de obra: horas de personal/equipo por ítem, combustible, viajes y cargas del costo hora.
-- Equivalente a `prisma db push` para este cambio. Aditivo: no toca datos existentes.

ALTER TABLE "Material" ADD COLUMN "consumoLh" DECIMAL(10,3);

ALTER TABLE "Empleado" ADD COLUMN "costoHoraManual" DECIMAL(18,2);

ALTER TABLE "RRHHConfig"
  ADD COLUMN "pctVacaciones"    DECIMAL(5,2) NOT NULL DEFAULT 4.17,
  ADD COLUMN "pctOtrasCargas"   DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "diasLaboralesMes" DECIMAL(5,2) NOT NULL DEFAULT 26;

CREATE TABLE "ParteDiario" (
  "id"            SERIAL PRIMARY KEY,
  "projectId"     INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fecha"         DATE NOT NULL,
  "workFrontId"   INTEGER REFERENCES "WorkFront"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "clima"         TEXT,
  "estadoFaena"   TEXT NOT NULL DEFAULT 'NORMAL',
  "actividades"   TEXT,
  "observaciones" TEXT,
  "supervisor"    TEXT,
  "clientUuid"    TEXT NOT NULL,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ParteDiario_clientUuid_key" ON "ParteDiario"("clientUuid");
CREATE INDEX "ParteDiario_projectId_fecha_idx" ON "ParteDiario"("projectId", "fecha");

CREATE TABLE "ParteHoraPersonal" (
  "id"           SERIAL PRIMARY KEY,
  "parteId"      INTEGER NOT NULL REFERENCES "ParteDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "projectId"    INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fecha"        DATE NOT NULL,
  "empleadoId"   INTEGER NOT NULL REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "budgetItemId" INTEGER REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "horas"        DECIMAL(5,2) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ParteHoraPersonal_projectId_fecha_idx" ON "ParteHoraPersonal"("projectId", "fecha");
CREATE INDEX "ParteHoraPersonal_empleadoId_fecha_idx" ON "ParteHoraPersonal"("empleadoId", "fecha");

ALTER TABLE "ParteEquipo" ADD COLUMN "parteId" INTEGER REFERENCES "ParteDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CargaCombustible" (
  "id"        SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "parteId"   INTEGER REFERENCES "ParteDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fecha"     DATE NOT NULL,
  "equipoId"  INTEGER NOT NULL REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "litros"    DECIMAL(10,2) NOT NULL,
  "horometro" DECIMAL(12,1),
  "fotoUrl"   TEXT,
  "nota"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CargaCombustible_projectId_fecha_idx" ON "CargaCombustible"("projectId", "fecha");
CREATE INDEX "CargaCombustible_equipoId_fecha_idx" ON "CargaCombustible"("equipoId", "fecha");

CREATE TABLE "ViajeCamion" (
  "id"            SERIAL PRIMARY KEY,
  "projectId"     INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "parteId"       INTEGER REFERENCES "ParteDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fecha"         DATE NOT NULL,
  "equipoId"      INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "origen"        TEXT NOT NULL,
  "destino"       TEXT NOT NULL,
  "materialId"    INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "materialTexto" TEXT,
  "cantidad"      DECIMAL(12,3) NOT NULL,
  "unidad"        TEXT NOT NULL,
  "km"            DECIMAL(10,1),
  "budgetItemId"  INTEGER REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "nota"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ViajeCamion_projectId_fecha_idx" ON "ViajeCamion"("projectId", "fecha");
