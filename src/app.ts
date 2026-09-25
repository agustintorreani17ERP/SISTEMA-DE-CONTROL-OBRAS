import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { env } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", service: "infra-erp" } });
  });

  // API router mounted under /api
  app.use("/api", apiRouter);

  // Serve static client assets
  const clientDistPath = path.resolve(__dirname, "../dist-client");
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        return res.sendFile(path.join(clientDistPath, "index.html"));
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

