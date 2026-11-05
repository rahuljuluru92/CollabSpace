import type { Server } from "socket.io";
import { presenceLeave } from "./presence";

// Lets REST controllers notify connected clients (e.g. on delete/leave).
let ioInstance: Server | null = null;

export function setIo(io: Server) {
  ioInstance = io;
}

export function getIo(): Server | null {
  return ioInstance;
}

/**
 * Removes sockets from a workspace room (all of them, or only one user's),
 * tells them why, and refreshes presence for whoever remains.
 */
export async function evictFromWorkspace(workspaceId: string, userId?: string) {
  const io = getIo();
  if (!io) return;
  const sockets = await io.in(workspaceId).fetchSockets();
  let users = null;
  for (const s of sockets) {
    if (userId && s.data.userId !== userId) continue;
    s.emit("workspace:removed", { workspaceId });
    s.leave(workspaceId);
    users = presenceLeave(workspaceId, s.id);
  }
  if (users) {
    io.to(workspaceId).emit("presence:update", { workspaceId, users });
  }
}
