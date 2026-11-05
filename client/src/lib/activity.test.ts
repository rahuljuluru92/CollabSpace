import { describe, expect, it } from "vitest";
import type { ActivityLog } from "../types";
import { describeActivity, mergeActivity } from "./activity";

function entry(partial: Partial<ActivityLog>): ActivityLog {
  return {
    id: "1",
    action: "workspace:updated",
    userId: "u1",
    userName: "Alice",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

describe("describeActivity", () => {
  it("describes known actions", () => {
    expect(describeActivity(entry({ action: "workspace:created" }))).toBe(
      "Alice created the workspace"
    );
    expect(describeActivity(entry({ action: "workspace:updated" }))).toBe(
      "Alice edited the document"
    );
    expect(
      describeActivity(
        entry({ action: "member:invited", metadata: { invitedName: "Bob", invitedEmail: "b@x.io" } })
      )
    ).toBe("Alice invited Bob");
    expect(describeActivity(entry({ action: "member:invited", metadata: { invitedEmail: "b@x.io" } }))).toBe(
      "Alice invited b@x.io"
    );
  });

  it("copes with old entries that have no name", () => {
    expect(describeActivity(entry({ userName: null, action: "member:left" }))).toBe(
      "Someone left the workspace"
    );
  });
});

describe("mergeActivity", () => {
  it("prepends new entries and skips ones already shown", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    const c = entry({ id: "c" });
    expect(mergeActivity([b, c], [a, b], "start").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(mergeActivity([a], [b, a, c], "end").map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
