import type { User, WorkspaceSummary, WorkspaceDetail } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error ?? "Request failed";
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function register(name: string, email: string, password: string) {
  return apiFetch<{ token: string; user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password })
  });
}

export async function login(email: string, password: string) {
  return apiFetch<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function fetchWorkspaces(token: string) {
  return apiFetch<{ workspaces: WorkspaceSummary[] }>("/api/workspaces", {}, token);
}

export async function createWorkspace(token: string, name: string) {
  return apiFetch<{ workspace: WorkspaceSummary }>(
    "/api/workspaces",
    {
      method: "POST",
      body: JSON.stringify({ name })
    },
    token
  );
}

export async function fetchWorkspace(token: string, workspaceId: string) {
  return apiFetch<{ workspace: WorkspaceSummary; activity: WorkspaceDetail["activity"] }>(
    `/api/workspaces/${workspaceId}`,
    {},
    token
  );
}

export async function inviteMember(token: string, workspaceId: string, email: string) {
  return apiFetch<{ added: boolean; member: { id: string; name: string; email: string } }>(
    `/api/workspaces/${workspaceId}/invite`,
    {
      method: "POST",
      body: JSON.stringify({ email })
    },
    token
  );
}


export async function deleteWorkspace(token: string, workspaceId: string) {
  return apiFetch<{ success: boolean; message: string }>(
    `/api/workspaces/${workspaceId}`,
    {
      method: "DELETE"
    },
    token
  );
}
