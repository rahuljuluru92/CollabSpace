import { isObjectId } from "./validation";

export type Cursor = { at: Date; id: string };

/** Parses a ?limit= query value, falling back to `fallback` and capping at `max`. */
export function parseLimit(value: unknown, fallback: number, max: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Opaque cursor for keyset pagination over (date desc, _id desc). */
export function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.getTime()}:${id}`).toString("base64url");
}

export function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return null;
  const [ms, id] = Buffer.from(value, "base64url").toString("utf8").split(":");
  const time = Number(ms);
  if (!Number.isSafeInteger(time) || !isObjectId(id)) return null;
  return { at: new Date(time), id };
}

/** Filter for "strictly after this cursor" in (field desc, _id desc) order. */
export function afterCursor(field: string, cursor: Cursor) {
  return {
    $or: [{ [field]: { $lt: cursor.at } }, { [field]: cursor.at, _id: { $lt: cursor.id } }]
  };
}
