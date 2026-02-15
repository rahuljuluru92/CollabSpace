import { Server, Socket } from "socket.io";
import { Workspace } from "../models/Workspace";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { logActivity } from "../services/activity";
import {
  WorkspaceJoinPayload,
  WorkspaceUpdatePayload,
  WorkspaceSyncPayload,
  PresenceUpdatePayload
} from "../types/events";
import { presenceJoin, presenceLeave, presenceUpdateCursor } from "./presence";

function isMember(userId: string, workspace: { ownerId: { toString(): string }; members: { toString(): string }[] }) {
  return (
    workspace.ownerId.toString() === userId ||
    workspace.members.map((m) => m.toString()).includes(userId)
  );
}

async function emitSync(socket: Socket, workspaceId: string) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return;

  const activity = await ActivityLog.find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<ActivityLogDocument[]>();

  const payload: WorkspaceSyncPayload = {
    workspaceId: workspace.id,
    content: workspace.content,
    version: workspace.version,
    updatedAt: workspace.updatedAt.toISOString(),
    activity: activity.map((log: ActivityLogDocument) => ({
      id: log._id.toString(),
      action: log.action,
      userId: log.userId.toString(),
      metadata: (log.metadata ?? {}) as Record<string, unknown>,
      createdAt: log.createdAt.toISOString()
    }))
  };

  socket.emit("workspace:sync", payload);
}

export default function workspaceSocket(io: Server, socket: Socket) {
  socket.on("workspace:join", async ({ workspaceId }: WorkspaceJoinPayload) => {
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) return;

    if (!isMember(socket.user.id, workspace)) return;

    socket.join(workspaceId);

    const users = presenceJoin(workspaceId, socket.id, {
      id: socket.user.id,
      name: socket.user.name
    });

    const presencePayload: PresenceUpdatePayload = { workspaceId, users };
    io.to(workspaceId).emit("presence:update", presencePayload);

    await logActivity({
      workspaceId: workspace._id,
      userId: socket.user.id,
      action: "presence:joined"
    });

    await emitSync(socket, workspaceId);
  });

  socket.on("workspace:update", async ({ workspaceId, content, version }: WorkspaceUpdatePayload) => {
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) return;

    if (!isMember(socket.user.id, workspace)) return;

    if (version !== workspace.version) {
      await emitSync(socket, workspaceId);
      return;
    }

    workspace.content = content;
    workspace.version = workspace.version + 1;
    await workspace.save();

    await logActivity({
      workspaceId: workspace._id,
      userId: socket.user.id,
      action: "workspace:updated",
      metadata: { version: workspace.version }
    });

    io.to(workspaceId).emit("workspace:update", {
      workspaceId,
      content: workspace.content,
      version: workspace.version
    });
  });

  socket.on("cursor:update", ({ workspaceId, cursor }: { workspaceId: string; cursor: { x: number; y: number } }) => {
    presenceUpdateCursor(workspaceId, socket.id, cursor);
    // Broadcast to others in the room (excluding sender)
    socket.to(workspaceId).emit("cursor:update", {
      userId: socket.user.id,
      cursor
    });
  });

  socket.on("workspace:leave", async ({ workspaceId }: WorkspaceJoinPayload) => {
    socket.leave(workspaceId);

    const users = presenceLeave(workspaceId, socket.id);
    const presencePayload: PresenceUpdatePayload = { workspaceId, users };
    io.to(workspaceId).emit("presence:update", presencePayload);

    await logActivity({
      workspaceId,
      userId: socket.user.id,
      action: "presence:left"
    });
  });

  socket.on("disconnecting", async () => {
    const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id);
    for (const workspaceId of rooms) {
      const users = presenceLeave(workspaceId, socket.id);
      const presencePayload: PresenceUpdatePayload = { workspaceId, users };
      io.to(workspaceId).emit("presence:update", presencePayload);
    }
  });
}
