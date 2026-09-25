import { DocumentStatus, SubcontractStatus } from "@prisma/client";
import { ImmutabilityError, InvalidTransitionError } from "../errors/domain";

const LOCKED_DOC: DocumentStatus[] = [
  DocumentStatus.APROBADO_PARA_COMPRA,
  DocumentStatus.EMITIDA,
  DocumentStatus.RECIBIDO,
];

const LOCKED_SUB: SubcontractStatus[] = [
  SubcontractStatus.CERTIFICADO,
  SubcontractStatus.PAGADO,
  SubcontractStatus.CERRADO,
];

const DOC_FLOW: Record<DocumentStatus, DocumentStatus[]> = {
  BORRADOR: [DocumentStatus.APROBADO_PARA_COMPRA, DocumentStatus.ANULADO],
  APROBADO_PARA_COMPRA: [DocumentStatus.EMITIDA, DocumentStatus.ANULADO],
  EMITIDA: [DocumentStatus.RECIBIDO, DocumentStatus.ANULADO],
  RECIBIDO: [],
  ANULADO: [],
};

const SUB_FLOW: Record<SubcontractStatus, SubcontractStatus[]> = {
  BORRADOR: [SubcontractStatus.CERTIFICADO],
  CERTIFICADO: [SubcontractStatus.PAGADO],
  PAGADO: [SubcontractStatus.CERRADO],
  CERRADO: [],
};

export function assertMutableDocument(entity: string, status: DocumentStatus) {
  if (LOCKED_DOC.includes(status) || status === DocumentStatus.ANULADO) {
    throw new ImmutabilityError(entity, status);
  }
}

export function assertMutableSubcontract(entity: string, status: SubcontractStatus) {
  if (LOCKED_SUB.includes(status)) {
    throw new ImmutabilityError(entity, status);
  }
}

export function assertDocTransition(from: DocumentStatus, to: DocumentStatus) {
  if (!DOC_FLOW[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function assertSubTransition(from: SubcontractStatus, to: SubcontractStatus) {
  if (!SUB_FLOW[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
