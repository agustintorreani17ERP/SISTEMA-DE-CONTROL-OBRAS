import type { Prisma } from "@prisma/client";

/**
 * Cola de avisos del ERP hacia otro sistema (hoy el Taller). El aviso se guarda en la misma
 * transacción que el hecho que lo causa (una nota recibida, un pedido tomado) y un proceso del
 * servidor lo entrega después, con reintentos y espera creciente. Si el Taller está caído el aviso
 * espera: no se pierde ni frena al usuario.
 */

type Tx = Prisma.TransactionClient;

export type DestinoEvento = "TALLER";

export const MAX_INTENTOS = 10;
const ESPERA_BASE_SEG = 30;
const ESPERA_MAX_SEG = 6 * 60 * 60;

/** Espera antes del próximo intento: 30 s, 1 min, 2 min… hasta 6 h. */
export function esperaSegundos(intentos: number): number {
  return Math.min(ESPERA_MAX_SEG, ESPERA_BASE_SEG * 2 ** Math.max(0, intentos - 1));
}

export async function encolarEvento(tx: Tx, destino: DestinoEvento, tipo: string, payload: Prisma.InputJsonValue) {
  return tx.eventoSalida.create({ data: { destino, tipo, payload } });
}

export interface EventoPendiente {
  id: number;
  destino: string;
  tipo: string;
  payload: unknown;
  intentos: number;
}

export interface ResultadoProceso {
  enviados: number;
  reintentos: number;
  fallidos: number;
}

/**
 * Entrega los avisos pendientes en orden. `enviar` lanza si el destino no respondió. Un aviso que
 * agota MAX_INTENTOS queda FALLIDO para revisarlo a mano. Si uno falla o espera su reintento, los
 * siguientes del mismo destino esperan: los avisos dependen unos de otros (enviada → recibida).
 */
export async function procesarEventos(
  db: Pick<Tx, "eventoSalida">,
  enviar: (e: EventoPendiente) => Promise<void>,
  opts: { ahora?: Date; limite?: number } = {}
): Promise<ResultadoProceso> {
  const ahora = opts.ahora ?? new Date();
  // Se leen todos los pendientes (no solo los vencidos): un aviso que espera su reintento bloquea
  // a los siguientes del mismo destino, así nunca llegan fuera de orden.
  const pendientes = await db.eventoSalida.findMany({
    where: { estado: "PENDIENTE" },
    orderBy: { id: "asc" },
    take: opts.limite ?? 50,
  });
  const res: ResultadoProceso = { enviados: 0, reintentos: 0, fallidos: 0 };
  const cortados = new Set<string>();
  for (const e of pendientes) {
    if (cortados.has(e.destino)) continue;
    if (e.proximoIntento.getTime() > ahora.getTime()) {
      cortados.add(e.destino);
      continue;
    }
    try {
      await enviar({ id: e.id, destino: e.destino, tipo: e.tipo, payload: e.payload, intentos: e.intentos });
      await db.eventoSalida.update({ where: { id: e.id }, data: { estado: "ENVIADO", enviadoAt: ahora, ultimoError: null } });
      res.enviados++;
    } catch (err) {
      const intentos = e.intentos + 1;
      const agotado = intentos >= MAX_INTENTOS;
      await db.eventoSalida.update({
        where: { id: e.id },
        data: {
          intentos,
          estado: agotado ? "FALLIDO" : "PENDIENTE",
          proximoIntento: new Date(ahora.getTime() + esperaSegundos(intentos) * 1000),
          ultimoError: String((err as Error)?.message ?? err).slice(0, 500),
        },
      });
      if (agotado) res.fallidos++;
      else res.reintentos++;
      cortados.add(e.destino);
    }
  }
  return res;
}
