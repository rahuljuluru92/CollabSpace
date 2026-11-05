import { diff, merge, transformIndex } from "./textMerge";

/** Server's reply to a workspace:update. */
export type UpdateAck =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; content: string; version: number }
  | { ok: false; reason: "invalid" | "forbidden" | "error" };

/** The parts of a workspace:sync payload the sync engine needs. */
export type SyncState = {
  content: string;
  version: number;
  pendingEditId?: string;
  pendingEditApplied?: boolean;
};

export type OutgoingEdit = { editId: string; content: string; version: number };

export interface SyncTransport {
  isConnected(): boolean;
  /** Send one edit. `done` gets the server's ack, or an error if none arrived (timeout/disconnect). */
  sendEdit(edit: OutgoingEdit, done: (err: Error | null, ack?: UpdateAck) => void): void;
  /** Join the workspace on the current connection; the server answers with one workspace:sync. */
  join(pendingEditId: string | null): void;
  /** Drop and reopen the connection (used when the server stops answering). */
  reconnect(): void;
}

export interface SyncListener {
  /** Text changed because of the server. `remap` moves an old caret index into the new text. */
  onRemoteText(text: string, remap: (index: number) => number): void;
  onVersion(version: number): void;
  onDirty(dirty: boolean): void;
  onError(message: string | null): void;
}

export type DocSyncOptions = {
  /** Wait this long after the last keystroke before sending. */
  debounceMs?: number;
  /** Reconnect if no workspace:sync arrives this long after joining. */
  syncTimeoutMs?: number;
  createId?: () => string;
};

function defaultId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // randomUUID is missing outside secure contexts (plain http on a LAN IP).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const RECONNECTING = "Having trouble reaching the server. Reconnecting...";

/**
 * Client side of document syncing.
 *
 * - `base` is the latest text the server confirmed, at `version`.
 * - `local` is what the user sees: `base` plus edits not yet confirmed.
 * - At most one edit is in flight. Each edit carries an id; if its ack is
 *   lost (timeout or disconnect), the next join names that id and the server
 *   says whether it was applied, so the edit is neither lost nor applied twice.
 * - Server changes are merged into unsent local edits (see textMerge.ts).
 *
 * One join (and so one sync) per connection: when the server stops answering
 * we reconnect rather than join again, so a late reply can never be confused
 * with a newer one.
 */
export class DocSync {
  private local: string;
  private base: string;
  private version: number;
  private inFlight: OutgoingEdit | null = null;
  private awaitingSync = true;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly syncTimeoutMs: number;
  private readonly createId: () => string;

  constructor(
    initial: { content: string; version: number },
    private readonly transport: SyncTransport,
    private readonly listener: SyncListener,
    options: DocSyncOptions = {}
  ) {
    this.local = initial.content;
    this.base = initial.content;
    this.version = initial.version;
    this.debounceMs = options.debounceMs ?? 150;
    this.syncTimeoutMs = options.syncTimeoutMs ?? 10_000;
    this.createId = options.createId ?? defaultId;
  }

  get text() {
    return this.local;
  }

  get currentVersion() {
    return this.version;
  }

  /** True while there is text the server has not confirmed. */
  get hasUnsavedChanges() {
    return this.local !== this.base || this.inFlight !== null;
  }

  /** The user edited the text. */
  localChange(text: string) {
    if (this.disposed) return;
    this.local = text;
    this.listener.onDirty(true);
    this.scheduleSend();
  }

  /** The socket (re)connected. */
  connected() {
    if (this.disposed) return;
    this.awaitingSync = true;
    this.clearSendTimer();
    this.transport.join(this.inFlight?.editId ?? null);
    this.clearSyncTimer();
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (!this.disposed && this.awaitingSync && this.transport.isConnected()) {
        this.listener.onError(RECONNECTING);
        this.transport.reconnect();
      }
    }, this.syncTimeoutMs);
  }

  /** The socket disconnected. Nothing is sent until the next connection's sync. */
  disconnected() {
    this.awaitingSync = true;
    this.clearSendTimer();
    this.clearSyncTimer();
    // `inFlight` is kept on purpose: the next join asks the server about it.
  }

  /** Full state from the server: the reply to a join. */
  sync(state: SyncState) {
    if (this.disposed) return;
    this.clearSyncTimer();
    if (this.inFlight) {
      const landed =
        state.pendingEditId === this.inFlight.editId && state.pendingEditApplied === true;
      if (landed) {
        // The edit was applied before its ack got lost: the server text already contains it.
        this.base = this.inFlight.content;
        this.version = this.inFlight.version + 1;
      }
      this.inFlight = null;
    }
    this.awaitingSync = false;
    this.listener.onError(null);
    this.applyServer(state.content, state.version);
  }

  /** Another user's edit, broadcast by the server. */
  remoteUpdate(content: string, version: number) {
    // While waiting for a sync, the sync supersedes anything older.
    if (this.disposed || this.awaitingSync) return;
    this.applyServer(content, version);
  }

  /** Send unsent text immediately instead of waiting for the debounce (e.g. before leaving). */
  flushNow() {
    this.flush();
  }

  dispose() {
    this.disposed = true;
    this.clearSendTimer();
    this.clearSyncTimer();
  }

  private scheduleSend() {
    this.clearSendTimer();
    this.sendTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private clearSendTimer() {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private clearSyncTimer() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private flush() {
    this.clearSendTimer();
    if (this.disposed || this.inFlight || this.awaitingSync || !this.transport.isConnected()) {
      return;
    }
    if (this.local === this.base) {
      this.listener.onDirty(false);
      return;
    }
    const edit: OutgoingEdit = { editId: this.createId(), content: this.local, version: this.version };
    this.inFlight = edit;
    this.transport.sendEdit(edit, (err, ack) => this.handleAck(edit, err, ack));
  }

  private handleAck(edit: OutgoingEdit, err: Error | null, ack?: UpdateAck) {
    if (this.disposed || this.inFlight !== edit) return; // already resolved by a sync

    if (err || !ack || (!ack.ok && ack.reason === "error")) {
      // Outcome unknown. After a disconnect the reconnect's join resolves it;
      // if we are still connected, reconnect so that happens now.
      if (this.transport.isConnected()) {
        this.listener.onError(RECONNECTING);
        this.transport.reconnect();
      }
      return;
    }

    this.inFlight = null;
    if (ack.ok) {
      this.base = edit.content;
      this.version = ack.version;
      this.listener.onVersion(ack.version);
      this.listener.onError(null);
      this.afterServerChange();
    } else if (ack.reason === "conflict") {
      // Someone else's edit landed first: rebase onto it and try again.
      this.applyServer(ack.content, ack.version);
    } else {
      this.listener.onError(
        ack.reason === "forbidden"
          ? "You no longer have access to this workspace."
          : "This change could not be saved (the document may be too large)."
      );
    }
  }

  /** Adopt newer server text, keeping unsent local edits on top of it. */
  private applyServer(content: string, version: number) {
    if (version < this.version) return; // older than what we already have

    const local = this.local;
    const merged =
      local === this.base
        ? { text: content, remoteSplice: diff(local, content) }
        : merge(this.base, local, content);

    this.base = content;
    this.version = version;
    this.listener.onVersion(version);

    if (merged.text !== local) {
      this.local = merged.text;
      const splice = merged.remoteSplice;
      this.listener.onRemoteText(merged.text, (i) => transformIndex(i, splice));
    }
    this.afterServerChange();
  }

  private afterServerChange() {
    if (this.local !== this.base) {
      this.listener.onDirty(true);
      this.scheduleSend();
    } else if (!this.inFlight) {
      this.listener.onDirty(false);
    }
  }
}
