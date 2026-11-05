import { useEffect, useState } from "react";

/**
 * Hash-based routes (#/ and #/w/<id>). They work on any static host without
 * rewrite rules, and give every workspace a shareable, refreshable URL.
 */
export type Route = { name: "dashboard" } | { name: "workspace"; workspaceId: string };

const WORKSPACE_ROUTE = /^#\/w\/([a-f\d]{24})\/?$/i;

export function parseRoute(hash: string): Route {
  const match = WORKSPACE_ROUTE.exec(hash);
  return match ? { name: "workspace", workspaceId: match[1] } : { name: "dashboard" };
}

export function routeToHash(route: Route): string {
  return route.name === "workspace" ? `#/w/${route.workspaceId}` : "#/";
}

export function navigate(route: Route) {
  const hash = routeToHash(route);
  if (window.location.hash !== hash) window.location.hash = hash;
}

/** The current route; updates on back/forward and on navigate(). */
export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}
