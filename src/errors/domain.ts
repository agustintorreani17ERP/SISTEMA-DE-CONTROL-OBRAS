export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: number | string) {
    super("NOT_FOUND", `${entity} ${id} no existe`, 404);
  }
}

export class BudgetCeilingError extends DomainError {
  constructor(itemCode: string, requested: string, remaining: string) {
    super(
      "BUDGET_CEILING_EXCEEDED",
      `Techo presupuestario excedido en partida ${itemCode}. Solicitado ${requested}, disponible ${remaining}.`,
      409
    );
  }
}

export class TraceabilityError extends DomainError {
  constructor(message: string) {
    super("TRACEABILITY_VIOLATION", message, 422);
  }
}

export class ImmutabilityError extends DomainError {
  constructor(entity: string, status: string) {
    super(
      "FINANCIAL_IMMUTABILITY",
      `${entity} en estado ${status} no puede modificarse ni eliminarse.`,
      409
    );
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super("INVALID_STATUS_TRANSITION", `Transición inválida: ${from} → ${to}`, 422);
  }
}
