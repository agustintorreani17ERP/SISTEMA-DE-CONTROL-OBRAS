import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { DomainError } from "../errors/domain";

const FIELD_LABEL: Record<string, string> = {
  description: "descripción",
  code: "código",
  unit: "unidad",
  quantity: "cantidad",
  unitPrice: "precio unitario",
  totalPrice: "total",
  amount: "monto",
  name: "nombre",
};

/**
 * Convierte el primer problema de validación en un mensaje legible. Para las filas del
 * importador ("rows.1373.description") indica la fila de Excel usando rowNumber del cuerpo.
 */
function describeZodError(err: ZodError, body: unknown): string {
  const issue = err.issues[0];
  if (!issue) return "Datos inválidos";
  const path = issue.path;
  const field = String(path[path.length - 1] ?? "");
  const label = FIELD_LABEL[field] ?? field;
  let where = label ? ` (${label})` : "";
  if (path[0] === "rows" && typeof path[1] === "number") {
    const row = (body as { rows?: { rowNumber?: number }[] })?.rows?.[path[1]];
    where = ` en la fila ${row?.rowNumber ?? path[1] + 1}${label ? ` (${label})` : ""}`;
  }
  return `Datos inválidos${where}: ${issue.message}`;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof DomainError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: describeZodError(err, req.body),
        details: err.flatten(),
      },
    });
  }

  const message = err instanceof Error ? err.message : "Error interno";
  console.error(err);
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message },
  });
}
