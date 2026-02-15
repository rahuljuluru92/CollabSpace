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
