export interface WorkspaceJoinPayload {
  workspaceId: string;
  /** An edit this client sent but never got an ack for (e.g. the connection dropped). */
  pendingEditId?: string | null;
}

export interface WorkspaceUpdatePayload {
  workspaceId: string;
  content: string;
  /** The version the client's text is based on. */
  version: number;
  /** Client-generated id, recorded so a lost ack can be resolved later. */
  editId?: string;
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
  /** Echo of the join's pendingEditId, with whether that edit was applied. */
  pendingEditId?: string;
  pendingEditApplied?: boolean;
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
