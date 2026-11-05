import pino from "pino";

/**
 * Structured JSON logs (one object per line), ready for any log platform.
 * Set LOG_LEVEL (trace|debug|info|warn|error|fatal|silent); defaults to info.
 * For readable local output, `npm run dev` pipes through pino-pretty.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Never write credentials to the logs.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
    remove: true
  }
});
