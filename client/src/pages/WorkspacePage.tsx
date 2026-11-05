import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ActivityLog, PresenceUser, User, Workspace } from "../types";
import { createSocket } from "../lib/socket";
import { ApiError, fetchActivity, fetchWorkspace, inviteMember } from "../lib/api";
import { DocSync, type UpdateAck } from "../lib/docSync";
import { describeActivity, mergeActivity } from "../lib/activity";
import { usePresence } from "../hooks/usePresence";

type Props = {
  token: string;
  user: User;
  workspaceId: string;
  onBack: () => void;
  onSessionExpired: () => void;
};

const ACK_TIMEOUT_MS = 10_000;
/** Mirrors the server's content limit (characters). */
const MAX_CONTENT_LENGTH = 200_000;

export default function WorkspacePage({
  token,
  user,
  workspaceId,
  onBack,
  onSessionExpired
}: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [content, setContent] = useState("");
  const [version, setVersion] = useState(0);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("connecting");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const syncRef = useRef<DocSync | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // Latest callbacks, for socket handlers that outlive a render.
  const onBackRef = useRef(onBack);
  const onSessionExpiredRef = useRef(onSessionExpired);
  useLayoutEffect(() => {
    onBackRef.current = onBack;
    onSessionExpiredRef.current = onSessionExpired;
  });

  const loaded = workspace !== null;
  const workspaceName = workspace?.name;
  const isOwner = workspace?.ownerId === user.id;

  usePresence(socket, workspaceId, containerRef);

  const connectionLabel = useMemo(() => {
    if (status === "connected") return !synced ? "Loading..." : dirty ? "Syncing..." : "Live";
    if (status === "connecting") return "Reconnecting...";
    return "Offline";
  }, [status, dirty, synced]);

  // Load the workspace's details (and check access) before connecting.
  useEffect(() => {
    let cancelled = false;
    fetchWorkspace(token, workspaceId)
      .then(({ workspace }) => {
        if (!cancelled) setWorkspace(workspace);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          onSessionExpiredRef.current();
        } else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setLoadError("This workspace doesn't exist, or you don't have access to it.");
        } else {
          setLoadError(err instanceof Error ? err.message : "Could not load this workspace.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, workspaceId]);

  useEffect(() => {
    if (!workspaceName) return;
    const previous = document.title;
    document.title = `${workspaceName} · SyncSpace`;
    return () => {
      document.title = previous;
    };
  }, [workspaceName]);

  // After a remote change replaces the text, put the caret back where it belongs.
  useLayoutEffect(() => {
    const sel = pendingSelectionRef.current;
    const el = textareaRef.current;
    if (sel && el) {
      el.setSelectionRange(sel.start, sel.end);
      pendingSelectionRef.current = null;
    }
  }, [content]);

  // Warn before closing the tab while changes are still unsynced.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!loaded) return;
    const socket = createSocket(token);

    // The editor stays read-only until the first sync delivers the text.
    const sync = new DocSync(
      { content: "", version: 0 },
      {
        isConnected: () => socket.connected,
        sendEdit: (edit, done) => {
          socket
            .timeout(ACK_TIMEOUT_MS)
            .emit(
              "workspace:update",
              { workspaceId, ...edit },
              (err: Error | null, ack?: UpdateAck) => done(err, ack)
            );
        },
        join: (pendingEditId) => {
          socket.emit("workspace:join", { workspaceId, pendingEditId });
        },
        reconnect: () => {
          socket.disconnect();
          socket.connect();
        }
      },
      {
        onRemoteText: (text, remap) => {
          const el = textareaRef.current;
          if (el && document.activeElement === el) {
            pendingSelectionRef.current = {
              start: remap(el.selectionStart),
              end: remap(el.selectionEnd)
            };
          }
          setContent(text);
        },
        onVersion: setVersion,
        onDirty: setDirty,
        onError: setError
      }
    );
    syncRef.current = sync;

    socket.on("connect", () => {
      setSocket(socket); // lets the presence hook emit cursor moves on this connection
      setStatus("connected");
      setError(null);
      sync.connected();
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
      sync.disconnected();
    });

    socket.io.on("reconnect_attempt", () => setStatus("connecting"));

    socket.on("connect_error", (err) => {
      if (err.message === "INVALID_TOKEN" || err.message === "NO_TOKEN") {
        onSessionExpiredRef.current();
        return;
      }
      setError("Can't reach the server. Retrying...");
      setStatus("disconnected");
    });

    socket.on("workspace:sync", (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      setActivity(payload.activity ?? []);
      setActivityCursor(payload.activityCursor ?? null);
      sync.sync(payload);
      setSynced(true);
    });

    socket.on("workspace:update", (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      sync.remoteUpdate(payload.content, payload.version);
    });

    socket.on("activity:new", (payload: { workspaceId: string; activity: ActivityLog }) => {
      if (payload.workspaceId !== workspaceId) return;
      setActivity((prev) => mergeActivity(prev, [payload.activity], "start"));
    });

    socket.on("workspace:removed", (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      sync.dispose();
      window.alert("This workspace was deleted or you no longer have access to it.");
      onBackRef.current();
    });

    socket.on("presence:update", (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      setPresence((prev) =>
        payload.users.map((u: PresenceUser) => ({
          ...u,
          cursor: prev.find((p) => p.id === u.id)?.cursor ?? u.cursor ?? null
        }))
      );
    });

    socket.on("cursor:update", ({ userId, cursor }) => {
      setPresence((prev) => prev.map((u) => (u.id === userId ? { ...u, cursor } : u)));
    });

    socket.connect();

    return () => {
      // Best effort: push any unsent text before leaving.
      sync.flushNow();
      sync.dispose();
      socket.emit("workspace:leave", { workspaceId });
      socket.disconnect();
      syncRef.current = null;
    };
  }, [token, workspaceId, loaded]);

  function handleChange(value: string) {
    setContent(value);
    syncRef.current?.localChange(value);
  }

  function handleBack() {
    const sync = syncRef.current;
    if (sync?.hasUnsavedChanges) {
      sync.flushNow();
      if (!window.confirm("Some of your changes haven't synced yet. Leave anyway?")) return;
    }
    onBack();
  }

  async function loadOlderActivity() {
    if (!activityCursor) return;
    setLoadingOlder(true);
    try {
      const page = await fetchActivity(token, workspaceId, activityCursor);
      setActivity((prev) => mergeActivity(prev, page.activity, "end"));
      setActivityCursor(page.nextCursor);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
      else setError((err as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteStatus(null);
    try {
      const result = await inviteMember(token, workspaceId, inviteEmail.trim());
      setInviteStatus(
        result.added
          ? `Added ${result.member.name} (${result.member.email})`
          : `${result.member.email} is already a member`
      );
      setInviteEmail("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
      else setInviteStatus((err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div
          role="alert"
          className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 text-center"
        >
          <h1 className="text-2xl font-display font-semibold text-fog">Workspace unavailable</h1>
          <p className="mt-3 text-fog/70">{loadError}</p>
          <button
            type="button"
            className="mt-6 h-11 px-6 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
            onClick={onBack}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen grid place-items-center text-fog/70" aria-live="polite">
        Loading workspace...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen px-6 py-8 lg:px-16" ref={containerRef}>
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <button
            type="button"
            className="text-sm uppercase tracking-[0.3em] text-neon mb-2"
            onClick={handleBack}
          >
            Back to dashboard
          </button>
          <h1 className="text-3xl font-display font-semibold text-fog">{workspace.name}</h1>
          <p className="text-fog/60">Workspace version {synced ? version : "..."}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs uppercase tracking-[0.3em] text-fog/60"
            role="status"
            aria-live="polite"
          >
            {connectionLabel}
          </span>
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${
              status === "connected" ? "bg-lime" : status === "connecting" ? "bg-neon" : "bg-coral"
            }`}
          ></span>
        </div>
      </header>

      {/* Remote cursors, positioned relative to the page container */}
      {presence
        .filter((p) => p.cursor && p.id !== user.id)
        .map(
          (other) =>
            other.cursor && (
              <div
                key={other.id}
                aria-hidden="true"
                className="pointer-events-none absolute z-50 flex items-center gap-2 transition-all duration-100 ease-linear"
                style={{
                  left: other.cursor.x,
                  top: other.cursor.y
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={other.color || "#22d3ee"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="drop-shadow-md"
                >
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
                <span
                  className="px-2 py-1 rounded-md text-xs font-bold text-ink"
                  style={{ backgroundColor: other.color || "#22d3ee" }}
                >
                  {other.name}
                </span>
              </div>
            )
        )}

      <section className="mt-8 grid lg:grid-cols-[1.6fr_0.8fr] gap-8">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg text-fog">Live Editor</h2>
            <span className="text-xs text-fog/60">
              {!synced ? "Loading..." : dirty ? "Pending sync" : "All changes saved"}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            aria-label="Document"
            aria-busy={!synced}
            readOnly={!synced}
            placeholder={synced ? "Start typing..." : "Loading..."}
            maxLength={MAX_CONTENT_LENGTH}
            className="w-full min-h-[420px] bg-ink/60 border border-white/10 rounded-xl p-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
            value={content}
            onChange={(event) => handleChange(event.target.value)}
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-coral">
              {error}
            </p>
          )}
        </div>

        <div className="grid gap-6 content-start">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Presence</h2>
            <ul className="mt-4 grid gap-2 text-sm text-fog/70" aria-label="People here now">
              {presence.length === 0 && <li>No one else is here yet.</li>}
              {presence.map((person) => (
                <li key={person.id} className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-neon" aria-hidden="true"></span>
                  {person.name}
                  {person.id === user.id && <span className="text-fog/40">(you)</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Invite Collaborator</h2>
            {isOwner ? (
              <form className="mt-4 grid gap-3" onSubmit={handleInvite}>
                <label className="grid gap-2 text-sm text-fog/80">
                  Email
                  <input
                    type="email"
                    className="h-11 rounded-lg bg-white/10 border border-white/10 px-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    required
                  />
                </label>
                <button
                  className="h-11 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
                  disabled={inviteLoading}
                  type="submit"
                >
                  {inviteLoading ? "Inviting..." : "Invite"}
                </button>
                {inviteStatus && (
                  <p className="text-sm text-fog/70" role="status">
                    {inviteStatus}
                  </p>
                )}
              </form>
            ) : (
              <p className="mt-4 text-sm text-fog/60">
                Only the workspace owner can invite collaborators.
              </p>
            )}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Activity Log</h2>
            <ul
              className="mt-4 grid gap-3 text-sm text-fog/70 max-h-[240px] overflow-y-auto pr-2"
              aria-label="Activity"
            >
              {activity.length === 0 && <li>Log entries appear as the team collaborates.</li>}
              {activity.map((item) => (
                <li key={item.id} className="border-b border-white/10 pb-2">
                  <p className="text-fog/80">{describeActivity(item)}</p>
                  <p className="text-xs text-fog/50">{new Date(item.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
            {activityCursor && (
              <button
                type="button"
                className="mt-3 text-xs uppercase tracking-[0.2em] text-neon disabled:opacity-50"
                onClick={loadOlderActivity}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Loading..." : "Load older"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
