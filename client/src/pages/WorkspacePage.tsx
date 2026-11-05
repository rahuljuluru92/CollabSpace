import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ActivityLog, PresenceUser, WorkspaceSummary } from "../types";
import { createSocket, type UpdateAck } from "../lib/socket";
import { inviteMember } from "../lib/api";
import { merge, transformIndex } from "../lib/textMerge";
import { usePresence } from "../hooks/usePresence";

type Props = {
  token: string;
  workspace: WorkspaceSummary;
  onBack: () => void;
};

// Wait for a short pause in typing before sending, instead of one write per keystroke.
const SEND_DEBOUNCE_MS = 150;
const ACK_TIMEOUT_MS = 10_000;

export default function WorkspacePage({ token, workspace, onBack }: Props) {
  const [content, setContent] = useState(workspace.content ?? "");
  const [version, setVersion] = useState(workspace.version ?? 1);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
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

  // Sync state lives in refs so socket callbacks always see the latest values
  // (React state captured in closures would be stale).
  const socketRef = useRef<Socket | null>(null);
  const localRef = useRef(workspace.content ?? ""); // what the user sees
  const baseRef = useRef(workspace.content ?? ""); // last content confirmed by the server
  const versionRef = useRef(workspace.version ?? 1); // server version of baseRef
  const inFlightRef = useRef(false);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  usePresence(socket, workspace.id, containerRef);

  const connectionLabel = useMemo(() => {
    if (status === "connected") return dirty ? "Syncing..." : "Live";
    if (status === "connecting") return "Reconnecting...";
    return "Offline";
  }, [status, dirty]);

  /** Replace the visible text while keeping the user's caret where it belongs. */
  const setLocal = useCallback((next: string, remap?: (i: number) => number) => {
    const el = textareaRef.current;
    if (el && remap && document.activeElement === el) {
      pendingSelectionRef.current = {
        start: remap(el.selectionStart),
        end: remap(el.selectionEnd)
      };
    }
    localRef.current = next;
    setContent(next);
  }, []);

  useLayoutEffect(() => {
    const sel = pendingSelectionRef.current;
    const el = textareaRef.current;
    if (sel && el) {
      el.setSelectionRange(sel.start, sel.end);
      pendingSelectionRef.current = null;
    }
  }, [content]);

  const flush = useCallback(() => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    const socket = socketRef.current;
    if (!socket?.connected || inFlightRef.current) return;

    const sent = localRef.current;
    if (sent === baseRef.current) {
      setDirty(false);
      return;
    }

    inFlightRef.current = true;
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(
        "workspace:update",
        { workspaceId: workspace.id, content: sent, version: versionRef.current },
        (err: Error | null, ack?: UpdateAck) => {
          inFlightRef.current = false;
          if (err || !ack) {
            // No answer (timeout/disconnect). The reconnect sync will rebase and resend.
            return;
          }
          if (ack.ok) {
            baseRef.current = sent;
            versionRef.current = ack.version;
            setVersion(ack.version);
            setError(null);
          } else if (ack.reason === "conflict") {
            applyServer(ack.content, ack.version);
          } else if (ack.reason === "forbidden") {
            setError("You no longer have access to this workspace.");
            return;
          } else if (ack.reason === "invalid") {
            setError("This change could not be saved (the document may be too large).");
            return;
          } else {
            setError("The server could not save your change. Retrying...");
          }
          // Send anything typed while this request was in flight.
          if (localRef.current !== baseRef.current) scheduleSend();
          else setDirty(false);
        }
      );
  }, [workspace.id]);

  const scheduleSend = useCallback(() => {
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(flush, SEND_DEBOUNCE_MS);
  }, [flush]);

  /**
   * Adopt a newer server state. Unsent local edits are rebased on top of it
   * rather than thrown away.
   */
  const applyServer = useCallback(
    (serverContent: string, serverVersion: number) => {
      if (serverVersion < versionRef.current) return; // stale message

      const local = localRef.current;
      const base = baseRef.current;
      if (local === base) {
        const { remoteSplice } = merge(local, local, serverContent);
        setLocal(serverContent, (i) => transformIndex(i, remoteSplice));
      } else {
        const merged = merge(base, local, serverContent);
        setLocal(merged.text, (i) => transformIndex(i, merged.remoteSplice));
      }

      baseRef.current = serverContent;
      versionRef.current = serverVersion;
      setVersion(serverVersion);

      if (localRef.current !== baseRef.current) {
        setDirty(true);
        scheduleSend();
      } else {
        setDirty(false);
      }
    },
    [scheduleSend, setLocal]
  );

  useEffect(() => {
    const socket = createSocket(token);
    socketRef.current = socket;
    setSocket(socket);

    socket.on("connect", () => {
      setStatus("connected");
      setError(null);
      // The server replies with workspace:sync, which rebases and resends any offline edits.
      socket.emit("workspace:join", { workspaceId: workspace.id });
    });

    socket.on("disconnect", () => {
      inFlightRef.current = false;
      setStatus("disconnected");
    });

    socket.io.on("reconnect_attempt", () => setStatus("connecting"));

    socket.on("connect_error", (err) => {
      setError(err.message);
      setStatus("disconnected");
    });

    socket.on("workspace:sync", (payload) => {
      if (payload.workspaceId !== workspace.id) return;
      setActivity(payload.activity ?? []);
      applyServer(payload.content, payload.version);
    });

    socket.on("workspace:update", (payload) => {
      if (payload.workspaceId !== workspace.id) return;
      applyServer(payload.content, payload.version);
    });

    socket.on("workspace:removed", (payload) => {
      if (payload.workspaceId !== workspace.id) return;
      window.alert("This workspace was deleted or you were removed from it.");
      onBackRef.current();
    });

    socket.on("presence:update", (payload) => {
      if (payload.workspaceId !== workspace.id) return;
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
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      // Best effort: push any unsent text before leaving.
      if (socket.connected && !inFlightRef.current && localRef.current !== baseRef.current) {
        socket.emit("workspace:update", {
          workspaceId: workspace.id,
          content: localRef.current,
          version: versionRef.current
        });
      }
      socket.emit("workspace:leave", { workspaceId: workspace.id });
      socket.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [token, workspace.id, applyServer]);

  function handleChange(value: string) {
    localRef.current = value;
    setContent(value);
    setDirty(true);
    scheduleSend();
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteStatus(null);
    try {
      const result = await inviteMember(token, workspace.id, inviteEmail.trim());
      setInviteStatus(
        result.added
          ? `Added ${result.member.name} (${result.member.email})`
          : `${result.member.email} is already a member`
      );
      setInviteEmail("");
    } catch (err) {
      setInviteStatus((err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen px-6 py-8 lg:px-16" ref={containerRef}>
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <button
            className="text-sm uppercase tracking-[0.3em] text-neon mb-2"
            onClick={onBack}
          >
            Back to dashboard
          </button>
          <h1 className="text-3xl font-display font-semibold text-fog">
            {workspace.name}
          </h1>
          <p className="text-fog/60">Workspace version {version}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.3em] text-fog/60">
            {connectionLabel}
          </span>
          <span
            className={`h-2.5 w-2.5 rounded-full ${status === "connected"
              ? "bg-lime"
              : status === "connecting"
                ? "bg-neon"
                : "bg-coral"
              }`}
          ></span>
        </div>
      </header>

      <section className="mt-8 grid lg:grid-cols-[1.6fr_0.8fr] gap-8">
        {/* Render Remote Cursors */}
        {presence
          .filter((p) => p.cursor) // Filter users who have a cursor position
          .map((user) => (
            user.cursor && (
              <div
                key={user.id}
                className="pointer-events-none absolute z-50 flex items-center gap-2 transition-all duration-100 ease-linear"
                style={{
                  left: user.cursor.x,
                  top: user.cursor.y,
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={user.color || "#22d3ee"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="drop-shadow-md"
                >
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
                <span
                  className="px-2 py-1 rounded-md text-xs font-bold text-ink"
                  style={{ backgroundColor: user.color || "#22d3ee" }}
                >
                  {user.name}
                </span>
              </div>
            )
          ))}

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg text-fog">Live Editor</h2>
            <span className="text-xs text-fog/60">
              {dirty ? "Pending sync" : "All changes saved"}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            className="w-full min-h-[420px] bg-ink/60 border border-white/10 rounded-xl p-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
            value={content}
            onChange={(event) => handleChange(event.target.value)}
          />
          {error && <p className="mt-3 text-sm text-coral">{error}</p>}
        </div>

        <div className="grid gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Presence</h2>
            <div className="mt-4 grid gap-2 text-sm text-fog/70">
              {presence.length === 0 && <p>No one else is here yet.</p>}
              {presence.map((user) => (
                <div key={user.id} className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-neon"></span>
                  {user.name}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Invite Collaborator</h2>
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
              {inviteStatus && <p className="text-sm text-fog/70">{inviteStatus}</p>}
            </form>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-display text-lg text-fog">Activity Log</h2>
            <div className="mt-4 grid gap-3 text-sm text-fog/70 max-h-[240px] overflow-y-auto pr-2">
              {activity.length === 0 && <p>Log entries appear as the team collaborates.</p>}
              {activity.map((item) => (
                <div key={item.id} className="border-b border-white/10 pb-2">
                  <p className="text-fog/80">{item.action}</p>
                  <p className="text-xs text-fog/50">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
