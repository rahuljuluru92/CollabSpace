# CollabSpace

A real-time collaborative workspace: sign up, create shared text workspaces,
invite teammates by email, and edit together with live presence, remote
cursors and an activity log. (The UI is branded "SyncSpace".)

- **client/** – React 18 + Vite + Tailwind single-page app
- **server/** – Express 5 + Socket.IO + Mongoose (MongoDB) API

## Getting started

Prerequisites: Node.js 20+ and a MongoDB instance (local or Atlas).

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

### Environment variables (server)

| Variable        | Required          | Description |
| --------------- | ----------------- | ----------- |
| `MONGO_URI`     | yes               | MongoDB connection string |
| `JWT_SECRET`    | yes               | Secret used to sign login tokens (≥ 32 chars in production) |
| `CLIENT_ORIGIN` | in production     | Comma-separated allowed browser origins. Defaults to `http://localhost:5173` in development |
| `PORT`          | no                | Defaults to `3001` |
| `NODE_ENV`      | no                | Set to `production` to enable strict config checks and `trust proxy` |

The server refuses to start if required variables are missing.

## Scripts

| Where   | Command             | What it does |
| ------- | ------------------- | ------------ |
| server  | `npm run dev`       | Start with auto-reload |
| server  | `npm run build && npm start` | Compile to `dist/` and run |
| server  | `npm run typecheck` | Type-check source and tests |
| server  | `npm test`          | Unit + API + Socket.IO integration tests |
| server  | `npm run test:unit` | Unit tests only (no database needed) |
| client  | `npm run dev`       | Vite dev server |
| client  | `npm run build`     | Type-check and build to `dist/` |
| client  | `npm test`          | Vitest unit tests |

The server integration tests use `TEST_MONGO_URI` if set (CI uses a MongoDB
service container); otherwise they start an in-memory MongoDB via
`mongodb-memory-server`, which downloads a `mongod` binary on first run.

## How syncing works

- Each workspace has a `content` string and a `version` number.
- The client sends edits after a short pause in typing (150 ms), with the
  version it last saw, and waits for an acknowledgement before sending again.
- The server applies an edit with a single atomic compare-and-set
  (`findOneAndUpdate({ _id, version, member })`), so two concurrent writers can
  never both succeed. The loser gets a `conflict` ack with the latest content.
- On a conflict, a remote update, or a reconnect, the client rebases its unsent
  edits onto the server's text with a small three-way merge
  (`client/src/lib/textMerge.ts`) instead of discarding them.
- Edits made while offline are resent after reconnecting.

This is whole-document optimistic concurrency with a simple merge, which works
well for a few people editing. For heavy simultaneous editing of the same
passage, a CRDT such as [Yjs](https://yjs.dev) would be the next step.

## Socket events

| Client → server     | Payload | Notes |
| ------------------- | ------- | ----- |
| `workspace:join`    | `{ workspaceId }` | Members only; replies with `workspace:sync` |
| `workspace:update`  | `{ workspaceId, content, version }` + ack | Ack is `{ ok: true, version }` or `{ ok: false, reason }` |
| `cursor:update`     | `{ workspaceId, cursor: { x, y } \| null }` | Only after joining |
| `workspace:leave`   | `{ workspaceId }` | |

| Server → client     | Payload |
| ------------------- | ------- |
| `workspace:sync`    | `{ workspaceId, content, version, updatedAt, activity[] }` |
| `workspace:update`  | `{ workspaceId, content, version, userId }` (sent to other members) |
| `presence:update`   | `{ workspaceId, users[] }` (one entry per user) |
| `cursor:update`     | `{ userId, cursor }` |
| `workspace:removed` | `{ workspaceId }` when the workspace is deleted or you leave it |

## REST API

All `/api/workspaces` routes need `Authorization: Bearer <token>`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST   | `/api/auth/register` | `{ name, email, password }` (password ≥ 8 chars) |
| POST   | `/api/auth/login` | `{ email, password }` |
| GET    | `/api/workspaces` | Workspaces you own or belong to |
| POST   | `/api/workspaces` | `{ name }` |
| GET    | `/api/workspaces/:id` | Workspace + last 25 activity entries |
| POST   | `/api/workspaces/:id/invite` | `{ email }` (owner only) |
| DELETE | `/api/workspaces/:id` | Owner deletes; a member leaves |

Auth endpoints are rate-limited to 20 requests per IP per 15 minutes.
