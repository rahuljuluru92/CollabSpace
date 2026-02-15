export interface WorkspaceJoinPayload {
  workspaceId: string;
}

export interface WorkspaceUpdatePayload {
  workspaceId: string;
  content: string;
  version: number;
}

export interface CursorPayload {
  workspaceId: string;
  cursor: {
    x: number;
    y: number;
  };
}

export interface TypingPayload {
  workspaceId: string;
  typing: boolean;
}

export interface AuthPayload {
  token: string;
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
