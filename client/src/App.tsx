import { useCallback, useState } from "react";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import WorkspacePage from "./pages/WorkspacePage";
import { clearSession, loadSession, saveSession, type Session } from "./lib/storage";
import { navigate, useRoute } from "./lib/router";
import type { User } from "./types";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const route = useRoute();

  /** Sign out (also used when the server says the session has expired). */
  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
    navigate({ name: "dashboard" });
  }, []);

  function handleAuthenticated(token: string, user: User) {
    const next = { token, user };
    saveSession(next);
    setSession(next);
  }

  if (!session) {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  if (route.name === "workspace") {
    return (
      <WorkspacePage
        key={route.workspaceId}
        token={session.token}
        user={session.user}
        workspaceId={route.workspaceId}
        onBack={() => navigate({ name: "dashboard" })}
        onSessionExpired={handleLogout}
      />
    );
  }

  return (
    <DashboardPage
      key={session.token}
      token={session.token}
      user={session.user}
      onOpen={(workspaceId) => navigate({ name: "workspace", workspaceId })}
      onLogout={handleLogout}
    />
  );
}
