import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { iniciarEntregaAlTaller } from "./bridge/integracion/tallerClient";

const app = createApp();

const PORT = 3000;
const HOST = "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(`InfraTrack ERP escuchando en http://${HOST}:${PORT}`);
});

const detenerEntrega = iniciarEntregaAlTaller();

async function shutdown() {
  detenerEntrega();
  server.close();
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
