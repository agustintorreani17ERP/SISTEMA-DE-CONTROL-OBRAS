import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../errors/domain";

/**
 * Rol del usuario que actúa. PROVISORIO hasta el login real: el cliente manda en `x-user-role`
 * el rol del usuario logueado (localStorage). No es seguridad, solo evita acciones por error.
 */
export const rolDe = (req: Request) => String(req.header("x-user-role") ?? "").trim().toUpperCase();

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (roles.includes(rolDe(req))) return next();
    next(new DomainError("FORBIDDEN", `Esta acción la hace un usuario con rol ${roles.join(" o ")}: pedísela a un administrador.`, 403));
  };
}
