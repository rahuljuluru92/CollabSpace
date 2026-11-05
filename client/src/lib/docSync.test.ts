import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocSync, type OutgoingEdit, type SyncState, type UpdateAck } from "./docSync";

type Sent = { edit: OutgoingEdit; done: (err: Error | null, ack?: UpdateAck) => void };

function setup(initial = { content: "", version: 1 }) {
  let connected = true;
  let ids = 0;
  const sent: Sent[] = [];
  const joins: (string | null)[] = [];
  let reconnects = 0;
  const view = {
    text: initial.content,
    version: initial.version,
    dirty: false,
    error: null as string | null,
    lastRemap: null as ((i: number) => number) | null
  };

  const sync = new DocSync(
    initial,
    {
      isConnected: () => connected,
      sendEdit: (edit, done) => sent.push({ edit, done }),
      join: (pendingEditId) => joins.push(pendingEditId),
      reconnect: () => {
        reconnects += 1;
      }
    },
    {
      onRemoteText: (text, remap) => {
        view.text = text;
        view.lastRemap = remap;
      },
      onVersion: (v) => {
        view.version = v;
      },
      onDirty: (d) => {
        view.dirty = d;
      },
      onError: (e) => {
        view.error = e;
      }
    },
    { debounceMs: 100, syncTimeoutMs: 5000, retryDelayMs: 1000, createId: () => `e${++ids}` }
  );

  /** The user types: update the view the way the textarea would, then tell the engine. */
  const type = (text: string) => {
    view.text = text;
    sync.localChange(text);
  };

  /** Connect and answer the join with a sync. */
  const ready = (state: SyncState = { content: initial.content, version: initial.version }) => {
    sync.connected();
    sync.sync(state);
  };

  const lastSent = () => sent[sent.length - 1];

  return {
    sync,
    sent,
    joins,
    view,
    type,
    ready,
    lastSent,
    get reconnects() {
      return reconnects;
    },
    disconnect() {
      connected = false;
      sync.disconnected();
    },
    reconnect() {
      connected = true;
      sync.connected();
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DocSync", () => {
  it("waits for the first sync before sending anything", () => {
    const t = setup();
    t.type("early");
    vi.advanceTimersByTime(500);
    expect(t.sent).toHaveLength(0);
    t.ready();
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toEqual({ editId: "e1", content: "early", version: 1 });
  });

  it("debounces typing into one edit and settles on ack", () => {
    const t = setup();
    t.ready();
    t.type("h");
    t.type("he");
    t.type("hel");
    vi.advanceTimersByTime(99);
    expect(t.sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].edit).toEqual({ editId: "e1", content: "hel", version: 1 });
    expect(t.view.dirty).toBe(true);

    t.sent[0].done(null, { ok: true, version: 2 });
    expect(t.view.version).toBe(2);
    expect(t.view.dirty).toBe(false);
    expect(t.sync.hasUnsavedChanges).toBe(false);
  });

  it("keeps one edit in flight and sends later typing after the ack", () => {
    const t = setup();
    t.ready();
    t.type("a");
    vi.advanceTimersByTime(100);
    t.type("ab");
    vi.advanceTimersByTime(1000);
    expect(t.sent).toHaveLength(1); // still waiting for the first ack

    t.sent[0].done(null, { ok: true, version: 2 });
    vi.advanceTimersByTime(100);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].edit).toMatchObject({ content: "ab", version: 2 });
  });

  it("applies remote edits and moves the caret with them", () => {
    const t = setup({ content: "world", version: 1 });
    t.ready();
    t.sync.remoteUpdate("hello world", 2);
    expect(t.view.text).toBe("hello world");
    expect(t.view.version).toBe(2);
    expect(t.view.lastRemap!(5)).toBe(11); // caret at end of "world" stays at the end
    expect(t.sent).toHaveLength(0);
  });

  it("ignores stale remote updates", () => {
    const t = setup({ content: "new", version: 5 });
    t.ready({ content: "new", version: 5 });
    t.sync.remoteUpdate("old", 4);
    expect(t.sync.text).toBe("new");
  });

  it("merges remote edits into unsent local typing", () => {
    const t = setup({ content: "hello world", version: 1 });
    t.ready({ content: "hello world", version: 1 });
    t.type("hello brave world");
    t.sync.remoteUpdate("hello world!", 2);
    expect(t.view.text).toBe("hello brave world!");
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toMatchObject({ content: "hello brave world!", version: 2 });
  });

  it("rebases and resends after a conflict", () => {
    const t = setup({ content: "abc", version: 1 });
    t.ready({ content: "abc", version: 1 });
    t.type("abcX");
    vi.advanceTimersByTime(100);
    t.sent[0].done(null, { ok: false, reason: "conflict", content: "Yabc", version: 2 });
    expect(t.view.text).toBe("YabcX");
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toMatchObject({ content: "YabcX", version: 2 });
  });

  it("handles a remote edit that arrives while our edit is in flight", () => {
    const t = setup({ content: "abc", version: 1 });
    t.ready({ content: "abc", version: 1 });
    t.type("abcX");
    vi.advanceTimersByTime(100);
    // Server applied someone else's edit first; ours will come back as a conflict.
    t.sync.remoteUpdate("Yabc", 2);
    expect(t.view.text).toBe("YabcX");
    vi.advanceTimersByTime(1000);
    expect(t.sent).toHaveLength(1); // nothing new while the first is unanswered
    t.sent[0].done(null, { ok: false, reason: "conflict", content: "Yabc", version: 2 });
    expect(t.view.text).toBe("YabcX");
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toMatchObject({ content: "YabcX", version: 2 });
  });

  it("does not duplicate text when a lost ack's edit had actually landed", () => {
    const t = setup({ content: "hello", version: 1 });
    t.ready({ content: "hello", version: 1 });
    t.type("hello w");
    vi.advanceTimersByTime(100);
    expect(t.sent[0].edit).toEqual({ editId: "e1", content: "hello w", version: 1 });
    t.type("hello wor"); // keeps typing while the edit is in flight

    // Connection drops before the ack arrives (Socket.IO reports an error).
    t.disconnect();
    t.sent[0].done(new Error("socket has been disconnected"));
    expect(t.reconnects).toBe(0); // the reconnect is already under way

    t.reconnect();
    expect(t.joins[t.joins.length - 1]).toBe("e1");
    // Server: edit e1 was applied, so its text is already "hello w".
    t.sync.sync({ content: "hello w", version: 2, pendingEditId: "e1", pendingEditApplied: true });
    expect(t.sync.text).toBe("hello wor");
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toMatchObject({ content: "hello wor", version: 2 });
  });

  it("resends the text when a lost ack's edit never landed", () => {
    const t = setup({ content: "hello", version: 1 });
    t.ready({ content: "hello", version: 1 });
    t.type("hello w");
    vi.advanceTimersByTime(100);
    t.type("hello wor");
    t.disconnect();
    t.reconnect();
    t.sync.sync({ content: "hello", version: 1, pendingEditId: "e1", pendingEditApplied: false });
    expect(t.sync.text).toBe("hello wor");
    vi.advanceTimersByTime(100);
    expect(t.lastSent().edit).toMatchObject({ content: "hello wor", version: 1 });
  });

  it("reconnects when an ack times out while still connected", () => {
    const t = setup();
    t.ready();
    t.type("x");
    vi.advanceTimersByTime(100);
    t.sent[0].done(new Error("operation has timed out"));
    expect(t.reconnects).toBe(1);
    expect(t.view.error).toMatch(/Reconnecting/);
    // Nothing else is sent until the next connection's sync resolves the edit.
    t.type("xy");
    vi.advanceTimersByTime(1000);
    expect(t.sent).toHaveLength(1);
  });

  it("reconnects if the server never answers the join", () => {
    const t = setup();
    t.sync.connected();
    vi.advanceTimersByTime(5000);
    expect(t.reconnects).toBe(1);
  });

  it("ignores remote updates while waiting for a sync", () => {
    const t = setup({ content: "a", version: 1 });
    t.ready({ content: "a", version: 1 });
    t.disconnect();
    t.reconnect();
    t.sync.remoteUpdate("ignored", 7);
    expect(t.sync.text).toBe("a");
    t.sync.sync({ content: "from sync", version: 8 });
    expect(t.sync.text).toBe("from sync");
  });

  it("shows an error and stops retrying when access is gone", () => {
    const t = setup();
    t.ready();
    t.type("x");
    vi.advanceTimersByTime(100);
    t.sent[0].done(null, { ok: false, reason: "forbidden" });
    expect(t.view.error).toMatch(/no longer have access/);
    vi.advanceTimersByTime(1000);
    expect(t.sent).toHaveLength(1);
  });

  it("retries later when the server is busy or restarting", () => {
    for (const reason of ["rate_limited", "unavailable"] as const) {
      const t = setup();
      t.ready();
      t.type("x");
      vi.advanceTimersByTime(100);
      t.sent[0].done(null, { ok: false, reason });
      expect(t.sync.hasUnsavedChanges).toBe(true);
      vi.advanceTimersByTime(999);
      expect(t.sent).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(t.sent).toHaveLength(2);
      expect(t.sent[1].edit).toMatchObject({ content: "x", version: 1 });
      expect(t.reconnects).toBe(0);
    }
  });

  it("stops after dispose", () => {
    const t = setup();
    t.ready();
    t.type("x");
    t.sync.dispose();
    vi.advanceTimersByTime(1000);
    expect(t.sent).toHaveLength(0);
  });
});
