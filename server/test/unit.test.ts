import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env";
import { isEmail, isObjectId, isValidCursor } from "../src/utils/validation";
import { presenceJoin, presenceLeave, presenceReset } from "../src/sockets/presence";
import { shouldLogEdit } from "../src/services/activity";
import { runExclusive } from "../src/sockets/lock";
import { rateLimit } from "../src/middleware/rateLimit";
import type { Request, Response } from "express";

describe("loadConfig", () => {
  it("rejects a bad rate-limit setting", () => {
    assert.throws(
      () =>
        loadConfig({ MONGO_URI: "m", JWT_SECRET: "x", AUTH_RATE_LIMIT_MAX: "0" } as NodeJS.ProcessEnv),
      /AUTH_RATE_LIMIT_MAX/
    );
  });

  it("requires MONGO_URI and JWT_SECRET", () => {
    assert.throws(() => loadConfig({ JWT_SECRET: "x" } as NodeJS.ProcessEnv), /MONGO_URI/);
    assert.throws(() => loadConfig({ MONGO_URI: "m" } as NodeJS.ProcessEnv), /JWT_SECRET/);
  });

  it("defaults CORS to localhost in development only", () => {
    const dev = loadConfig({ MONGO_URI: "m", JWT_SECRET: "x" } as NodeJS.ProcessEnv);
    assert.ok(dev.corsOrigins.includes("http://localhost:5173"));
    assert.throws(
      () =>
        loadConfig({
          MONGO_URI: "m",
          JWT_SECRET: "x".repeat(40),
          NODE_ENV: "production"
        } as NodeJS.ProcessEnv),
      /CLIENT_ORIGIN/
    );
  });

  it("rejects weak secrets and wildcard origins in production", () => {
    const base = { MONGO_URI: "m", NODE_ENV: "production", CLIENT_ORIGIN: "https://app.example" };
    assert.throws(() => loadConfig({ ...base, JWT_SECRET: "short" } as NodeJS.ProcessEnv), /32/);
    assert.throws(
      () => loadConfig({ ...base, JWT_SECRET: "x".repeat(40), CLIENT_ORIGIN: "*" } as NodeJS.ProcessEnv),
      /\*/
    );
    const ok = loadConfig({
      ...base,
      JWT_SECRET: "x".repeat(40),
      CLIENT_ORIGIN: "https://a.example, https://b.example"
    } as NodeJS.ProcessEnv);
    assert.deepEqual(ok.corsOrigins, ["https://a.example", "https://b.example"]);
  });
});

describe("validation", () => {
  it("accepts only 24-char hex object ids", () => {
    assert.equal(isObjectId("507f1f77bcf86cd799439011"), true);
    assert.equal(isObjectId("x"), false);
    assert.equal(isObjectId("aaaaaaaaaaaa"), false); // 12-char strings are "valid" to mongoose
    assert.equal(isObjectId({ $gt: "" }), false);
  });

  it("checks emails and cursors", () => {
    assert.equal(isEmail("a@b.co"), true);
    assert.equal(isEmail("nope"), false);
    assert.equal(isValidCursor(null), true);
    assert.equal(isValidCursor({ x: 1, y: 2 }), true);
    assert.equal(isValidCursor({ x: "1", y: 2 }), false);
    assert.equal(isValidCursor({ x: Infinity, y: 2 }), false);
  });
});

describe("presence", () => {
  beforeEach(() => presenceReset());

  it("dedupes users with several sockets and removes them on last leave", () => {
    presenceJoin("w", "s1", { id: "u1", name: "A" });
    let users = presenceJoin("w", "s2", { id: "u1", name: "A" });
    assert.equal(users.length, 1);
    users = presenceLeave("w", "s1");
    assert.equal(users.length, 1);
    users = presenceLeave("w", "s2");
    assert.equal(users.length, 0);
  });
});

describe("shouldLogEdit", () => {
  it("logs at most once per minute per user and workspace", () => {
    const t = 1_000_000;
    assert.equal(shouldLogEdit("w-unit", "u", t), true);
    assert.equal(shouldLogEdit("w-unit", "u", t + 1000), false);
    assert.equal(shouldLogEdit("w-unit", "other", t + 1000), true);
    assert.equal(shouldLogEdit("w-unit", "u", t + 61_000), true);
  });
});

describe("runExclusive", () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("runs tasks for the same key one at a time, in order, even after a failure", async () => {
    const order: string[] = [];
    const a = runExclusive("k", async () => {
      await delay(30);
      order.push("a");
    });
    const b = runExclusive("k", async () => {
      order.push("b");
    });
    const c = runExclusive("k", async () => {
      throw new Error("boom");
    });
    const d = runExclusive("k", async () => {
      order.push("d");
      return 42;
    });
    await a;
    await b;
    await assert.rejects(c, /boom/);
    assert.equal(await d, 42);
    assert.deepEqual(order, ["a", "b", "d"]);
  });

  it("does not block other keys", async () => {
    const order: string[] = [];
    const slow = runExclusive("slow", async () => {
      await delay(30);
      order.push("slow");
    });
    const fast = runExclusive("fast", async () => {
      order.push("fast");
    });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ["fast", "slow"]);
  });
});

describe("rateLimit", () => {
  function hit(limiter: ReturnType<typeof rateLimit>, ip: string) {
    let status = 200;
    let passed = false;
    const res = {
      setHeader() {},
      status(code: number) {
        status = code;
        return { json() {} };
      }
    } as unknown as Response;
    limiter({ ip } as Request, res, () => {
      passed = true;
    });
    return passed ? 200 : status;
  }

  it("returns 429 after the limit, per IP", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    assert.deepEqual(
      [hit(limiter, "1.1.1.1"), hit(limiter, "1.1.1.1"), hit(limiter, "1.1.1.1")],
      [200, 200, 429]
    );
    assert.equal(hit(limiter, "2.2.2.2"), 200);
  });
});
