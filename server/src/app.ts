import http from "http";
import { randomUUID } from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { pinoHttp } from "pino-http";
import setupSockets from "./sockets";
import type { AppConfig } from "./config/env";
import { createAuthRouter } from "./routes/auth";
import workspaceRoutes from "./routes/workspaces";
import { errorHandler, notFound } from "./middleware/errors";
import { lifecycle } from "./lifecycle";
import { logger } from "./logger";

/** Builds the Express app, HTTP server and Socket.IO server (without listening). */
export function createServer(config: AppConfig) {
  const app = express();
  // Behind Render/other proxies, needed so req.ip (used by the rate limiter) is the client IP.
  if (config.isProduction) app.set("trust proxy", 1);

  // Standard security headers. This API is called from another origin (the web app),
  // so resources may be read cross-origin; CORS still decides who may call it.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    pinoHttp({
      logger,
      // Reuse a caller's request id if it looks sane, else make one; echo it back.
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id =
          typeof incoming === "string" && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
      // Keep request logs short: no headers, cookies or bodies.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode })
      }
    })
  );
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.send("Server is running!");
  });
  // Liveness: the process is up.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  // Readiness: able to serve traffic (database connected, not shutting down).
  app.get("/health/ready", (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? "up" : "down";
    const shuttingDown = lifecycle.isShuttingDown();
    const ready = db === "up" && !shuttingDown;
    res.status(ready ? 200 : 503).json({ ok: ready, db, shuttingDown });
  });
  app.use("/api/auth", createAuthRouter(config.authRateLimit));
  app.use("/api/workspaces", workspaceRoutes);
  app.use(notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = setupSockets(server, config.corsOrigins);
  return { app, server, io };
}
