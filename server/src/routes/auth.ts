import { Router } from "express";
import { login, register } from "../controllers/authController";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// 20 attempts per IP per 15 minutes for credential endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);

export default router;
