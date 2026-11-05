import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, createWorkspace, deleteWorkspace, fetchWorkspaces } from "../lib/api";
import type { WorkspaceSummary, User } from "../types";

type Props = {
  token: string;
  user: User;
  onOpen: (workspaceId: string) => void;
  /** Also called when the server says the session has expired. */
  onLogout: () => void;
};

export default function DashboardPage({ token, user, onOpen, onLogout }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Mounted whenever the dashboard is shown, so it starts out loading.
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const onLogoutRef = useRef(onLogout);
  useLayoutEffect(() => {
    onLogoutRef.current = onLogout;
  });

  /** Expired session: sign out. Otherwise returns a message to show. */
  function describeError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      onLogoutRef.current();
      return null;
    }
    return err instanceof Error ? err.message : "Something went wrong";
  }

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaces(token)
      .then((data) => {
        if (cancelled) return;
        setWorkspaces(data.workspaces);
        setNextCursor(data.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) onLogoutRef.current();
        else setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkspaces(token);
      setWorkspaces(data.workspaces);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchWorkspaces(token, nextCursor);
      setWorkspaces((prev) => {
        const seen = new Set(prev.map((w) => w.id));
        return [...prev, ...data.workspaces.filter((w) => !seen.has(w.id))];
      });
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const data = await createWorkspace(token, name.trim());
      onOpen(data.workspace.id);
    } catch (err) {
      setCreateError(describeError(err));
      setCreating(false);
    }
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
      await deleteWorkspace(token, workspace.id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== workspace.id));
    } catch (err) {
      const message = describeError(err);
      if (message) window.alert(`Failed to ${action} workspace: ${message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10 lg:px-16">
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-neon font-medium">SyncSpace</p>
          <h1 className="mt-2 text-3xl font-display font-semibold text-fog">
            Welcome, {user.name}
          </h1>
          <p className="text-fog/70">Pick a workspace or spin up a new one.</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <span className="text-xs uppercase tracking-[0.3em] text-neon" aria-live="polite">
              Loading...
            </span>
          )}
          <button
            type="button"
            className="h-10 px-4 rounded-lg border border-white/10 text-fog/80 hover:text-fog hover:border-neon/40"
            onClick={refresh}
          >
            Refresh
          </button>
          <button
            type="button"
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
          {error && (
            <p role="alert" className="mt-3 text-sm text-coral">
              {error}
            </p>
          )}
          <div className="mt-4 grid gap-3">
            {!loading && !error && workspaces.length === 0 && (
              <p className="text-sm text-fog/60">
                No workspaces yet. Create one to start collaborating.
              </p>
            )}
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${workspace.name}`}
                onClick={() => onOpen(workspace.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(workspace.id);
                  }
                }}
                className="cursor-pointer group w-full text-left p-4 rounded-xl border border-white/10 hover:border-neon/50 hover:bg-white/5 transition relative"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-fog">{workspace.name}</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-fog/50">v{workspace.version}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(workspace, e)}
                      disabled={deletingId === workspace.id}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-md hover:bg-coral/20 text-coral/70 hover:text-coral transition-all"
                      title={workspace.ownerId === user.id ? "Delete Workspace" : "Leave Workspace"}
                      aria-label={
                        workspace.ownerId === user.id
                          ? `Delete ${workspace.name}`
                          : `Leave ${workspace.name}`
                      }
                    >
                      {deletingId === workspace.id ? (
                        <span className="block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-fog/60 mt-2 line-clamp-2">
                  {workspace.preview || "No content yet"}
                </p>
                <p className="text-xs text-fog/40 mt-3">
                  Updated {new Date(workspace.updatedAt).toLocaleString()}
                </p>
              </div>
            ))}
            {nextCursor !== null && (
              <button
                type="button"
                className="h-10 rounded-lg border border-white/10 text-fog/80 hover:text-fog hover:border-neon/40"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
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
                maxLength={120}
                required
              />
            </label>
            <button
              className="h-11 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
              disabled={creating}
              type="submit"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            {createError && <p className="text-sm text-coral">{createError}</p>}
          </form>
        </div>
      </section>
    </div>
  );
}
