# P0-01 Scaffold the server Worker and the workspace

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | infra |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `kiko/p0-01-scaffold-the-server-worker-and-the-workspace` |

## Verification

`bun dev:server` starts and `curl localhost:8787/api/health` returns `{"ok":true}`. `bunx wrangler deploy --dry-run` succeeds in `apps/server`.

## Task

**Goal.** Create `apps/server` as one Worker with every binding the architecture names, so later tasks add code and never touch the root config.

**Read first.** Architecture sections 3, 4, and 20.

**Files.** Create `apps/server/` (`wrangler.jsonc`, `src/index.ts`, `src/user/user-do.ts`, `src/room/room-do.ts`, `src/agent/agent-do.ts`, `package.json`, `tsconfig.json`). Edit the root `package.json`.

**Build.**

- Set root `workspaces` to `apps/*` and `packages/*`. Add root scripts `dev:server`, `dev:web`, `typecheck`, `test`, `kiko`, and `plan`.
- Declare three SQLite-backed Durable Object classes (`UserDO`, `RoomDO`, `AgentDO`) as empty classes with a migration tag.
- Declare bindings for D1 (`AUTH_DB`), R2 (`FILES`), KV (`PREVIEWS`), one queue (`JOBS`), and static assets that point at `apps/web-solid/dist`.
- Turn on `nodejs_compat`. Add `.dev.vars.example` with `OPENCODE_API_KEY`, `CREDENTIALS_KEK`, and `BETTER_AUTH_SECRET`. Add `.dev.vars` to `.gitignore`.
- Add `GET /api/health`.

**Done when.** Every binding resolves under `wrangler dev` and typecheck passes. No secret value is in git.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
