export type Cursor = { x: number; y: number };

export type PresenceUser = {
  id: string;
  name: string;
  color?: string;
  cursor?: Cursor | null;
};

// workspaceId -> socketId -> user. One user may have several tabs (sockets).
const presenceByWorkspace = new Map<string, Map<string, PresenceUser>>();

/** One entry per user, even if they have several sockets in the room. */
function uniqueUsers(room: Map<string, PresenceUser>): PresenceUser[] {
  const byUser = new Map<string, PresenceUser>();
  for (const user of room.values()) {
    const existing = byUser.get(user.id);
    // Prefer an entry that has a live cursor.
    if (!existing || (!existing.cursor && user.cursor)) {
      byUser.set(user.id, { ...user });
    }
  }
  return Array.from(byUser.values());
}

export function presenceJoin(workspaceId: string, socketId: string, user: PresenceUser) {
  const room = presenceByWorkspace.get(workspaceId) ?? new Map<string, PresenceUser>();
  room.set(socketId, { ...user });
  presenceByWorkspace.set(workspaceId, room);
  return uniqueUsers(room);
}

export function presenceLeave(workspaceId: string, socketId: string) {
  const room = presenceByWorkspace.get(workspaceId);
  if (!room) return [];
  room.delete(socketId);
  if (room.size === 0) {
    presenceByWorkspace.delete(workspaceId);
    return [];
  }
  return uniqueUsers(room);
}

export function presenceList(workspaceId: string) {
  const room = presenceByWorkspace.get(workspaceId);
  return room ? uniqueUsers(room) : [];
}

export function presenceUpdateCursor(workspaceId: string, socketId: string, cursor: Cursor | null) {
  const user = presenceByWorkspace.get(workspaceId)?.get(socketId);
  if (user) user.cursor = cursor;
}

/** Test helper. */
export function presenceReset() {
  presenceByWorkspace.clear();
}
