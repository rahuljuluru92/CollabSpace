import { describe, expect, it } from "vitest";
import { parseRoute, routeToHash } from "./router";

describe("router", () => {
  it("parses workspace links", () => {
    expect(parseRoute("#/w/507f1f77bcf86cd799439011")).toEqual({
      name: "workspace",
      workspaceId: "507f1f77bcf86cd799439011"
    });
    expect(parseRoute("#/w/507f1f77bcf86cd799439011/")).toMatchObject({ name: "workspace" });
  });

  it("falls back to the dashboard", () => {
    for (const hash of ["", "#", "#/", "#/w/", "#/w/not-an-id", "#/other"]) {
      expect(parseRoute(hash)).toEqual({ name: "dashboard" });
    }
  });

  it("round-trips", () => {
    const route = { name: "workspace", workspaceId: "507f1f77bcf86cd799439011" } as const;
    expect(parseRoute(routeToHash(route))).toEqual(route);
    expect(routeToHash({ name: "dashboard" })).toBe("#/");
  });
});
