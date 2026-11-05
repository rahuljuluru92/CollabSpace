import { Types } from "mongoose";
import { ActivityLog } from "../models/ActivityLog";

export async function logActivity(params: {
  workspaceId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  return ActivityLog.create({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: params.action,
    metadata: params.metadata
  });
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
