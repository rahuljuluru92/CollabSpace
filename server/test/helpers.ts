import { AddressInfo } from "net";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createServer } from "../src/app";
import { loadConfig } from "../src/config/env";

export type TestContext = {
  baseUrl: string;
  close: () => Promise<void>;
};

/**
 * Uses TEST_MONGO_URI when set (e.g. a MongoDB service in CI); otherwise
 * starts an in-memory MongoDB, which downloads a mongod binary on first use.
 */
async function startMongo(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const external = process.env.TEST_MONGO_URI;
  if (external) {
    const url = new URL(external);
    url.pathname = `/collabspace_test_${process.pid}_${Date.now()}`;
    return {
      uri: url.toString(),
      stop: async () => {
        await mongoose.connection.dropDatabase();
      }
    };
  }
  const mongo = await MongoMemoryServer.create();
  return { uri: mongo.getUri(), stop: async () => void (await mongo.stop()) };
}

export async function startTestServer(): Promise<TestContext> {
  const mongo = await startMongo();
  process.env.JWT_SECRET = "test-secret";
  const config = loadConfig({
    MONGO_URI: mongo.uri,
    JWT_SECRET: "test-secret",
    NODE_ENV: "test"
  } as NodeJS.ProcessEnv);
  await mongoose.connect(config.mongoUri);
  await mongoose.connection.syncIndexes();

  const { server, io } = createServer(config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mongo.stop();
      await mongoose.disconnect();
    }
  };
}

export async function api(
  ctx: TestContext,
  path: string,
  { method = "GET", body, token }: { method?: string; body?: unknown; token?: string } = {}
) {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, body: json };
}

let counter = 0;
export async function registerUser(ctx: TestContext, name = "User") {
  counter += 1;
  const email = `user${counter}_${Date.now()}@example.com`;
  const res = await api(ctx, "/api/auth/register", {
    method: "POST",
    body: { name, email, password: "password123" }
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

export async function connectSocket(ctx: TestContext, token: string): Promise<ClientSocket> {
  const socket = ioClient(ctx.baseUrl, { auth: { token }, transports: ["websocket"], forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return socket;
}

export function once<T = any>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves true if `event` is NOT received within `ms`. */
export function notReceived(socket: ClientSocket, event: string, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, ms);
    socket.once(event, handler);
  });
}
