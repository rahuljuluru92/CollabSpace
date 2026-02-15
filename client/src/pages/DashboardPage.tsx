import { useState } from "react";
import { deleteWorkspace } from "../lib/api";
import type { WorkspaceSummary, User } from "../types";

type Props = {
  user: User;
  workspaces: WorkspaceSummary[];
  onCreate: (name: string) => Promise<void>;
  onOpen: (workspaceId: string) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
};

export default function DashboardPage({
  user,
  workspaces,
  onCreate,
  onOpen,
  onRefresh,
  onLogout
}: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    await onCreate(name.trim());
    setName("");
    setLoading(false);
  }

  async function handleDelete(workspace: WorkspaceSummary, event: React.MouseEvent) {
    event.stopPropagation(); // Prevent opening the workspace
    const isOwner = workspace.ownerId === user.id;
    const action = isOwner ? "permanently delete" : "leave";

    if (!window.confirm(`Are you sure you want to ${action} "${workspace.name}"?`)) {
      return;
    }

    setDeletingId(workspace.id);
    try {
      // Assuming token is stored in localStorage by lib/storage.ts or passed down.
      // Since DashboardPage doesn't receive token directly in props but App.tsx has it, 
      // we might need to modify App.tsx to pass a handleDelete prop OR use the token from storage.
      // Analyzing App.tsx again... App.tsx has the token. It should pass a handleDelete callback.
      // Wait, let's fix the props structure in the next step or assume we can get token from storage.
      // Actually, looking at imports, `loadSession` from `../lib/storage` can retrieve the token.

      const session = JSON.parse(localStorage.getItem("syncspace_session") || "{}");
      if (session.token) {
        await deleteWorkspace(session.token, workspace.id);
        await onRefresh();
      }
    } catch (err) {
      alert("Failed to delete workspace: " + (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10 lg:px-16">
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-neon font-medium">
            SyncSpace
          </p>
          <h1 className="mt-2 text-3xl font-display font-semibold text-fog">
            Welcome, {user.name}
          </h1>
          <p className="text-fog/70">Pick a workspace or spin up a new one.</p>
        </div>
        <div className="flex gap-3">
          <button
            className="h-10 px-4 rounded-lg border border-white/10 text-fog/80 hover:text-fog hover:border-neon/40"
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            className="h-10 px-4 rounded-lg bg-white/10 text-fog hover:bg-white/15"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="mt-10 grid lg:grid-cols-[1fr_320px] gap-8">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-display font-semibold text-fog">Your Workspaces</h2>
          <div className="mt-4 grid gap-3">
            {workspaces.length === 0 && (
              <p className="text-sm text-fog/60">
                No workspaces yet. Create one to start collaborating.
              </p>
            )}
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => onOpen(workspace.id)}
                className="group w-full text-left p-4 rounded-xl border border-white/10 hover:border-neon/50 hover:bg-white/5 transition relative"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-fog">
                    {workspace.name}
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-fog/50">
                      v{workspace.version}
                    </span>
                    <button
                      onClick={(e) => handleDelete(workspace, e)}
                      disabled={deletingId === workspace.id}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-coral/20 text-coral/70 hover:text-coral transition-all"
                      title={workspace.ownerId === user.id ? "Delete Workspace" : "Leave Workspace"}
                    >
                      {deletingId === workspace.id ? (
                        <span className="block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-fog/60 mt-2 line-clamp-2">
                  {workspace.content || "No content yet"}
                </p>
                <p className="text-xs text-fog/40 mt-3">
                  Updated {new Date(workspace.updatedAt).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-display font-semibold text-fog">Create Workspace</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleCreate}>
            <label className="grid gap-2 text-sm text-fog/80">
              Workspace name
              <input
                className="h-11 rounded-lg bg-white/10 border border-white/10 px-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <button
              className="h-11 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
              disabled={loading}
              type="submit"
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
