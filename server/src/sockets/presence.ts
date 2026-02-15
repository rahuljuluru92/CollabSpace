export type PresenceUser = {
  id: string;
  name: string;
  color?: string;
  cursor?: { x: number; y: number } | null;
};

const presenceByWorkspace = new Map<string, Map<string, PresenceUser>>();

export function presenceJoin(workspaceId: string, socketId: string, user: PresenceUser) {
  const room = presenceByWorkspace.get(workspaceId) ?? new Map<string, PresenceUser>();
  room.set(socketId, user);
  presenceByWorkspace.set(workspaceId, room);
  return Array.from(room.values());
}

export function presenceLeave(workspaceId: string, socketId: string) {
  const room = presenceByWorkspace.get(workspaceId);
  if (!room) return [];
  room.delete(socketId);
  if (room.size === 0) {
    presenceByWorkspace.delete(workspaceId);
    return [];
  }
  return Array.from(room.values());
}

export function presenceList(workspaceId: string) {
  const room = presenceByWorkspace.get(workspaceId);
  if (!room) return [];
  return Array.from(room.values());
}

export function presenceUpdateCursor(workspaceId: string, socketId: string, cursor: { x: number; y: number } | null) {
  const room = presenceByWorkspace.get(workspaceId);
  if (!room) return;

  const user = room.get(socketId);
  if (!user) return;

  user.cursor = cursor;
  // We modify the object by reference, so it's updated in the map.
}
