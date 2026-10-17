import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "../../errors/domain";
import { audit } from "../../core/domain/audit";
import { localIso } from "../../core/domain/localDate";
import { asignarNumero } from "../../core/domain/numeracion";
import { encolarEvento } from "./eventosSalida";
import {
  puedeTransicionar,
  REF_DE_TIPO,
  SISTEMA_DE_DESTINO,
  validarLineas,
  validarRecepcion,
  validarRuta,
  type ContenidoNota,
  type LineaNota,
  type RefKey,
  type RutaNota,
  type SistemaNota,
} from "./notasEnvioMath";

/**
 * Notas de envío entre oficina (ERP), obra (ECMS) y taller (Taller). Cada sistema emite las suyas
 * con el correlativo único "NE" del ERP; la recibe el sistema de destino. Solo documenta: nunca
 * llama a recordStockMovement. Las notas hacia o desde el Taller avisan por la cola de eventos.
 */

type Tx = Prisma.TransactionClient;

const toDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface CrearNotaInput extends RutaNota {
  fecha: string;
  contenido: ContenidoNota;
  chofer?: string | null;
  observaciones?: string | null;
  lineas: LineaNota[];
}

function requireUsuario(usuario: string | null | undefined): string {
  const u = (usuario ?? "").trim();
  if (!u) throw new DomainError("USUARIO_REQUERIDO", "Falta el usuario que realiza la acción", 401);
  return u;
}

/** Nombre legible de la tabla de cada documento enlazable, para validar que exista. */
const EXISTE: Record<RefKey, (tx: Tx, id: number) => Promise<unknown>> = {
  materialRequestId: (tx, id) => tx.materialRequest.findUnique({ where: { id } }),
  purchaseOrderId: (tx, id) => tx.purchaseOrder.findUnique({ where: { id } }),
  solicitudFondoId: (tx, id) => tx.solicitudFondo.findUnique({ where: { id } }),
  certificationId: (tx, id) => tx.certification.findUnique({ where: { id } }),
  invoiceId: (tx, id) => tx.invoice.findUnique({ where: { id } }),
};

const ETIQUETA: Record<RefKey, string> = {
  materialRequestId: "El pedido",
  purchaseOrderId: "La orden de compra",
  solicitudFondoId: "La solicitud de fondos",
  certificationId: "El certificado",
  invoiceId: "La factura",
};

async function assertProyecto(tx: Tx, id: number | null | undefined, rol: string) {
  if (!id) return;
  if (!(await tx.project.findUnique({ where: { id } }))) throw new NotFoundError(`Obra de ${rol}`, id);
}

/** Cada documento está, como mucho, en una nota vigente (como en el Taller). */
async function assertSinNotaVigente(tx: Tx, lineas: LineaNota[]) {
  for (const l of lineas) {
    for (const key of Object.values(REF_DE_TIPO) as RefKey[]) {
      const id = l[key];
      if (id == null) continue;
      if (!(await EXISTE[key](tx, id))) throw new NotFoundError(ETIQUETA[key].replace(/^(El|La) /, ""), id);
      const previa = await tx.notaEnvioLinea.findFirst({ where: { vigente: true, [key]: id }, include: { nota: true } });
      if (previa) {
        throw new DomainError(
          "DOCUMENTO_YA_ENVIADO",
          `${ETIQUETA[key]} #${id} ya está en la nota N° ${previa.nota.numero}/${previa.nota.anio}`,
          409
        );
      }
    }
  }
}

export async function crearNota(tx: Tx, input: CrearNotaInput, usuario: string) {
  const creadoPor = requireUsuario(usuario);
  if (!ISO.test(input.fecha)) throw new DomainError("FECHA_INVALIDA", "Fecha AAAA-MM-DD", 422);
  const problemas = [...validarRuta(input), ...validarLineas(input.contenido, input.lineas)];
  if (problemas.length) throw new DomainError("NOTA_INVALIDA", problemas.join("; "), 422, problemas);

  await assertProyecto(tx, input.origenProjectId, "origen");
  await assertProyecto(tx, input.destinoProjectId, "destino");
  await assertSinNotaVigente(tx, input.lineas);

  const fecha = toDay(input.fecha);
  const { anio, numero } = await asignarNumero(tx, { tipo: "NE", fecha, sistema: input.sistemaOrigen, externalId: randomUUID() });
  const nota = await tx.notaEnvio.create({
    data: {
      anio,
      numero,
      fecha,
      sistemaOrigen: input.sistemaOrigen,
      origenTipo: input.origenTipo,
      origenProjectId: input.origenProjectId ?? null,
      destinoTipo: input.destinoTipo,
      destinoProjectId: input.destinoProjectId ?? null,
      contenido: input.contenido,
      chofer: input.chofer?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      creadoPor,
      lineas: {
        create: input.lineas.map((l, i) => ({
          position: i + 1,
          kind: l.kind,
          materialRequestId: l.materialRequestId ?? null,
          purchaseOrderId: l.purchaseOrderId ?? null,
          solicitudFondoId: l.solicitudFondoId ?? null,
          certificationId: l.certificationId ?? null,
          invoiceId: l.invoiceId ?? null,
          materialId: l.materialId ?? null,
          descripcion: (l.descripcion ?? "").trim() || etiquetaDeDocumento(l),
          cantidad: l.cantidad ?? null,
          unidad: l.unidad?.trim() || null,
        })),
      },
    },
    include: { lineas: true },
  });
  await audit(tx, { entity: "NotaEnvio", entityId: nota.id, action: "CREAR", toStatus: "ENVIADA" });
  // El Taller se entera de las notas que le mandan para que su gente las reciba allá
  if (input.destinoTipo === "TALLER" && input.sistemaOrigen !== "TALLER") {
    await encolarEvento(tx, "TALLER", "nota.enviada", payloadParaTaller(nota));
  }
  return nota;
}

function etiquetaDeDocumento(l: LineaNota): string {
  for (const [tipo, key] of Object.entries(REF_DE_TIPO)) {
    const id = l[key as RefKey];
    if (id != null) return `${tipo} #${id}`;
  }
  return l.kind;
}

type NotaConLineas = Prisma.NotaEnvioGetPayload<{ include: { lineas: true } }>;

/** Lo que el Taller necesita saber de una nota que le mandan. */
function payloadParaTaller(n: NotaConLineas): Prisma.InputJsonValue {
  return {
    anio: n.anio,
    numero: n.numero,
    fecha: isoDay(n.fecha),
    sistemaOrigen: n.sistemaOrigen,
    origenTipo: n.origenTipo,
    destinoTipo: n.destinoTipo,
    contenido: n.contenido,
    chofer: n.chofer,
    observaciones: n.observaciones,
    lineas: n.lineas.map((l) => ({
      position: l.position,
      kind: l.kind,
      descripcion: l.descripcion,
      cantidad: l.cantidad == null ? null : Number(l.cantidad),
      unidad: l.unidad,
    })),
  };
}

export interface RecibirInput {
  /** Sistema desde el que se recibe: tiene que ser el del destino de la nota. */
  sistema: SistemaNota;
  recibidoPor: string;
  fecha?: string;
}

export async function recibirNota(tx: Tx, id: number, input: RecibirInput) {
  const nota = await tx.notaEnvio.findUnique({ where: { id } });
  if (!nota) throw new NotFoundError("Nota de envío", id);
  const destino = SISTEMA_DE_DESTINO[nota.destinoTipo];
  if (input.sistema !== destino) {
    throw new DomainError("NO_ES_DESTINO", `Esta nota la recibe el ${destino}, no el ${input.sistema}`, 409);
  }
  if (!puedeTransicionar(nota.estado, "RECIBIDA")) {
    throw new DomainError("TRANSICION_INVALIDA", `La nota está ${nota.estado.toLowerCase()} y no se puede recibir`, 422);
  }
  const recibidoFecha = input.fecha ?? localIso();
  const problemas = validarRecepcion({ fechaNota: isoDay(nota.fecha), recibidoFecha, recibidoPor: input.recibidoPor });
  if (problemas.length) throw new DomainError("RECEPCION_INVALIDA", problemas.join("; "), 422, problemas);

  const updated = await tx.notaEnvio.update({
    where: { id },
    data: { estado: "RECIBIDA", recibidoFecha: toDay(recibidoFecha), recibidoPor: input.recibidoPor.trim() },
  });
  await audit(tx, { entity: "NotaEnvio", entityId: id, action: "RECIBIR", fromStatus: nota.estado, toStatus: "RECIBIDA" });
  // El origen se entera: el Taller marca como recibida la nota que mandó
  if (nota.sistemaOrigen === "TALLER") {
    await encolarEvento(tx, "TALLER", "nota.recibida", {
      externalId: nota.externalId,
      anio: nota.anio,
      numero: nota.numero,
      recibidoFecha,
      recibidoPor: input.recibidoPor.trim(),
    });
  }
  return updated;
}

export async function anularNota(tx: Tx, id: number, input: { sistema: SistemaNota; motivo: string }) {
  const nota = await tx.notaEnvio.findUnique({ where: { id } });
  if (!nota) throw new NotFoundError("Nota de envío", id);
  if (input.sistema !== nota.sistemaOrigen) {
    throw new DomainError("NO_ES_ORIGEN", `Esta nota la anula el ${nota.sistemaOrigen}, que la emitió`, 409);
  }
  if (!puedeTransicionar(nota.estado, "ANULADA")) {
    throw new DomainError("TRANSICION_INVALIDA", `La nota está ${nota.estado.toLowerCase()} y no se puede anular`, 422);
  }
  const motivo = input.motivo.trim();
  if (!motivo) throw new DomainError("MOTIVO_REQUERIDO", "Anular una nota requiere el motivo", 422);

  // Los documentos quedan libres para ir en otra nota
  await tx.notaEnvioLinea.updateMany({ where: { notaId: id }, data: { vigente: false } });
  const updated = await tx.notaEnvio.update({ where: { id }, data: { estado: "ANULADA", anuladoMotivo: motivo } });
  await audit(tx, { entity: "NotaEnvio", entityId: id, action: "ANULAR", fromStatus: nota.estado, toStatus: "ANULADA", payload: { motivo } });
  if (nota.destinoTipo === "TALLER") {
    await encolarEvento(tx, "TALLER", "nota.anulada", { anio: nota.anio, numero: nota.numero, motivo });
  }
  return updated;
}

// ----------------------------------------------------
// Notas que llegan del Taller (integración)
// ----------------------------------------------------

export interface NotaTallerInput {
  externalId: string;
  anio: number;
  numero: number;
  fecha: string;
  destinoTipo: "OFICINA" | "OBRA" | "TALLER";
  destinoProjectId?: number | null;
  contenido: ContenidoNota;
  chofer?: string | null;
  observaciones?: string | null;
  estado: "ENVIADA" | "ANULADA";
  anuladoMotivo?: string | null;
  /** Los renglones del Taller son texto: sus documentos viven en el Taller. */
  lineas: { descripcion: string; cantidad?: number | null; unidad?: string | null }[];
}

/**
 * Registra (o actualiza) una nota emitida por el Taller para que oficina u obra la vean y la
 * reciban. Idempotente por externalId. Una nota que el destino ya recibió no vuelve atrás.
 */
export async function registrarNotaTaller(tx: Tx, input: NotaTallerInput) {
  if (!ISO.test(input.fecha)) throw new DomainError("FECHA_INVALIDA", "Fecha AAAA-MM-DD", 422);
  const problemas = validarRuta({
    sistemaOrigen: "TALLER",
    origenTipo: "TALLER",
    destinoTipo: input.destinoTipo,
    destinoProjectId: input.destinoProjectId ?? null,
  });
  if (problemas.length) throw new DomainError("NOTA_INVALIDA", problemas.join("; "), 422, problemas);
  await assertProyecto(tx, input.destinoProjectId, "destino");

  const existente = await tx.notaEnvio.findUnique({ where: { sistemaOrigen_externalId: { sistemaOrigen: "TALLER", externalId: input.externalId } } });
  if (existente) {
    if (existente.estado === "RECIBIDA") return existente;
    if (input.estado === "ANULADA" && existente.estado !== "ANULADA") {
      await tx.notaEnvioLinea.updateMany({ where: { notaId: existente.id }, data: { vigente: false } });
      return tx.notaEnvio.update({ where: { id: existente.id }, data: { estado: "ANULADA", anuladoMotivo: input.anuladoMotivo?.trim() || "Anulada en el Taller" } });
    }
    return existente;
  }
  return tx.notaEnvio.create({
    data: {
      anio: input.anio,
      numero: input.numero,
      fecha: toDay(input.fecha),
      sistemaOrigen: "TALLER",
      externalId: input.externalId,
      origenTipo: "TALLER",
      destinoTipo: input.destinoTipo,
      destinoProjectId: input.destinoProjectId ?? null,
      contenido: input.contenido,
      chofer: input.chofer?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      estado: input.estado,
      anuladoMotivo: input.estado === "ANULADA" ? input.anuladoMotivo?.trim() || "Anulada en el Taller" : null,
      creadoPor: "Taller",
      lineas: {
        create: input.lineas.map((l, i) => ({
          position: i + 1,
          kind: input.contenido === "MATERIALES" ? "MATERIAL" : "MANUAL",
          descripcion: l.descripcion,
          cantidad: l.cantidad ?? null,
          unidad: l.unidad ?? null,
        })),
      },
    },
  });
}

/** El Taller recibió una nota que le mandó el ERP o el ECMS: la marca recibida acá. */
export async function marcarRecibidaPorTaller(tx: Tx, input: { anio: number; numero: number; recibidoPor: string; fecha?: string }) {
  const nota = await tx.notaEnvio.findUnique({ where: { anio_numero: { anio: input.anio, numero: input.numero } } });
  if (!nota) throw new NotFoundError("Nota de envío", `${input.numero}/${input.anio}`);
  return recibirNota(tx, nota.id, { sistema: "TALLER", recibidoPor: input.recibidoPor, fecha: input.fecha });
}
