import { Router } from "express";
import { login, register } from "../controllers/authController";
import { rateLimit } from "../middleware/rateLimit";

/** Credential endpoints, rate-limited per IP (default 20 attempts per 15 minutes). */
export function createAuthRouter(limit: { windowMs: number; max: number }) {
  const router = Router();
  const authLimiter = rateLimit(limit);

  router.post("/register", authLimiter, register);
  router.post("/login", authLimiter, login);

  return router;
}
