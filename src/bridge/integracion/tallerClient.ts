import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { procesarEventos, type EventoPendiente, type ResultadoProceso } from "../domain/eventosSalida";

/**
 * Entrega al Taller los avisos de la cola (EventoSalida): POST TALLER_URL/api/erp/eventos con la
 * clave de integración. Cualquier respuesta que no sea 2xx cuenta como fallo y se reintenta.
 */

const TIMEOUT_MS = 10_000;

export async function enviarAlTaller(e: EventoPendiente): Promise<void> {
  if (!env.tallerUrl) throw new Error("TALLER_URL no está configurada");
  const res = await fetch(`${env.tallerUrl.replace(/\/+$/, "")}/api/erp/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-integration-key": env.integracionTallerKey },
    body: JSON.stringify({ id: e.id, tipo: e.tipo, payload: e.payload }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`El Taller respondió ${res.status}`);
}

let corriendo = false;

/** Un ciclo de entrega; no se superpone con otro que siga en curso. */
export async function entregarEventosAlTaller(): Promise<ResultadoProceso | null> {
  if (corriendo || !env.tallerUrl || !env.integracionTallerKey) return null;
  corriendo = true;
  try {
    return await procesarEventos(prisma, enviarAlTaller);
  } finally {
    corriendo = false;
  }
}

/** Arranca la entrega periódica (cada 30 s). Sin TALLER_URL los avisos esperan en la cola. */
export function iniciarEntregaAlTaller(intervaloMs = 30_000): () => void {
  if (!env.tallerUrl) {
    console.warn("[integración] TALLER_URL no configurada: los avisos al Taller quedan en cola.");
    return () => undefined;
  }
  const timer = setInterval(() => {
    entregarEventosAlTaller().catch((err) => console.error("[integración] entrega al Taller:", err));
  }, intervaloMs);
  timer.unref();
  return () => clearInterval(timer);
}
