# P0-04 Scaffold the kiko CLI

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-04-scaffold-the-kiko-cli` |

## Verification

`bun kiko health --url http://localhost:8787` prints `ok` and exits 0. It exits 1 when the server is down.

## Task

**Goal.** Create the command that every backend task uses to prove its work.

**Read first.** Architecture section 20.

**Files.** Create `apps/cli/` (`src/main.ts`, `src/commands/health.ts`, `src/commands/ws.ts`, `package.json`).

**Build.**

- Parse `kiko <command> [flags]` with a `--url` flag that defaults to the local dev server and a `--json` flag for machine output.
- Add `health`, and `ws <path>`, which opens a WebSocket, sends frames from stdin, and prints frames it receives as JSON lines.
- Exit non-zero on any failure, with one line that says what failed.

**Done when.** The two commands work against `wrangler dev`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
