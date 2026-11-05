import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real server and the production client build.
 *
 * Needs MongoDB (E2E_MONGO_URI, default mongodb://localhost:27017), a built
 * server (`npm run build` in server/) and a client built with
 * VITE_API_URL / VITE_SOCKET_URL pointing at http://localhost:3101.
 */
const API_PORT = 3101;
const WEB_PORT = 4173;
const mongoBase = process.env.E2E_MONGO_URI ?? "mongodb://localhost:27017";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm start",
      cwd: "../server",
      url: `http://localhost:${API_PORT}/health/ready`,
      env: {
        PORT: String(API_PORT),
        MONGO_URI: `${mongoBase.replace(/\/$/, "")}/collabspace_e2e_${Date.now()}`,
        JWT_SECRET: "e2e-secret",
        CLIENT_ORIGIN: `http://localhost:${WEB_PORT}`,
        AUTH_RATE_LIMIT_MAX: "1000",
        LOG_LEVEL: "warn"
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: `npm run preview -- --port ${WEB_PORT} --strictPort`,
      cwd: "../client",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
});
