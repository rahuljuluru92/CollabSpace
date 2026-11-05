export type User = {
  id: string;
  name: string;
  email: string;
};

/** Dashboard entry. */
export type WorkspaceSummary = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  /** First few hundred characters of the document. */
  preview: string;
  version: number;
  updatedAt: string;
};

/** Full workspace, as returned by GET /api/workspaces/:id. */
export type Workspace = Omit<WorkspaceSummary, "preview"> & {
  content: string;
};

export type ActivityLog = {
  id: string;
  action: string;
  userId: string;
  userName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PresenceUser = {
  id: string;
  name: string;
  color?: string;
  cursor?: { x: number; y: number } | null;
};
