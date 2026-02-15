import { io } from "socket.io-client";

const API_URL = "http://localhost:3001";
const WORKSPACE_ID = process.argv[2]; // Pass workspace ID as argument

if (!WORKSPACE_ID) {
    console.error("Please provide a Workspace ID as an argument.");
    process.exit(1);
}

// 1. Authenticate (Register a Ghost User to get a token)
async function getGhostToken() {
    const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: "Ghost User",
            email: `ghost_${Date.now()}@test.com`,
            password: "password"
        })
    });
    const data = await res.json();
    return data.token;
}

async function run() {
    console.log("Creating Ghost User...");
    const token = await getGhostToken();
    console.log("Ghost User created. Connecting to socket...");

    const socket = io(API_URL, {
        auth: { token }
    });

    socket.on("connect", () => {
        console.log("Ghost connected!");
        socket.emit("workspace:join", { workspaceId: WORKSPACE_ID });

        // Start moving cursor
        let x = 100;
        let y = 100;
        let dx = 5;
        let dy = 3;

        setInterval(() => {
            x += dx;
            y += dy;

            // Bounce around a hypothetical 800x600 box
            if (x > 800 || x < 0) dx = -dx;
            if (y > 600 || y < 0) dy = -dy;

            socket.emit("cursor:update", {
                workspaceId: WORKSPACE_ID,
                cursor: { x, y }
            });
            if (Date.now() % 1000 < 50) console.log(`Ghost at ${x},${y}`);
        }, 50); // 20fps
    });

    socket.on("disconnect", () => {
        console.log("Ghost disconnected.");
    });
}

run();
