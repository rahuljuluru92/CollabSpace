export type User = {
  id: string;
  name: string;
  email: string;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  content: string;
  version: number;
  updatedAt: string;
};

export type WorkspaceDetail = WorkspaceSummary & {
  activity: ActivityLog[];
};

export type ActivityLog = {
  id: string;
  action: string;
  userId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PresenceUser = {
  id: string;
  name: string;
  color?: string;
  cursor?: { x: number; y: number } | null;
};
