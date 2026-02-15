import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { signUser } from "../utils/jwt";

export async function register(req: Request, res: Response) {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash });

  const token = signUser({ id: user.id, name: user.name, email: user.email });
  return res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signUser({ id: user.id, name: user.name, email: user.email });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
}
