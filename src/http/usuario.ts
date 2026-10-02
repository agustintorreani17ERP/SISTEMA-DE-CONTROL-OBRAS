import type { Request } from "express";

/** Usuario que actúa: header `x-usuario` (URI-encoded, lo manda el cliente) o `usuario` en el body. */
export function usuarioDe(req: Request): string {
  const h = req.header("x-usuario");
  if (h) {
    try {
      return decodeURIComponent(h).trim();
    } catch {
      return h.trim();
    }
  }
  return typeof req.body?.usuario === "string" ? req.body.usuario.trim() : "";
}
