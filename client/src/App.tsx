import { useEffect, useState } from "react";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import WorkspacePage from "./pages/WorkspacePage";
import { clearSession, loadSession, saveSession } from "./lib/storage";
import { createWorkspace, fetchWorkspaces } from "./lib/api";
import type { User, WorkspaceSummary } from "./types";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (session) {
      setToken(session.token);
      setUser(session.user);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    refreshWorkspaces();
  }, [token]);

  async function refreshWorkspaces() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchWorkspaces(token);
      setWorkspaces(data.workspaces);
    } finally {
      setLoading(false);
    }
  }

  function handleAuthenticated(nextToken: string, nextUser: User) {
    setToken(nextToken);
    setUser(nextUser);
    saveSession({ token: nextToken, user: nextUser });
  }

  async function handleCreateWorkspace(name: string) {
    if (!token) return;
    const data = await createWorkspace(token, name);
    await refreshWorkspaces();
    setActiveWorkspaceId(data.workspace.id);
  }

  function handleLogout() {
    clearSession();
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
  }

  if (!token || !user) {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  if (activeWorkspaceId) {
    const workspace = workspaces.find((ws) => ws.id === activeWorkspaceId);
    if (!workspace) {
      return (
        <DashboardPage
          user={user}
          workspaces={workspaces}
          onCreate={handleCreateWorkspace}
          onOpen={setActiveWorkspaceId}
          onRefresh={refreshWorkspaces}
          onLogout={handleLogout}
        />
      );
    }
    return (
      <WorkspacePage
        token={token}
        workspace={workspace}
        onBack={() => {
          setActiveWorkspaceId(null);
          refreshWorkspaces();
        }}
      />
    );
  }

  return (
    <>
      {loading && (
        <div className="fixed top-4 right-6 text-xs uppercase tracking-[0.3em] text-neon">
          Loading...
        </div>
      )}
      <DashboardPage
        user={user}
        workspaces={workspaces}
        onCreate={handleCreateWorkspace}
        onOpen={setActiveWorkspaceId}
        onRefresh={refreshWorkspaces}
        onLogout={handleLogout}
      />
    </>
  );
}
