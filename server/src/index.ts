import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import setupSockets from "./sockets";
import { connectDb } from "./config/db";
import authRoutes from "./routes/auth";
import workspaceRoutes from "./routes/workspaces";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req: express.Request, res: express.Response) => { res.send("Server is running!"); });
app.get("/health", (_req: express.Request, res: express.Response) => { res.json({ ok: true }); });
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);

const server = http.createServer(app);
setupSockets(server);

const PORT = Number(process.env.PORT ?? 3001);

connectDb()
  .then(() => {
    server.listen(PORT, () => console.log("Server running on port", PORT));
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });
