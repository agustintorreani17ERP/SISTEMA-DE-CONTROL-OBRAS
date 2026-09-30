import { api } from "../api";
import type { ParteDiarioInput } from "../types";

/**
 * Cola de envío sin conexión (IndexedDB). Todo parte se guarda primero acá y después se envía:
 * si no hay red queda pendiente y se reintenta al volver la conexión. El servidor es idempotente
 * por clientUuid, así que reenviar nunca duplica. Las fotos viajan como Blob y se suben antes.
 */

export interface OutboxItem {
  clientUuid: string;
  projectId: number;
  kind: "parte-diario";
  payload: ParteDiarioInput;
  /** Foto del ticket por índice de carga de combustible (se sube antes de enviar el parte). */
  fotos: Record<number, Blob>;
  creado: string;
  estado: "PENDIENTE" | "RECHAZADO";
  error?: string;
  intentos: number;
}

export interface FlushResult {
  enviados: { item: OutboxItem; id: number; avisos: string[] }[];
  rechazados: OutboxItem[];
  pendientes: number;
  sinRed: boolean;
}

const DB_NAME = "infratrack-offline";
const STORE = "outbox";
const EVENT = "outbox-change";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientUuid" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

const notify = () => window.dispatchEvent(new Event(EVENT));

export function onOutboxChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** UUID v4 también en http:// de la red local (crypto.randomUUID exige contexto seguro). */
export function newUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function listOutbox(projectId?: number): Promise<OutboxItem[]> {
  const all = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  return all.filter((i) => projectId === undefined || i.projectId === projectId).sort((a, b) => a.creado.localeCompare(b.creado));
}

export async function putOutbox(item: OutboxItem) {
  await tx("readwrite", (s) => s.put(item));
  notify();
}

export async function removeOutbox(clientUuid: string) {
  await tx("readwrite", (s) => s.delete(clientUuid));
  notify();
}

export function enqueueParte(projectId: number, payload: ParteDiarioInput, fotos: Record<number, Blob>) {
  return putOutbox({ clientUuid: payload.clientUuid, projectId, kind: "parte-diario", payload, fotos, creado: new Date().toISOString(), estado: "PENDIENTE", intentos: 0 });
}

const esRechazo = (e: unknown) => {
  const status = (e as { status?: number })?.status;
  return typeof status === "number" && status >= 400 && status < 500;
};

let flushing: Promise<FlushResult> | null = null;

/** Envía los pendientes en orden. Sin red se detiene (quedan pendientes); un 4xx queda RECHAZADO. */
export function flushOutbox(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const res: FlushResult = { enviados: [], rechazados: [], pendientes: 0, sinRed: false };
    const items = (await listOutbox()).filter((i) => i.estado === "PENDIENTE");
    for (const item of items) {
      if (res.sinRed) {
        res.pendientes++;
        continue;
      }
      try {
        for (const [k, blob] of Object.entries(item.fotos)) {
          const i = Number(k);
          const file = new File([blob], `ticket-${item.clientUuid.slice(0, 8)}-${i}.jpg`, { type: blob.type || "image/jpeg" });
          const up = await api.uploadImage(file);
          item.payload.combustible[i] = { ...item.payload.combustible[i], fotoUrl: up.url };
          delete item.fotos[i];
          await putOutbox(item); // la foto ya subida no se vuelve a subir
        }
        const r = await api.saveParteDiario(item.projectId, item.payload);
        await removeOutbox(item.clientUuid);
        res.enviados.push({ item, id: r.id, avisos: r.avisos });
      } catch (e: any) {
        item.intentos++;
        if (esRechazo(e)) {
          item.estado = "RECHAZADO";
          item.error = e.message;
          res.rechazados.push(item);
        } else {
          res.sinRed = true;
          res.pendientes++;
        }
        await putOutbox(item);
      }
    }
    return res;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ─── Datos para trabajar sin conexión ─────────────────────────────────────

export function cacheGetJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSetJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin espacio o modo privado: se sigue sin caché */
  }
}

export function cacheRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* idem */
  }
}
