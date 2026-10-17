import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Clave de máquina con la que el Taller llama a /api/integracion (no es un rol de usuario). */
  integracionTallerKey: process.env.INTEGRACION_TALLER_KEY ?? "",
  /** URL base del Taller (p. ej. http://127.0.0.1:3101): a donde el ERP entrega sus avisos. */
  tallerUrl: process.env.TALLER_URL ?? "",
};

if (!env.databaseUrl) {
  console.warn("[InfraTrack ERP] DATABASE_URL no configurada — operando con almacenamiento simulado en memoria.");
}

