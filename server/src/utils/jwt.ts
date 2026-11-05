import jwt from "jsonwebtoken";
import { UserPayload } from "../types/UserPayload";

const ALGORITHM = "HS256" as const;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signUser(payload: UserPayload) {
  return jwt.sign({ id: payload.id, name: payload.name, email: payload.email }, getSecret(), {
    algorithm: ALGORITHM,
    expiresIn: "7d"
  });
}

/** Verifies a token and returns its user payload, or null if it is invalid/expired. */
export function verifyUserToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] });
    if (typeof decoded !== "object" || decoded === null) return null;
    const { id, name, email } = decoded as Partial<UserPayload>;
    if (typeof id !== "string" || typeof name !== "string" || typeof email !== "string") {
      return null;
    }
    return { id, name, email };
  } catch {
    return null;
  }
}
