import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, registerUser, startTestServer, TestContext } from "./helpers";

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

    const deleted = await api(ctx, `/api/workspaces/${id}`, { method: "DELETE", token: owner.token });
    assert.equal(deleted.body.message, "Workspace deleted");
    assert.equal((await api(ctx, `/api/workspaces/${id}`, { token: owner.token })).status, 404);
  });
});
