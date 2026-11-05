import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { signUser } from "../utils/jwt";
import {
  LIMITS,
  isDuplicateKeyError,
  isEmail,
  isNonEmptyString,
  isValidPassword,
  normalizeEmail
} from "../utils/validation";

// Compared against when the user does not exist so login timing does not
// reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("collabspace-timing-guard", 10);

function authResponse(user: { _id: { toString(): string }; name: string; email: string }) {
  const safeUser = { id: user._id.toString(), name: user.name, email: user.email };
  return { token: signUser(safeUser), user: safeUser };
}

export async function register(req: Request, res: Response) {
  const { name, email, password } = (req.body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(name, LIMITS.nameMax)) {
    return res.status(400).json({ error: `Name is required (max ${LIMITS.nameMax} characters)` });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      error: `Password must be ${LIMITS.passwordMin}-${LIMITS.passwordMax} characters`
    });
  }

  const normalizedEmail = normalizeEmail(email);
  const existing = await User.exists({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash });
    return res.status(201).json(authResponse(user));
  } catch (err) {
    // Two concurrent sign-ups with the same email: the unique index rejects one.
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ error: "Email already registered" });
    }
    throw err;
  }
}

export async function login(req: Request, res: Response) {
  const { email, password } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const user = await User.findOne({ email: normalizeEmail(email) });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.json(authResponse(user));
}
