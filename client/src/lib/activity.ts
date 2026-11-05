import type { ActivityLog } from "../types";

/** Human-readable sentence for an activity entry, e.g. "Alice invited Bob". */
export function describeActivity(entry: ActivityLog): string {
  const who = entry.userName ?? "Someone";
  switch (entry.action) {
    case "workspace:created":
      return `${who} created the workspace`;
    case "workspace:updated":
      return `${who} edited the document`;
    case "member:invited": {
      const invited = entry.metadata.invitedName ?? entry.metadata.invitedEmail ?? "someone";
      return `${who} invited ${String(invited)}`;
    }
    case "member:left":
      return `${who} left the workspace`;
    case "presence:joined":
      return `${who} opened the workspace`;
    case "presence:left":
      return `${who} closed the workspace`;
    default:
      return `${who}: ${entry.action}`;
  }
}

/** Adds entries to a newest-first list without duplicates. */
export function mergeActivity(
  current: ActivityLog[],
  incoming: ActivityLog[],
  position: "start" | "end"
): ActivityLog[] {
  const seen = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  return position === "start" ? [...fresh, ...current] : [...current, ...fresh];
}
