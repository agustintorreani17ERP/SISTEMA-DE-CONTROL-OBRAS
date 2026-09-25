import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "",
};

if (!env.databaseUrl) {
  console.warn("[InfraTrack ERP] DATABASE_URL no configurada — operando con almacenamiento simulado en memoria.");
}

