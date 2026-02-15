import type { User } from "../types";

const KEY = "syncspace_session";

export type Session = {
  token: string;
  user: User;
};

export function saveSession(session: Session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
