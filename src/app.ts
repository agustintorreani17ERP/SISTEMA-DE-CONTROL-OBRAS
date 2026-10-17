import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { env } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { UPLOADS_DIR } from "./core/modules/uploads/uploads.controller";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", service: "infra-erp" } });
  });

  // Fotos de mediciones
  app.use("/uploads", express.static(UPLOADS_DIR));

  // API router mounted under /api
  app.use("/api", apiRouter);

  // Serve static client assets
  const clientDistPath = path.resolve(__dirname, "../dist-client");
  if (fs.existsSync(clientDistPath)) {
    // index: false: "/" no sirve un HTML suelto, redirige al ERP
    app.use(express.static(clientDistPath, { index: false }));
    app.get("/", (_req, res) => res.redirect("/erp"));
    // Dos apps sobre el mismo servidor: /erp (oficina central) y /ecms (ingenieros en obra)
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        const page = req.path === "/ecms" || req.path.startsWith("/ecms/") ? "ecms.html" : "erp.html";
        return res.sendFile(path.join(clientDistPath, page));
      }
      next();
    });
  } else {
    app.get("/", (_req, res) => {
      res.json({
        success: true,
        message: "InfraTrack ERP API",
        status: "ok",
        health: "/health",
        api: "/api",
      });
    });
  }

  app.use(errorHandler);
  return app;
}

