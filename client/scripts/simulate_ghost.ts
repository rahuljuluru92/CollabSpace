/**
 * Dev helper: adds a "Ghost User" to a workspace and moves its cursor around,
 * so you can see remote cursors without a second browser.
 *
 * Usage (server running locally):
 *   npx tsx scripts/simulate_ghost.ts <workspaceId> <ownerEmail> <ownerPassword>
 *
 * The owner's credentials are needed because only members can join a
 * workspace or broadcast a cursor; the script invites the ghost first.
 */
import { io } from "socket.io-client";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const [WORKSPACE_ID, OWNER_EMAIL, OWNER_PASSWORD] = process.argv.slice(2);

if (!WORKSPACE_ID || !OWNER_EMAIL || !OWNER_PASSWORD) {
  console.error("Usage: simulate_ghost.ts <workspaceId> <ownerEmail> <ownerPassword>");
  process.exit(1);
}

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${data.error ?? "unknown error"}`);
  return data;
}

async function run() {
  console.log("Logging in as owner...");
  const owner = await post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });

  console.log("Creating Ghost User...");
  const ghostEmail = `ghost_${Date.now()}@test.com`;
  const ghost = await post("/api/auth/register", {
    name: "Ghost User",
    email: ghostEmail,
    password: "ghost-password"
  });

  console.log("Inviting Ghost User to the workspace...");
  await post(`/api/workspaces/${WORKSPACE_ID}/invite`, { email: ghostEmail }, owner.token);

  const socket = io(API_URL, { auth: { token: ghost.token } });
  let timer: ReturnType<typeof setInterval> | undefined;

  socket.on("connect", () => {
    console.log("Ghost connected!");
    socket.emit("workspace:join", { workspaceId: WORKSPACE_ID });

    let x = 100;
    let y = 100;
    let dx = 5;
    let dy = 3;

    clearInterval(timer);
    timer = setInterval(() => {
      x += dx;
      y += dy;

      // Bounce around a hypothetical 800x600 box
      if (x > 800 || x < 0) dx = -dx;
      if (y > 600 || y < 0) dy = -dy;

      socket.emit("cursor:update", { workspaceId: WORKSPACE_ID, cursor: { x, y } });
    }, 50); // 20fps
  });

  socket.on("workspace:removed", () => {
    console.error("Workspace not found or ghost has no access.");
    process.exit(1);
  });

  socket.on("connect_error", (err) => console.error("Connection failed:", err.message));
  socket.on("disconnect", () => {
    clearInterval(timer);
    console.log("Ghost disconnected.");
  });
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
