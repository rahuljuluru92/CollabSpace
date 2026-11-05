import { Server, Socket } from "socket.io";
import { Workspace, WorkspaceDocument } from "../models/Workspace";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { logActivity, shouldLogEdit } from "../services/activity";
import { isWorkspaceMember, serializeActivity } from "../services/workspaceSerializer";
import { PresenceUpdatePayload, UpdateAck, WorkspaceSyncPayload } from "../types/events";
import { presenceJoin, presenceLeave, presenceUpdateCursor } from "./presence";
import { runExclusive } from "./lock";
import { isEditId, isObjectId, isValidContent, isValidCursor } from "../utils/validation";

type Ack = (response: unknown) => void;

/** How many applied edit ids each workspace remembers for resolving lost acks. */
const RECENT_EDITS_KEPT = 20;

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

async function buildSync(
  workspace: WorkspaceDocument,
  pendingEditId: string | null = null
): Promise<WorkspaceSyncPayload> {
  const activity = await ActivityLog.find({ workspaceId: workspace._id })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<ActivityLogDocument[]>();

  return {
    workspaceId: workspace.id,
    content: workspace.content,
    version: workspace.version,
    updatedAt: workspace.updatedAt.toISOString(),
    ...(pendingEditId
      ? {
          pendingEditId,
          pendingEditApplied: (workspace.recentEdits ?? []).some((e) => e.editId === pendingEditId)
        }
      : {}),
    activity: activity.map(serializeActivity)
  };
}

export default function workspaceSocket(io: Server, socket: Socket) {
  socket.data.userId = socket.user.id;

  safeHandler(socket, "workspace:join", async (payload) => {
    const workspaceId = readWorkspaceId(payload);
    if (!workspaceId) return;
    const rawPending = (payload as { pendingEditId?: unknown }).pendingEditId;
    const pendingEditId = isEditId(rawPending) ? rawPending : null;

    // Queued behind any edit already received for this workspace, so the sync
    // below reflects it (and pendingEditApplied is accurate).
    await runExclusive(workspaceId, async () => {
      if (!socket.connected) return;

      const workspace = await Workspace.findById(workspaceId);
      if (!workspace || !isWorkspaceMember(socket.user.id, workspace)) {
        socket.emit("workspace:removed", { workspaceId });
        return;
      }
      // The socket may have gone away while we were querying.
      if (!socket.connected) return;

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

      socket.emit("workspace:sync", await buildSync(workspace, pendingEditId));
    });
  });

  safeHandler(socket, "workspace:update", async (payload, ack) => {
    const workspaceId = readWorkspaceId(payload);
    const { content, version, editId } = (payload ?? {}) as {
      content?: unknown;
      version?: unknown;
      editId?: unknown;
    };
    if (
      !workspaceId ||
      !isValidContent(content) ||
      !Number.isInteger(version) ||
      (editId !== undefined && !isEditId(editId))
    ) {
      ack?.({ ok: false, reason: "invalid" } satisfies UpdateAck);
      return;
    }

    const userId = socket.user.id;
    const baseVersion = version as number;

    const applied = await runExclusive(workspaceId, async () => {
      // Atomic compare-and-set: only applies if the client edited the latest
      // version AND is still a member. Two concurrent writers cannot both win,
      // even across several server instances.
      const updated = await Workspace.findOneAndUpdate(
        {
          _id: workspaceId,
          version: baseVersion,
          $or: [{ ownerId: userId }, { members: userId }]
        },
        {
          $set: { content },
          $inc: { version: 1 },
          ...(editId
            ? {
                $push: {
                  recentEdits: {
                    $each: [{ editId, version: baseVersion + 1 }],
                    $slice: -RECENT_EDITS_KEPT
                  }
                }
              }
            : {})
        },
        { new: true }
      );

      if (!updated) {
        const current = await Workspace.findById(workspaceId);
        if (!current || !isWorkspaceMember(userId, current)) {
          ack?.({ ok: false, reason: "forbidden" } satisfies UpdateAck);
          return null;
        }
        // Stale version: hand back the latest state so the client can rebase.
        if (ack) {
          ack({
            ok: false,
            reason: "conflict",
            content: current.content,
            version: current.version
          } satisfies UpdateAck);
        } else {
          socket.emit("workspace:sync", await buildSync(current));
        }
        return null;
      }

      ack?.({ ok: true, version: updated.version } satisfies UpdateAck);

      // The sender already has this content; only others need it.
      socket.to(workspaceId).emit("workspace:update", {
        workspaceId,
        content: updated.content,
        version: updated.version,
        userId
      });
      return updated;
    });

    if (applied && shouldLogEdit(workspaceId, userId)) {
      await logActivity({
        workspaceId: applied._id,
        userId,
        action: "workspace:updated",
        metadata: { version: applied.version }
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
