import { useState } from "react";
import { login, register } from "../lib/api";
import { saveSession } from "../lib/storage";
import type { User } from "../types";

type Props = {
  onAuthenticated: (token: string, user: User) => void;
};

export default function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload =
        mode === "login"
          ? await login(email, password)
          : await register(name, email, password);
      saveSession(payload);
      onAuthenticated(payload.token, payload.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_0.9fr]">
      <section className="p-10 lg:p-16 flex flex-col justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-neon font-medium">
            SyncSpace
          </p>
          <h1 className="mt-6 text-4xl lg:text-5xl font-display font-semibold text-fog">
            Real-time collaboration, with the server as the single source of truth.
          </h1>
          <p className="mt-6 text-lg text-fog/80 max-w-xl">
            Build shared workspaces with presence, activity trails, and optimistic updates.
            SyncSpace keeps teams aligned even through disconnects.
          </p>
        </div>
        <div className="mt-12 grid gap-4 text-sm text-fog/70 max-w-md">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-lime"></span>
            Presence tracking and room-based sockets
          </div>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-neon"></span>
            JWT-secured API + socket authentication
          </div>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-coral"></span>
            Reconnection sync to keep state consistent
          </div>
        </div>
      </section>

      <section className="p-10 lg:p-16 flex items-center">
        <div className="w-full max-w-md bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-glow">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-display font-semibold text-fog">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm text-fog/70">
                {mode === "login"
                  ? "Sign in to access your workspaces."
                  : "Start collaborating in minutes."}
              </p>
            </div>
            <button
              className="text-xs uppercase tracking-[0.25em] text-neon"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              type="button"
            >
              {mode === "login" ? "Register" : "Login"}
            </button>
          </div>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            {mode === "register" && (
              <label className="grid gap-2 text-sm text-fog/80">
                Name
                <input
                  className="h-11 rounded-lg bg-white/10 border border-white/10 px-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            )}
            <label className="grid gap-2 text-sm text-fog/80">
              Email
              <input
                type="email"
                className="h-11 rounded-lg bg-white/10 border border-white/10 px-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="grid gap-2 text-sm text-fog/80">
              Password
              <input
                type="password"
                className="h-11 rounded-lg bg-white/10 border border-white/10 px-4 text-fog focus:outline-none focus:ring-2 focus:ring-neon/40"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="text-sm text-coral">{error}</p>}
            <button
              className="h-11 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
              disabled={loading}
              type="submit"
            >
              {loading ? "Working..." : mode === "login" ? "Login" : "Register"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
