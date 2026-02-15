import jwt from "jsonwebtoken";
import { UserPayload } from "../types/UserPayload";

export function signUser(payload: UserPayload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}
