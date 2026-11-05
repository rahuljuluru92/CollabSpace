import http from "http";
import express from "express";
import cors from "cors";
import setupSockets from "./sockets";
import type { AppConfig } from "./config/env";
import authRoutes from "./routes/auth";
import workspaceRoutes from "./routes/workspaces";
import { errorHandler, notFound } from "./middleware/errors";

/** Builds the Express app, HTTP server and Socket.IO server (without listening). */
export function createServer(config: AppConfig) {
  const app = express();
  // Behind Render/other proxies, needed so req.ip (used by the rate limiter) is the client IP.
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.send("Server is running!");
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes);
  app.use("/api/workspaces", workspaceRoutes);
  app.use(notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = setupSockets(server, config.corsOrigins);
  return { app, server, io };
}
