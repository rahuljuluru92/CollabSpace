/**
 * Reads and validates required environment variables once at startup so the
 * server fails fast instead of erroring on the first request.
 */
export type AppConfig = {
  port: number;
  mongoUri: string;
  jwtSecret: string;
  corsOrigins: string[];
  isProduction: boolean;
  /** Per-IP limit for the login/register endpoints. */
  authRateLimit: { windowMs: number; max: number };
};

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === "production";

  const mongoUri = env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is not set");

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is not set");
  if (isProduction && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  const corsOrigins = (env.CLIENT_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    if (isProduction) throw new Error("CLIENT_ORIGIN must be set in production");
    corsOrigins.push(...DEV_ORIGINS);
  }
  if (isProduction && corsOrigins.includes("*")) {
    throw new Error("CLIENT_ORIGIN must not be '*' in production");
  }

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

  const authRateLimit = {
    windowMs: Number(env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    max: Number(env.AUTH_RATE_LIMIT_MAX ?? 20)
  };
  if (!Number.isInteger(authRateLimit.max) || authRateLimit.max <= 0) {
    throw new Error("AUTH_RATE_LIMIT_MAX must be a positive integer");
  }
  if (!Number.isInteger(authRateLimit.windowMs) || authRateLimit.windowMs <= 0) {
    throw new Error("AUTH_RATE_LIMIT_WINDOW_MS must be a positive integer");
  }

  return { port, mongoUri, jwtSecret, corsOrigins, isProduction, authRateLimit };
}
