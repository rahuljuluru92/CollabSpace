import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, registerUser, startTestServer, TestContext } from "./helpers";
import { lifecycle } from "../src/lifecycle";

let ctx: TestContext;

before(async () => {
  ctx = await startTestServer();
});
after(async () => {
  await ctx.close();
});

describe("auth", () => {
  it("validates registration input", async () => {
    const bad = [
      { name: "", email: "a@b.co", password: "password123" },
      { name: "A", email: "not-an-email", password: "password123" },
      { name: "A", email: "a@b.co", password: "short" },
      { name: { $ne: 1 }, email: "a@b.co", password: "password123" }
    ];
    for (const body of bad) {
      const res = await api(ctx, "/api/auth/register", { method: "POST", body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("registers, rejects duplicates, and logs in case-insensitively", async () => {
    const email = `Dup_${Date.now()}@Example.com`;
    const first = await api(ctx, "/api/auth/register", {
      method: "POST",
      body: { name: "Dup", email, password: "password123" }
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.user.email, email.toLowerCase());

    const dup = await api(ctx, "/api/auth/register", {
      method: "POST",
      body: { name: "Dup", email: email.toLowerCase(), password: "password123" }
    });
    assert.equal(dup.status, 409);

    const login = await api(ctx, "/api/auth/login", {
      method: "POST",
      body: { email: email.toUpperCase(), password: "password123" }
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);

    const wrong = await api(ctx, "/api/auth/login", {
      method: "POST",
      body: { email, password: "nope-nope" }
    });
    assert.equal(wrong.status, 401);
  });

  it("returns 409 (not 500) for concurrent duplicate sign-ups", async () => {
    const email = `race_${Date.now()}@example.com`;
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        api(ctx, "/api/auth/register", {
          method: "POST",
          body: { name: "Race", email, password: "password123" }
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
  });

  it("returns JSON errors for malformed bodies and unknown routes", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);

    const missing = await api(ctx, "/api/nope");
    assert.equal(missing.status, 404);
  });
});

describe("platform", () => {
  it("sends security headers and a request id", async () => {
    const res = await fetch(`${ctx.baseUrl}/health`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("strict-transport-security"));
    assert.match(res.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

    const echoed = await fetch(`${ctx.baseUrl}/health`, {
      headers: { "x-request-id": "trace-42" }
    });
    assert.equal(echoed.headers.get("x-request-id"), "trace-42");
  });

  it("reports readiness, including during shutdown", async () => {
    const ready = await api(ctx, "/health/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { ok: true, db: "up", shuttingDown: false });

    lifecycle.beginShutdown();
    try {
      const draining = await api(ctx, "/health/ready");
      assert.equal(draining.status, 503);
      assert.equal(draining.body.shuttingDown, true);
    } finally {
      lifecycle.reset();
    }
  });
});

describe("workspaces", () => {
  it("requires a valid token", async () => {
    assert.equal((await api(ctx, "/api/workspaces")).status, 401);
    assert.equal((await api(ctx, "/api/workspaces", { token: "garbage" })).status, 401);
  });

  it("returns 404 for malformed ids instead of crashing", async () => {
    const { token } = await registerUser(ctx);
    const res = await api(ctx, "/api/workspaces/not-an-id", { token });
    assert.equal(res.status, 404);
  });

  it("enforces membership, invites, leaving and deleting", async () => {
    const owner = await registerUser(ctx, "Owner");
    const other = await registerUser(ctx, "Other");

    const created = await api(ctx, "/api/workspaces", {
      method: "POST",
      token: owner.token,
      body: { name: "Plans" }
    });
    assert.equal(created.status, 201);
    const id = created.body.workspace.id as string;

    assert.equal((await api(ctx, `/api/workspaces/${id}`, { token: other.token })).status, 403);

    const invite = await api(ctx, `/api/workspaces/${id}/invite`, {
      method: "POST",
      token: owner.token,
      body: { email: other.user.email }
    });
    assert.equal(invite.status, 200);
    assert.equal(invite.body.added, true);

    const again = await api(ctx, `/api/workspaces/${id}/invite`, {
      method: "POST",
      token: owner.token,
      body: { email: other.user.email }
    });
    assert.equal(again.body.added, false);

    assert.equal((await api(ctx, `/api/workspaces/${id}`, { token: other.token })).status, 200);

    const left = await api(ctx, `/api/workspaces/${id}`, { method: "DELETE", token: other.token });
    assert.equal(left.body.message, "Left workspace");
    assert.equal((await api(ctx, `/api/workspaces/${id}`, { token: other.token })).status, 403);

    const deleted = await api(ctx, `/api/workspaces/${id}`, {
      method: "DELETE",
      token: owner.token
    });
    assert.equal(deleted.body.message, "Workspace deleted");
    assert.equal((await api(ctx, `/api/workspaces/${id}`, { token: owner.token })).status, 404);
  });

  it("paginates the workspace list newest first, with short previews", async () => {
    const { token } = await registerUser(ctx, "Pager");
    const long = "x".repeat(1000);
    for (let i = 1; i <= 5; i++) {
      const res = await api(ctx, "/api/workspaces", {
        method: "POST",
        token,
        body: { name: `WS ${i}`, content: i === 5 ? long : "short" }
      });
      assert.equal(res.status, 201);
    }

    const names: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
      const res = await api(ctx, `/api/workspaces${query}`, { token });
      assert.equal(res.status, 200);
      assert.ok(res.body.workspaces.length <= 2);
      for (const ws of res.body.workspaces) {
        assert.equal(ws.content, undefined);
        assert.ok(ws.preview.length <= 280);
        names.push(ws.name);
      }
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    assert.deepEqual(names, ["WS 5", "WS 4", "WS 3", "WS 2", "WS 1"]);
    assert.equal(pages, 3);

    const bad = await api(ctx, "/api/workspaces?cursor=nonsense", { token });
    assert.equal(bad.status, 400);
  });

  it("pages through activity with names, members only", async () => {
    const owner = await registerUser(ctx, "Olive");
    const others = [await registerUser(ctx, "P1"), await registerUser(ctx, "P2")];
    const created = await api(ctx, "/api/workspaces", {
      method: "POST",
      token: owner.token,
      body: { name: "Log" }
    });
    const id = created.body.workspace.id as string;
    for (const o of others) {
      await api(ctx, `/api/workspaces/${id}/invite`, {
        method: "POST",
        token: owner.token,
        body: { email: o.user.email }
      });
    }

    // created + 2 invites = 3 entries
    const first = await api(ctx, `/api/workspaces/${id}/activity?limit=2`, { token: owner.token });
    assert.equal(first.status, 200);
    assert.equal(first.body.activity.length, 2);
    assert.equal(first.body.activity[0].action, "member:invited");
    assert.equal(first.body.activity[0].userName, "Olive");
    assert.ok(first.body.nextCursor);

    const second = await api(
      ctx,
      `/api/workspaces/${id}/activity?limit=2&before=${first.body.nextCursor}`,
      { token: owner.token }
    );
    assert.equal(second.body.activity.length, 1);
    assert.equal(second.body.activity[0].action, "workspace:created");
    assert.equal(second.body.nextCursor, null);

    const outsider = await registerUser(ctx, "Out");
    const denied = await api(ctx, `/api/workspaces/${id}/activity`, { token: outsider.token });
    assert.equal(denied.status, 403);
    const bad = await api(ctx, `/api/workspaces/${id}/activity?before=zzz`, { token: owner.token });
    assert.equal(bad.status, 400);
  });
});
