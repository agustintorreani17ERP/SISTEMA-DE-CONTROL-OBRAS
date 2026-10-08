-- Control de medición de subcontratistas por obra (avisar / bloquear / no controlar).
-- El proyecto usa 'prisma db push'; SQL equivalente para aplicar a mano.

-- CreateEnum
CREATE TYPE "ControlMedicionSub" AS ENUM ('AVISAR', 'BLOQUEAR', 'NO_CONTROLAR');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "controlMedicionSub" "ControlMedicionSub" NOT NULL DEFAULT 'AVISAR';
