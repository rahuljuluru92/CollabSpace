import { Server, Socket } from "socket.io";
import { Workspace } from "../models/Workspace";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { logActivity, shouldLogEdit } from "../services/activity";
import { isWorkspaceMember, serializeActivity } from "../services/workspaceSerializer";
import {
  PresenceUpdatePayload,
  UpdateAck,
  WorkspaceSyncPayload
} from "../types/events";
import { presenceJoin, presenceLeave, presenceUpdateCursor } from "./presence";
import { isObjectId, isValidContent, isValidCursor } from "../utils/validation";

type Ack = (response: unknown) => void;

/**
 * Wraps an async socket handler so a thrown error (bad input, DB hiccup) is
 * logged and reported to the client instead of becoming an unhandled promise
 * rejection that would take the whole process down.
 */
function safeHandler(
  socket: Socket,
  event: string,
  handler: (payload: unknown, ack?: Ack) => Promise<void> | void
) {
  socket.on(event, async (payload: unknown, maybeAck?: unknown) => {
    const ack = typeof maybeAck === "function" ? (maybeAck as Ack) : undefined;
    try {
      await handler(payload, ack);
    } catch (err) {
      console.error(`Socket handler "${event}" failed for user ${socket.user?.id}:`, err);
      ack?.({ ok: false, reason: "error" });
    }
  });
}

/** Extracts a valid workspaceId from an untrusted payload. */
function readWorkspaceId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { workspaceId } = payload as { workspaceId?: unknown };
  return isObjectId(workspaceId) ? workspaceId : null;
}

async function buildSync(workspaceId: string): Promise<WorkspaceSyncPayload | null> {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return null;

  const activity = await ActivityLog.find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<ActivityLogDocument[]>();

  return {
    workspaceId: workspace.id,
    content: workspace.content,
    version: workspace.version,
    updatedAt: workspace.updatedAt.toISOString(),
    activity: activity.map(serializeActivity)
  };
}

export default function workspaceSocket(io: Server, socket: Socket) {
  socket.data.userId = socket.user.id;

  safeHandler(socket, "workspace:join", async (payload) => {
    const workspaceId = readWorkspaceId(payload);
    if (!workspaceId) return;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace || !isWorkspaceMember(socket.user.id, workspace)) return;

    const firstJoin = !socket.rooms.has(workspaceId);
    socket.join(workspaceId);

    const users = presenceJoin(workspaceId, socket.id, {
      id: socket.user.id,
      name: socket.user.name
    });
    const presencePayload: PresenceUpdatePayload = { workspaceId, users };
    io.to(workspaceId).emit("presence:update", presencePayload);

    if (firstJoin) {
      await logActivity({
        workspaceId: workspace._id,
        userId: socket.user.id,
        action: "presence:joined"
      });
    }

    const sync = await buildSync(workspaceId);
    if (sync) socket.emit("workspace:sync", sync);
  });

  safeHandler(socket, "workspace:update", async (payload, ack) => {
    const workspaceId = readWorkspaceId(payload);
    const { content, version } = (payload ?? {}) as { content?: unknown; version?: unknown };
    if (!workspaceId || !isValidContent(content) || !Number.isInteger(version)) {
      ack?.({ ok: false, reason: "invalid" } satisfies UpdateAck);
      return;
    }

    const userId = socket.user.id;

    // Atomic compare-and-set: only applies if the client edited the latest
    // version AND is still a member. Two concurrent writers cannot both win.
    const updated = await Workspace.findOneAndUpdate(
      {
        _id: workspaceId,
        version,
        $or: [{ ownerId: userId }, { members: userId }]
      },
      { $set: { content }, $inc: { version: 1 } },
      { new: true }
    );

    if (!updated) {
      const current = await Workspace.findById(workspaceId);
      if (!current || !isWorkspaceMember(userId, current)) {
        ack?.({ ok: false, reason: "forbidden" } satisfies UpdateAck);
        return;
      }
      // Stale version: hand back the latest state so the client can rebase.
      const conflict: UpdateAck = {
        ok: false,
        reason: "conflict",
        content: current.content,
        version: current.version
      };
      if (ack) ack(conflict);
      else {
        const sync = await buildSync(workspaceId);
        if (sync) socket.emit("workspace:sync", sync);
      }
      return;
    }

    ack?.({ ok: true, version: updated.version } satisfies UpdateAck);

    // The sender already has this content; only others need it.
    socket.to(workspaceId).emit("workspace:update", {
      workspaceId,
      content: updated.content,
      version: updated.version,
      userId
    });

    if (shouldLogEdit(workspaceId, userId)) {
      await logActivity({
        workspaceId: updated._id,
        userId,
        action: "workspace:updated",
        metadata: { version: updated.version }
      });
    }
  });

  safeHandler(socket, "cursor:update", (payload) => {
    const workspaceId = readWorkspaceId(payload);
    const cursor = (payload as { cursor?: unknown } | null)?.cursor ?? null;
    // Only sockets that passed the membership check in workspace:join are in the room.
    if (!workspaceId || !socket.rooms.has(workspaceId) || !isValidCursor(cursor)) return;

    presenceUpdateCursor(workspaceId, socket.id, cursor);
    socket.to(workspaceId).emit("cursor:update", { userId: socket.user.id, cursor });
  });

  safeHandler(socket, "workspace:leave", async (payload) => {
    const workspaceId = readWorkspaceId(payload);
    if (!workspaceId || !socket.rooms.has(workspaceId)) return;

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

  socket.on("disconnecting", () => {
    const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id);
    for (const workspaceId of rooms) {
      const users = presenceLeave(workspaceId, socket.id);
      const presencePayload: PresenceUpdatePayload = { workspaceId, users };
      socket.to(workspaceId).emit("presence:update", presencePayload);
    }
  });
}
