import type { Prisma, PrismaClient } from "@prisma/client";
import { moneyNumber } from "../lib/money";
import { CARGAS_DEFAULT, type CargasConfig, type CostoHora, costoHora } from "./laborCost";

type Db = PrismaClient | Prisma.TransactionClient;

/** Cargas de la obra; si no tiene, las globales (projectId nulo); si no, los valores por defecto. */
export async function loadCargasConfig(db: Db, projectId?: number | null): Promise<CargasConfig> {
  const cfg =
    (projectId ? await db.rRHHConfig.findUnique({ where: { projectId } }) : null) ?? (await db.rRHHConfig.findFirst({ where: { projectId: null } }));
  if (!cfg) return { ...CARGAS_DEFAULT };
  return {
    pctIpsPatronal: moneyNumber(cfg.pctIpsPatronal),
    aguinaldoMeses: moneyNumber(cfg.aguinaldoMeses),
    pctVacaciones: moneyNumber(cfg.pctVacaciones),
    pctOtrasCargas: moneyNumber(cfg.pctOtrasCargas),
    horasDiasLaborales: moneyNumber(cfg.horasDiasLaborales) || 8,
    diasLaboralesMes: moneyNumber(cfg.diasLaboralesMes) || 26,
  };
}

/** Costo hora con cargas de cada empleado pedido (los que no existen quedan afuera). */
export async function costoHoraEmpleados(db: Db, projectId: number | null, empleadoIds: number[]) {
  const cfg = await loadCargasConfig(db, projectId);
  const emps = await db.empleado.findMany({
    where: { id: { in: [...new Set(empleadoIds)] } },
    select: { id: true, tipo: true, salarioBase: true, costoHoraManual: true },
  });
  const map = new Map<number, CostoHora>();
  for (const e of emps) {
    map.set(e.id, costoHora({ tipo: e.tipo, salarioBase: moneyNumber(e.salarioBase), costoHoraManual: e.costoHoraManual === null ? null : moneyNumber(e.costoHoraManual) }, cfg));
  }
  return { cfg, map };
}
