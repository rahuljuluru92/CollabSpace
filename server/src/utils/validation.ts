import { Types } from "mongoose";

export const LIMITS = {
  nameMax: 80,
  workspaceNameMax: 120,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 128,
  // Characters. Even fully JSON-escaped this stays under the 2MB socket message
  // cap, and far below MongoDB's 16MB document limit. Mirrored in the client.
  contentMax: 200_000
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && Types.ObjectId.isValid(value) && /^[a-f\d]{24}$/i.test(value);
}

export function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= LIMITS.emailMax && EMAIL_RE.test(value.trim());
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= LIMITS.passwordMin &&
    value.length <= LIMITS.passwordMax
  );
}

/** Client-generated id for one edit (UUID or similar). */
export function isEditId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isValidContent(value: unknown): value is string {
  return typeof value === "string" && value.length <= LIMITS.contentMax;
}

export function isValidCursor(value: unknown): value is { x: number; y: number } | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}

/** MongoDB duplicate-key error (e.g. unique email index). */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}
