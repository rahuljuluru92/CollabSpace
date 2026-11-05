export interface WorkspaceJoinPayload {
  workspaceId: string;
}

export interface WorkspaceUpdatePayload {
  workspaceId: string;
  content: string;
  version: number;
}

/** Acknowledgement sent back to the client for every workspace:update. */
export type UpdateAck =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; content: string; version: number }
  | { ok: false; reason: "invalid" | "forbidden" | "error" };

export interface CursorPayload {
  workspaceId: string;
  cursor: { x: number; y: number } | null;
}

export interface WorkspaceSyncPayload {
  workspaceId: string;
  content: string;
  version: number;
  updatedAt: string;
  activity: {
    id: string;
    action: string;
    userId: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }[];
}

export interface PresenceUpdatePayload {
  workspaceId: string;
  users: { id: string; name: string }[];
}
