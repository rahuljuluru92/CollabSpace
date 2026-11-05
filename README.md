# CollabSpace

A real-time collaborative workspace: sign up, create shared text workspaces,
invite teammates by email, and edit together with live presence, remote
cursors and an activity log. (The UI is branded "SyncSpace".)

- **client/** – React 18 + Vite + Tailwind single-page app
- **server/** – Express 5 + Socket.IO + Mongoose (MongoDB) API
- **e2e/** – Playwright end-to-end tests (two browsers editing together)

## Getting started

Prerequisites: Node.js 20.19+ (or 22.12+) and a MongoDB instance (local or Atlas).

```bash
# 1. Server
cd server
cp .env.example .env      # set MONGO_URI and JWT_SECRET
npm install
npm run dev               # http://localhost:3001

# 2. Client (in another terminal)
cd client
cp .env.example .env      # points at the server URL
npm install
npm run dev               # http://localhost:5173
```

Every workspace has its own link (`/#/w/<id>`), so you can share or bookmark it.

### Environment variables (server)

| Variable                    | Required      | Description                                                                                 |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `MONGO_URI`                 | yes           | MongoDB connection string                                                                   |
| `JWT_SECRET`                | yes           | Secret used to sign login tokens (≥ 32 chars in production)                                 |
| `CLIENT_ORIGIN`             | in production | Comma-separated allowed browser origins. Defaults to `http://localhost:5173` in development |
| `PORT`                      | no            | Defaults to `3001`                                                                          |
| `NODE_ENV`                  | no            | Set to `production` to enable strict config checks and `trust proxy`                        |
| `LOG_LEVEL`                 | no            | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal` or `silent`                    |
| `AUTH_RATE_LIMIT_MAX`       | no            | Login/register attempts per IP per window. Defaults to `20`                                 |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no            | Rate-limit window. Defaults to `900000` (15 minutes)                                        |

The server refuses to start if required variables are missing or unsafe.

### Environment variables (client)

| Variable          | Description                                 |
| ----------------- | ------------------------------------------- |
| `VITE_API_URL`    | Server URL for REST calls                   |
| `VITE_SOCKET_URL` | Server URL for Socket.IO (usually the same) |

These are baked in at build time, so set them in your hosting provider before building.

## Scripts

| Where  | Command                                                                        | What it does                                             |
| ------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| server | `npm run dev`                                                                  | Start with auto-reload and readable logs                 |
| server | `npm run build && npm start`                                                   | Compile to `dist/` and run                               |
| server | `npm test`                                                                     | Unit + REST + Socket.IO integration tests                |
| server | `npm run test:unit`                                                            | Unit tests only (no database needed)                     |
| server | `npm run typecheck`                                                            | Type-check source and tests                              |
| client | `npm run dev`                                                                  | Vite dev server                                          |
| client | `npm run build`                                                                | Type-check and build to `dist/`                          |
| client | `npm test`                                                                     | Vitest unit tests (sync engine, text merge, router, ...) |
| both   | `npm run lint`                                                                 | ESLint (warnings fail)                                   |
| both   | `npm run format`                                                               | Format with Prettier (`format:check` to verify)          |
| e2e    | `npx playwright test`                                                          | End-to-end tests (see below)                             |
| client | `npx tsx scripts/simulate_ghost.ts <workspaceId> <ownerEmail> <ownerPassword>` | Adds a fake member whose cursor moves around             |

The server integration tests use `TEST_MONGO_URI` if set (CI uses a MongoDB
service container); otherwise they start an in-memory MongoDB via
`mongodb-memory-server-core`, which downloads a `mongod` binary on first run.

### End-to-end tests

```bash
cd server && npm run build
cd ../client && VITE_API_URL=http://localhost:3101 VITE_SOCKET_URL=http://localhost:3101 npm run build
cd ../e2e && npm install && npx playwright install chromium
E2E_MONGO_URI=mongodb://localhost:27017 npx playwright test
```

Playwright starts the server (port 3101, a fresh database) and the client
preview (port 4173) itself.

CI (`.github/workflows/ci.yml`) runs lint, formatting, type checks, all tests,
builds and a dependency audit for both apps, then the end-to-end tests.

## Production notes

- **Health checks:** `GET /health` is a liveness check. `GET /health/ready`
  returns 503 until MongoDB is connected and while shutting down. Point your
  host's health check (e.g. Render) at `/health/ready`.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server refuses new edits
  (clients retry them), lets edits already received finish, then closes
  connections and exits (10 s limit). Deploys don't lose edits.
- **Logs:** structured JSON (pino), one line per request with an
  `X-Request-Id` (taken from the caller or generated, and echoed back).
  Authorization headers and passwords are never logged.
- **Security:** helmet security headers, strict CORS, rate limits on login,
  register and every socket event type, validated input, size limits
  (200,000 characters per document).
- **Deploys:** the client and server sync protocol evolves together; deploy
  both from the same commit.

## How syncing works

- Each workspace has a `content` string and a `version` number.
- The client (`client/src/lib/docSync.ts`) sends an edit after a short pause in
  typing (150 ms) with the version it is based on and a random edit id. Only
  one edit is in flight at a time.
- The server applies an edit with a single atomic compare-and-set
  (`findOneAndUpdate({ _id, version, member })`), so two concurrent writers can
  never both succeed. The loser gets a `conflict` ack with the latest text.
- On a conflict or another user's edit, the client rebases its unsent text onto
  the server's with a small three-way merge (`client/src/lib/textMerge.ts`)
  instead of discarding it, and keeps the caret in place.
- If an ack is lost (timeout or dropped connection), the client reconnects and
  names the unconfirmed edit id in its join. The server keeps the last 20 edit
  ids per workspace and replies whether that edit was applied, so it is
  neither lost nor applied twice.
- The server handles each workspace's joins and edits one at a time, so every
  client receives that workspace's events in version order.

This is whole-document optimistic concurrency with a simple merge, which works
well for a few people editing. For heavy simultaneous editing of the same
passage, a CRDT such as [Yjs](https://yjs.dev) would be the next step.

### Running more than one server instance

Presence, the per-workspace ordering above, and the rate limiters are kept in
memory, so the server is designed to run as a **single instance**. Edits stay
correct with several instances (the database compare-and-set guarantees that),
but presence, event ordering and rate limits would need shared state, e.g. the
Socket.IO Redis adapter and a Redis-backed rate limiter.

## Socket events

| Client → server    | Payload                                            | Notes                                                                                                                                                                     |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace:join`   | `{ workspaceId, pendingEditId? }`                  | Members get `workspace:sync`; others get `workspace:removed`                                                                                                              |
| `workspace:update` | `{ workspaceId, content, version, editId? }` + ack | Ack: `{ ok: true, version }`, `{ ok: false, reason: "conflict", content, version }`, or `{ ok: false, reason }` where `rate_limited` / `unavailable` mean "retry shortly" |
| `cursor:update`    | `{ workspaceId, cursor: { x, y } \| null }`        | Only after joining                                                                                                                                                        |
| `workspace:leave`  | `{ workspaceId }`                                  |                                                                                                                                                                           |

| Server → client     | Payload                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `workspace:sync`    | `{ workspaceId, content, version, updatedAt, activity[], activityCursor, pendingEditId?, pendingEditApplied? }` |
| `workspace:update`  | `{ workspaceId, content, version, userId }` (sent to other members)                                             |
| `activity:new`      | `{ workspaceId, activity }` as entries are recorded                                                             |
| `presence:update`   | `{ workspaceId, users[] }` (one entry per user)                                                                 |
| `cursor:update`     | `{ userId, cursor }`                                                                                            |
| `workspace:removed` | `{ workspaceId }` when the workspace is deleted, you leave it, or you join one you can't access                 |

## REST API

All `/api/workspaces` routes need `Authorization: Bearer <token>`. List
endpoints are paginated: pass the `nextCursor` from one page to get the next.

| Method | Path                                          | Description                                                   |
| ------ | --------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/auth/register`                          | `{ name, email, password }` (password ≥ 8 chars)              |
| POST   | `/api/auth/login`                             | `{ email, password }`                                         |
| GET    | `/api/workspaces?limit=&cursor=`              | Your workspaces, newest first, with a short `preview` of each |
| POST   | `/api/workspaces`                             | `{ name }`                                                    |
| GET    | `/api/workspaces/:id`                         | The full workspace, including `content`                       |
| GET    | `/api/workspaces/:id/activity?limit=&before=` | Activity, newest first                                        |
| POST   | `/api/workspaces/:id/invite`                  | `{ email }` (owner only)                                      |
| DELETE | `/api/workspaces/:id`                         | Owner deletes; a member leaves                                |

Auth endpoints are rate-limited per IP (20 requests per 15 minutes by default).
