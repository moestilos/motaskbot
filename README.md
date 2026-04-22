# MoTaskBot

Mini AI task orchestrator. Web dashboard creates tasks → Supabase stores them → local Node worker picks them up → Claude executes them → results stream back to the dashboard in realtime.

## Stack

- **Frontend**: Astro 5 + Tailwind CSS (dark theme, Linear/Vercel-style)
- **Backend central**: Supabase (PostgreSQL + Realtime + RLS)
- **Worker**: Node.js + Supabase Realtime subscription + polling fallback
- **AI**: Anthropic Claude — supports both Anthropic API (`@anthropic-ai/sdk`) and Claude Code CLI subprocess

## Architecture

```
┌────────────┐      insert/update       ┌──────────────┐
│  Astro Web │ ───────────────────────▶ │   Supabase   │
│ (browser)  │ ◀─────────────────────── │ Postgres+RT  │
└────────────┘     realtime events      └──────┬───────┘
                                               │ realtime/poll
                                               ▼
                                        ┌──────────────┐
                                        │ Local worker │
                                        │ (Node + TS)  │
                                        └──────┬───────┘
                                               │ spawn / API
                                               ▼
                                        ┌──────────────┐
                                        │   Claude     │
                                        └──────────────┘
```

## Folder structure

```
/apps
  /web       Astro dashboard (deploy to Vercel)
  /worker    Local Node worker (long-running on your PC)
/shared      Types + Supabase client (workspace package)
/scripts
  e2e-test.mjs  End-to-end smoke test
```

## Data model

- `projects (id, name, created_at)`
- `chats (id, project_id, name, context jsonb, created_at)`
- `tasks (id, project_id, chat_id, title, instructions, status enum, result, error, created_at, updated_at)`

`task_status` enum: `pending | running | completed | failed`.

Realtime is enabled for all three tables. RLS is permissive (anon full access) for the MVP — lock this down once you add auth.

## Setup

### 1. Supabase

A project has already been provisioned: **`motaskbot`** (`mxjsekkttedkaxonlpit`, region `eu-west-1`).
Schema is migrated, realtime enabled. See `.env` (already populated with the URL + anon key).

> **Security note**: The worker is configured to use the `anon` key by default because the MCP that provisioned this project does not expose the `service_role` secret. When you're ready for production, grab the `service_role` key from the Supabase dashboard (Project Settings → API) and replace `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Then tighten RLS to forbid `anon` writes.

### 2. Install dependencies

```bash
npm install
```

This installs everything for all workspaces (`apps/web`, `apps/worker`, `shared`).

### 3. Claude backend — pick one

**Option A — Anthropic API** (recommended, no CLI dependency):
```
ANTHROPIC_API_KEY=sk-ant-...
```
Worker uses `claude-sonnet-4-6` by default.

**Option B — Claude Code CLI** (leave `ANTHROPIC_API_KEY` empty):
```
CLAUDE_CLI=claude   # or absolute path to the claude binary
```
Worker will `spawn('claude', ['-p', prompt, '--output-format', 'text'])` per task. Uses your local Claude Code login — no API key needed.

### 4. Run it

Two terminals:

```bash
# Terminal 1 — web dashboard
npm run dev:web
# → http://localhost:4321

# Terminal 2 — worker
npm run dev:worker
```

### 5. Test end-to-end

```bash
npm run e2e
```

Creates a project/chat/task, verifies realtime, and (if the worker is running) waits up to 60s for the task to be processed. Cleans up after itself.

## Deployment

- **Web**: `cd apps/web && vercel`. Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in Vercel env.
- **Worker**: designed to run locally on your PC (or any long-running Node host). Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and either `ANTHROPIC_API_KEY` or `CLAUDE_CLI`.

## Worker behaviour

- On start: `drainPending()` claims all `status='pending'` tasks via an atomic update.
- Subscribes to `INSERT` events on `tasks` — new tasks process instantly.
- Polls every `WORKER_POLL_INTERVAL_MS` (default 5000ms) as a safety net if realtime drops.
- Per task: flip to `running` → fetch chat context → call Claude → store `result` and append to chat `context` JSONB → flip to `completed`. On error: store `error` and flip to `failed`.
- Claiming is atomic (`UPDATE ... WHERE status='pending'`) so multiple workers can run safely.

## Scripts

| Command            | Action                                  |
|--------------------|-----------------------------------------|
| `npm run dev:web`    | Start Astro dev server (port 4321)    |
| `npm run dev:worker` | Start worker with tsx watch           |
| `npm run build:web`  | Build Astro for production            |
| `npm run worker`     | Run worker (no watch)                 |
| `npm run e2e`        | End-to-end smoke test                 |
