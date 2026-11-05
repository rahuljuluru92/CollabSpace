import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "./config/db";
import { loadConfig } from "./config/env";
import { createServer } from "./app";
import { drain } from "./sockets/lock";
import { lifecycle } from "./lifecycle";
import { logger } from "./logger";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const { server, io } = createServer(config);

/**
 * Graceful shutdown (Render and most hosts send SIGTERM on every deploy):
 * 1. Mark the server as shutting down: readiness turns 503 and new edits are
 *    refused with "unavailable", so clients know they were not applied.
 * 2. Let edits that were already received finish and be acknowledged.
 * 3. Close Socket.IO and the HTTP server (in-flight requests complete;
 *    clients reconnect to the new instance), then the database connection.
 */
async function shutdown(signal: string) {
  if (lifecycle.isShuttingDown()) return;
  lifecycle.beginShutdown();
  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await drain();
    await io.close();
    await mongoose.disconnect();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Last line of defence: log instead of crashing on a stray rejected promise.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

connectDb(config.mongoUri)
  .then(() => {
    server.listen(config.port, () => logger.info({ port: config.port }, "Server listening"));
  })
  .catch((err) => {
    logger.fatal({ err }, "Failed to connect to MongoDB");
    process.exit(1);
  });
