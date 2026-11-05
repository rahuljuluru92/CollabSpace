import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  connectSocket,
  notReceived,
  once,
  registerUser,
  startTestServer,
  TestContext
} from "./helpers";
import { ActivityLog } from "../src/models/ActivityLog";
import { lifecycle } from "../src/lifecycle";

let ctx: TestContext;

before(async () => {
  ctx = await startTestServer();
});
after(async () => {
  await ctx.close();
});

async function setupWorkspace() {
  const owner = await registerUser(ctx, "Owner");
  const member = await registerUser(ctx, "Member");
  const outsider = await registerUser(ctx, "Outsider");
  const created = await api(ctx, "/api/workspaces", {
    method: "POST",
    token: owner.token,
    body: { name: "Doc" }
  });
  const workspaceId = created.body.workspace.id as string;
  await api(ctx, `/api/workspaces/${workspaceId}/invite`, {
    method: "POST",
    token: owner.token,
    body: { email: member.user.email }
  });
  return { owner, member, outsider, workspaceId };
}

describe("socket handlers", () => {
  it("rejects connections without a valid token", async () => {
    await assert.rejects(connectSocket(ctx, "bad-token"));
  });

  it("survives malformed payloads (no crash)", async () => {
    const { token } = await registerUser(ctx);
    const socket = await connectSocket(ctx, token);
    socket.emit("workspace:join", { workspaceId: "x" });
    socket.emit("workspace:join", null);
    socket.emit("workspace:update", { workspaceId: "x", content: 1, version: "a" });
    socket.emit("cursor:update", "garbage");
    socket.emit("workspace:leave", { workspaceId: { $gt: "" } });

    const ack = await socket
      .timeout(2000)
      .emitWithAck("workspace:update", { workspaceId: "nope", content: "", version: 1 });
    assert.deepEqual(ack, { ok: false, reason: "invalid" });

    // Server still answers HTTP after all of the above.
    assert.equal((await api(ctx, "/health")).status, 200);
    socket.disconnect();
  });

  it("applies updates atomically: exactly one of two concurrent writers wins", async () => {
    const { owner, member, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    const b = await connectSocket(ctx, member.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");
    b.emit("workspace:join", { workspaceId });
    await once(b, "workspace:sync");

    const [ackA, ackB] = await Promise.all([
      a
        .timeout(2000)
        .emitWithAck("workspace:update", { workspaceId, content: "from A", version: 1 }),
      b
        .timeout(2000)
        .emitWithAck("workspace:update", { workspaceId, content: "from B", version: 1 })
    ]);
    const oks = [ackA, ackB].filter((r) => r.ok);
    const conflicts = [ackA, ackB].filter((r) => !r.ok);
    assert.equal(oks.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].reason, "conflict");
    assert.equal(conflicts[0].version, 2);

    const ws = await api(ctx, `/api/workspaces/${workspaceId}`, { token: owner.token });
    assert.equal(ws.body.workspace.version, 2);

    a.disconnect();
    b.disconnect();
  });

  it("broadcasts updates to others but not back to the sender", async () => {
    const { owner, member, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    const b = await connectSocket(ctx, member.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");
    b.emit("workspace:join", { workspaceId });
    await once(b, "workspace:sync");

    const received = once(b, "workspace:update");
    const echoed = notReceived(a, "workspace:update");
    const ack = await a.timeout(2000).emitWithAck("workspace:update", {
      workspaceId,
      content: "hello",
      version: 1
    });
    assert.deepEqual(ack, { ok: true, version: 2 });
    const update = await received;
    assert.equal(update.content, "hello");
    assert.equal(update.version, 2);
    assert.equal(await echoed, true);

    a.disconnect();
    b.disconnect();
  });

  it("rate-limits activity entries for rapid edits", async () => {
    const { owner, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");

    for (let v = 1; v <= 10; v++) {
      const ack = await a
        .timeout(2000)
        .emitWithAck("workspace:update", { workspaceId, content: `v${v}`, version: v });
      assert.equal(ack.ok, true);
    }
    const edits = await ActivityLog.countDocuments({ workspaceId, action: "workspace:updated" });
    assert.equal(edits, 1);
    a.disconnect();
  });

  it("blocks non-members from editing, cursor broadcasts, and activity writes", async () => {
    const { owner, outsider, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    const x = await connectSocket(ctx, outsider.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");

    // Outsider tries to join: told it is not available, and no sync comes back.
    const refused = once(x, "workspace:removed");
    const noSync = notReceived(x, "workspace:sync");
    x.emit("workspace:join", { workspaceId });
    await refused;
    assert.equal(await noSync, true);

    const ack = await x
      .timeout(2000)
      .emitWithAck("workspace:update", { workspaceId, content: "pwned", version: 1 });
    assert.deepEqual(ack, { ok: false, reason: "forbidden" });

    const noCursor = notReceived(a, "cursor:update");
    x.emit("cursor:update", { workspaceId, cursor: { x: 1, y: 1 } });
    assert.equal(await noCursor, true);

    const before = await ActivityLog.countDocuments({ workspaceId });
    x.emit("workspace:leave", { workspaceId });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await ActivityLog.countDocuments({ workspaceId }), before);

    a.disconnect();
    x.disconnect();
  });

  it("evicts a member's sockets when they leave via the API", async () => {
    const { owner, member, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    const b = await connectSocket(ctx, member.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");
    const aSeesB = once(a, "presence:update");
    b.emit("workspace:join", { workspaceId });
    await Promise.all([once(b, "workspace:sync"), aSeesB]);

    const removed = once(b, "workspace:removed");
    const presence = once<{ users: { id: string }[] }>(a, "presence:update");
    await api(ctx, `/api/workspaces/${workspaceId}`, { method: "DELETE", token: member.token });
    await removed;
    const { users } = await presence;
    assert.deepEqual(
      users.map((u) => u.id),
      [owner.user.id]
    );

    // Their cursor no longer reaches the room.
    const noCursor = notReceived(a, "cursor:update");
    b.emit("cursor:update", { workspaceId, cursor: { x: 1, y: 1 } });
    assert.equal(await noCursor, true);

    a.disconnect();
    b.disconnect();
  });

  it("tells a rejoining client whether its unacknowledged edit was applied", async () => {
    const { owner, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");
    const ack = await a.timeout(2000).emitWithAck("workspace:update", {
      workspaceId,
      content: "landed",
      version: 1,
      editId: "edit-1"
    });
    assert.deepEqual(ack, { ok: true, version: 2 });
    a.disconnect();

    // Pretend the ack was lost: a new connection asks about the edit.
    const b = await connectSocket(ctx, owner.token);
    const first = once(b, "workspace:sync");
    b.emit("workspace:join", { workspaceId, pendingEditId: "edit-1" });
    const sync1 = await first;
    assert.equal(sync1.pendingEditId, "edit-1");
    assert.equal(sync1.pendingEditApplied, true);
    assert.equal(sync1.content, "landed");

    const second = once(b, "workspace:sync");
    b.emit("workspace:join", { workspaceId, pendingEditId: "never-sent" });
    const sync2 = await second;
    assert.equal(sync2.pendingEditApplied, false);

    // Invalid edit ids are rejected.
    const bad = await b.timeout(2000).emitWithAck("workspace:update", {
      workspaceId,
      content: "x",
      version: 2,
      editId: "not valid!"
    });
    assert.deepEqual(bad, { ok: false, reason: "invalid" });
    b.disconnect();
  });

  it("delivers edits to each client in version order", async () => {
    const { owner, member, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    const b = await connectSocket(ctx, member.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");
    b.emit("workspace:join", { workspaceId });
    await once(b, "workspace:sync");

    // A fires several edits back to back; B must see them in order with no gaps.
    const seen: number[] = [];
    b.on("workspace:update", (u: { version: number }) => seen.push(u.version));
    const acks = await Promise.all(
      [1, 2, 3, 4, 5].map((v) =>
        a
          .timeout(2000)
          .emitWithAck("workspace:update", { workspaceId, content: `v${v}`, version: v })
      )
    );
    assert.deepEqual(
      acks.map((x) => x.version),
      [2, 3, 4, 5, 6]
    );
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(seen, [2, 3, 4, 5, 6]);
    a.disconnect();
    b.disconnect();
  });

  it("pushes new activity live, with the actor's name", async () => {
    const { owner, member, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    a.emit("workspace:join", { workspaceId });
    const sync = await once(a, "workspace:sync");
    assert.equal(sync.activityCursor, null);
    assert.ok(sync.activity.some((e: { userName: string }) => e.userName === "Owner"));

    const live = once<{ workspaceId: string; activity: { action: string; userName: string } }>(
      a,
      "activity:new"
    );
    const b = await connectSocket(ctx, member.token);
    b.emit("workspace:join", { workspaceId });
    const { activity } = await live;
    assert.equal(activity.action, "presence:joined");
    assert.equal(activity.userName, "Member");
    a.disconnect();
    b.disconnect();
  });

  it("rate-limits a client that floods edits", async () => {
    const { owner, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");

    const acks = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        a
          .timeout(5000)
          .emitWithAck("workspace:update", { workspaceId, content: `v${i + 1}`, version: i + 1 })
      )
    );
    const ok = acks.filter((x) => x.ok).length;
    const limited = acks.filter((x) => !x.ok && x.reason === "rate_limited").length;
    assert.ok(limited >= 5, `expected some rate-limited edits, got ${limited}`);
    const ws = await api(ctx, `/api/workspaces/${workspaceId}`, { token: owner.token });
    assert.equal(ws.body.workspace.version, 1 + ok); // rate-limited edits were not applied
    a.disconnect();
  });

  it("refuses edits while shutting down, so clients can retry elsewhere", async () => {
    const { owner, workspaceId } = await setupWorkspace();
    const a = await connectSocket(ctx, owner.token);
    a.emit("workspace:join", { workspaceId });
    await once(a, "workspace:sync");

    lifecycle.beginShutdown();
    try {
      const ack = await a
        .timeout(2000)
        .emitWithAck("workspace:update", { workspaceId, content: "late", version: 1 });
      assert.deepEqual(ack, { ok: false, reason: "unavailable" });
    } finally {
      lifecycle.reset();
    }
    const ws = await api(ctx, `/api/workspaces/${workspaceId}`, { token: owner.token });
    assert.equal(ws.body.workspace.version, 1);
    a.disconnect();
  });

  it("lists a user once in presence even with two tabs open", async () => {
    const { owner, workspaceId } = await setupWorkspace();
    const tab1 = await connectSocket(ctx, owner.token);
    const tab2 = await connectSocket(ctx, owner.token);
    tab1.emit("workspace:join", { workspaceId });
    await once(tab1, "workspace:sync");
    const presence = once<{ users: unknown[] }>(tab1, "presence:update");
    tab2.emit("workspace:join", { workspaceId });
    assert.equal((await presence).users.length, 1);
    tab1.disconnect();
    tab2.disconnect();
  });
});
