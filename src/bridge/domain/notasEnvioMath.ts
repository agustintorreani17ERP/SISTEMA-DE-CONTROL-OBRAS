/**
 * Notas de envío: reglas puras (sin base de datos). Una nota lleva documentos o materiales de un
 * lugar a otro (oficina, obra, taller). Solo documenta: nunca mueve stock.
 */

export const ESTADOS_NOTA = ["ENVIADA", "RECIBIDA", "ANULADA"] as const;
export type EstadoNota = (typeof ESTADOS_NOTA)[number];

export type LugarNota = "OFICINA" | "OBRA" | "TALLER";
export type SistemaNota = "ERP" | "ECMS" | "TALLER";
export type ContenidoNota = "DOCUMENTOS" | "MATERIALES";
export type TipoLineaNota = "PEDIDO" | "OC" | "RECEPCION" | "SF" | "CERTIFICADO" | "FACTURA" | "REMITO" | "MATERIAL" | "MANUAL";

/** Documento del sistema al que apunta cada tipo de renglón (REMITO, MATERIAL y MANUAL no enlazan). */
export const REF_DE_TIPO = {
  PEDIDO: "materialRequestId",
  OC: "purchaseOrderId",
  SF: "solicitudFondoId",
  CERTIFICADO: "certificationId",
  FACTURA: "invoiceId",
} as const;
export type RefKey = (typeof REF_DE_TIPO)[keyof typeof REF_DE_TIPO];
export const REF_KEYS: RefKey[] = Object.values(REF_DE_TIPO);

/** Qué lugar de origen puede emitir cada sistema: el ERP es la oficina, el ECMS la obra, el Taller el taller. */
export const ORIGEN_DE_SISTEMA: Record<SistemaNota, LugarNota> = { ERP: "OFICINA", ECMS: "OBRA", TALLER: "TALLER" };

/** Sistema que marca la nota como recibida según el lugar de destino. */
export const SISTEMA_DE_DESTINO: Record<LugarNota, SistemaNota> = { OFICINA: "ERP", OBRA: "ECMS", TALLER: "TALLER" };

export interface RutaNota {
  sistemaOrigen: SistemaNota;
  origenTipo: LugarNota;
  origenProjectId?: number | null;
  destinoTipo: LugarNota;
  destinoProjectId?: number | null;
}

/** Problemas de la ruta; vacío si es válida. */
export function validarRuta(r: RutaNota): string[] {
  const out: string[] = [];
  if (ORIGEN_DE_SISTEMA[r.sistemaOrigen] !== r.origenTipo) {
    out.push(`El ${r.sistemaOrigen} solo emite notas desde ${ORIGEN_DE_SISTEMA[r.sistemaOrigen].toLowerCase()}`);
  }
  if (r.origenTipo === "OBRA" && !r.origenProjectId) out.push("Falta la obra de origen");
  if (r.origenTipo !== "OBRA" && r.origenProjectId) out.push("Solo una obra puede ser origen con obra");
  if (r.destinoTipo === "OBRA" && !r.destinoProjectId) out.push("Falta la obra de destino");
  if (r.destinoTipo !== "OBRA" && r.destinoProjectId) out.push("Solo una obra puede ser destino con obra");
  if (r.origenTipo === r.destinoTipo) {
    if (r.origenTipo === "OBRA" && r.origenProjectId && r.origenProjectId === r.destinoProjectId) {
      out.push("El origen y el destino son la misma obra");
    }
    // Taller → taller es un envío interno que solo emite el Taller; oficina → oficina no existe
    if (r.origenTipo === "OFICINA") out.push("El origen y el destino son la misma oficina");
    if (r.origenTipo === "TALLER" && r.sistemaOrigen !== "TALLER") out.push("Los envíos internos del taller los emite el Taller");
  }
  return out;
}

export interface LineaNota {
  kind: TipoLineaNota;
  materialRequestId?: number | null;
  purchaseOrderId?: number | null;
  solicitudFondoId?: number | null;
  certificationId?: number | null;
  invoiceId?: number | null;
  materialId?: number | null;
  descripcion?: string | null;
  cantidad?: number | null;
  unidad?: string | null;
}

/** RECEPCION solo existe en el Taller (recepción de un pedido): se guarda como texto, sin enlace. */
const TIPOS_DOCUMENTO: TipoLineaNota[] = ["PEDIDO", "OC", "RECEPCION", "SF", "CERTIFICADO", "FACTURA", "REMITO", "MANUAL"];

/** Problemas de los renglones; vacío si son válidos. */
export function validarLineas(contenido: ContenidoNota, lineas: LineaNota[]): string[] {
  if (lineas.length === 0) return ["La nota necesita al menos un renglón"];
  const out: string[] = [];
  lineas.forEach((l, i) => {
    const n = `Renglón ${i + 1}`;
    if (contenido === "DOCUMENTOS" && !TIPOS_DOCUMENTO.includes(l.kind)) out.push(`${n}: ${l.kind} no es un documento`);
    if (contenido === "MATERIALES" && l.kind !== "MATERIAL" && l.kind !== "MANUAL") out.push(`${n}: una nota de materiales lleva materiales`);
    const refs = REF_KEYS.filter((k) => l[k] != null);
    const esperada = (REF_DE_TIPO as Record<string, RefKey | undefined>)[l.kind];
    if (esperada) {
      if (refs.length !== 1 || refs[0] !== esperada) out.push(`${n}: ${l.kind} debe enlazar exactamente un documento`);
    } else if (refs.length > 0) {
      out.push(`${n}: ${l.kind} no enlaza documentos`);
    }
    if (!esperada && !(l.descripcion ?? "").trim()) out.push(`${n}: falta la descripción`);
    if (l.kind === "MATERIAL" || contenido === "MATERIALES") {
      if (l.cantidad == null || !(l.cantidad > 0)) out.push(`${n}: la cantidad debe ser mayor a 0`);
    }
  });
  return out;
}

const FLUJO: Record<EstadoNota, EstadoNota[]> = {
  ENVIADA: ["RECIBIDA", "ANULADA"],
  RECIBIDA: [],
  ANULADA: [],
};

export const puedeTransicionar = (from: EstadoNota, to: EstadoNota) => FLUJO[from].includes(to);

export interface DatosRecepcion {
  fechaNota: string;
  recibidoFecha: string;
  recibidoPor: string;
}

/** Quien recibe tiene que dejar su nombre y una fecha que no sea anterior a la de la nota. */
export function validarRecepcion(d: DatosRecepcion): string[] {
  const out: string[] = [];
  if (!d.recibidoPor.trim()) out.push("Falta quién recibió la nota");
  if (d.recibidoFecha < d.fechaNota) out.push("La fecha de recepción no puede ser anterior a la de la nota");
  return out;
}

/** Cantidad de notas por estado, para los contadores de la bandeja. */
export function contarPorEstado(notas: { estado: EstadoNota }[]): Record<EstadoNota, number> {
  const base: Record<EstadoNota, number> = { ENVIADA: 0, RECIBIDA: 0, ANULADA: 0 };
  for (const n of notas) base[n.estado]++;
  return base;
}
