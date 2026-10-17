import type { Prisma } from "@prisma/client";
import { DomainError } from "../../errors/domain";

/**
 * Numeración única de documentos compartidos entre ERP, ECMS y Taller (SF, NE): una secuencia por
 * tipo y año, "385/2026". La asigna el ERP al crear el documento en el sistema de origen; pedirla
 * dos veces para el mismo documento (sistema + externalId) devuelve el mismo número.
 */

type Tx = Prisma.TransactionClient;

export type TipoDocumento = "SF" | "NE";
export type SistemaOrigen = "ERP" | "ECMS" | "TALLER";

export interface NumeroDoc {
  anio: number;
  numero: number;
}

export interface AsignarNumeroInput {
  tipo: TipoDocumento;
  /** Fecha del documento: define el año de la secuencia. */
  fecha: Date;
  sistema: SistemaOrigen;
  /** Id del documento en su sistema (único por tipo y sistema). */
  externalId: string;
}

export const formatNumeroDoc = (n: NumeroDoc) => `${n.numero}/${n.anio}`;

export async function asignarNumero(tx: Tx, input: AsignarNumeroInput): Promise<NumeroDoc> {
  const anio = input.fecha.getUTCFullYear();
  const previo = await tx.numeroAsignado.findUnique({
    where: { tipo_sistema_externalId: { tipo: input.tipo, sistema: input.sistema, externalId: input.externalId } },
  });
  if (previo) return { anio: previo.anio, numero: previo.numero };

  // Incremento atómico: crea en 2 (entrega el 1) o suma 1 y entrega el anterior al nuevo valor.
  const seq = await tx.secuenciaDocumento.upsert({
    where: { tipo_anio: { tipo: input.tipo, anio } },
    create: { tipo: input.tipo, anio, siguiente: 2 },
    update: { siguiente: { increment: 1 } },
  });
  const numero = seq.siguiente - 1;
  await tx.numeroAsignado.create({
    data: { tipo: input.tipo, anio, numero, sistema: input.sistema, externalId: input.externalId },
  });
  return { anio, numero };
}

/**
 * Siembra la secuencia con el último número que ya usa un sistema (histórico del Taller): deja
 * `siguiente = max(actual, ultimo + 1)`. Nunca baja una secuencia.
 */
export async function sembrarSecuencia(tx: Tx, tipo: TipoDocumento, anio: number, ultimo: number) {
  if (!Number.isInteger(ultimo) || ultimo < 0) {
    throw new DomainError("SEMILLA_INVALIDA", "El último número debe ser un entero mayor o igual a 0", 422);
  }
  const actual = await tx.secuenciaDocumento.findUnique({ where: { tipo_anio: { tipo, anio } } });
  const siguiente = Math.max(actual?.siguiente ?? 1, ultimo + 1);
  if (actual) return tx.secuenciaDocumento.update({ where: { tipo_anio: { tipo, anio } }, data: { siguiente } });
  return tx.secuenciaDocumento.create({ data: { tipo, anio, siguiente } });
}
