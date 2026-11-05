import { Types } from "mongoose";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { getIo } from "../sockets/registry";
import { encodeCursor } from "../utils/pagination";
import { serializeActivity } from "./workspaceSerializer";

/** Records an activity entry and pushes it live to everyone in the workspace. */
export async function logActivity(params: {
  workspaceId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  userName?: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  const log = await ActivityLog.create({
    workspaceId: params.workspaceId,
    userId: params.userId,
    userName: params.userName,
    action: params.action,
    metadata: params.metadata
  });
  const workspaceId = params.workspaceId.toString();
  getIo()
    ?.to(workspaceId)
    .emit("activity:new", { workspaceId, activity: serializeActivity(log) });
  return log;
}

/** One page of activity, newest first, plus a cursor for the next (older) page. */
export async function activityPage(
  filter: Record<string, unknown>,
  limit: number
): Promise<{ activity: ReturnType<typeof serializeActivity>[]; nextCursor: string | null }> {
  const rows = await ActivityLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ActivityLogDocument[]>();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    activity: page.map(serializeActivity),
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.createdAt, last._id.toString()) : null
  };
}

const EDIT_LOG_INTERVAL_MS = 60_000;
const lastEditLog = new Map<string, number>();

/**
 * Edits arrive many times per second while someone types. Record at most one
 * "workspace:updated" entry per user per workspace per minute so the activity
 * log stays useful and does not grow with every keystroke.
 */
export function shouldLogEdit(workspaceId: string, userId: string, now = Date.now()) {
  const key = `${workspaceId}:${userId}`;
  const last = lastEditLog.get(key);
  if (last !== undefined && now - last < EDIT_LOG_INTERVAL_MS) return false;
  lastEditLog.set(key, now);

  // Opportunistic cleanup so the map does not grow without bound.
  if (lastEditLog.size > 10_000) {
    for (const [k, t] of lastEditLog) {
      if (now - t >= EDIT_LOG_INTERVAL_MS) lastEditLog.delete(k);
    }
  }
  return true;
}
