import { Types } from "mongoose";

type WorkspaceLike = {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  members: Types.ObjectId[];
  content: string;
  version: number;
  updatedAt: Date;
};

type ActivityLike = {
  _id: Types.ObjectId;
  action: string;
  userId: Types.ObjectId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export function isWorkspaceMember(
  userId: string,
  workspace: { ownerId: { toString(): string }; members: { toString(): string }[] }
) {
  return (
    workspace.ownerId.toString() === userId ||
    workspace.members.some((m) => m.toString() === userId)
  );
}

export function serializeWorkspace(ws: WorkspaceLike) {
  return {
    id: ws._id.toString(),
    name: ws.name,
    ownerId: ws.ownerId.toString(),
    members: ws.members.map((m) => m.toString()),
    content: ws.content,
    version: ws.version,
    updatedAt: ws.updatedAt.toISOString()
  };
}

export function serializeActivity(log: ActivityLike) {
  return {
    id: log._id.toString(),
    action: log.action,
    userId: log.userId.toString(),
    metadata: (log.metadata ?? {}) as Record<string, unknown>,
    createdAt: log.createdAt.toISOString()
  };
}
