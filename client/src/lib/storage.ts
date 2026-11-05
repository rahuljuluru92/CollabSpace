import type { User } from "../types";

const KEY = "syncspace_session";

export type Session = {
  token: string;
  user: User;
};

// localStorage can be unavailable (privacy modes, blocked storage) or hold
// stale/corrupt data, so every access is guarded and validated.

export function saveSession(session: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Not persisted; the user stays signed in for this tab only.
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed.user?.id !== "string" ||
      typeof parsed.user?.name !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
