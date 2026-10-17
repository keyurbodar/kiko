---
name: verify-initiative
description: "Prove Kiko's proactive behavior (reminders, initiative nudges, Jev memory capture, background cost) end to end with REAL models, no fakes: boots wrangler dev, signs in a dev user, stores OpenCode Go and TypeSafe keys through the credentials route, drives the human through the CLI client, and captures evidence. Use for 'verify initiative', 'A/B Jev', 'does the agent follow up', or before claiming proactive work behaves."
---

# Verify initiative

Builds on `verify-kiko-server` (same CLI client and dev server). Real models only: the suites in `apps/cli/src/verify/suites/proactive.ts` use fakes; this skill does not. Spends tokens, so keep scenarios short. Never print or commit a key.

## Launch

```bash
.cursor/skills/verify-initiative/scripts/server.sh start    # builds apps/web-solid once if dist is missing, starts bun dev:server, waits for /api/health
.cursor/skills/verify-initiative/scripts/server.sh doctor   # health, dev routes (HTTP 200), port owner, key presence
.cursor/skills/verify-initiative/scripts/server.sh stop     # when done
```

`start` refuses if something already answers on 8787 (another worktree's server): drive that one or set `KIKO_URL=http://localhost:<your port>`. When `KIKO_URL` is set, every `server.sh` action and every `bun kiko` command targets your own server, and the CLI prints `kiko: target <url>` on its first line. It also needs `apps/server/.dev.vars`, the symlink a git hook adds; it fails without it. Log and pid are in `artifacts/initiative/` (git ignores `artifacts/`). Run `doctor` first whenever anything looks off.

## Models and keys

- Agent model: provider `opencode-go`, model id `muse-spark-1.3-contributor` (display name "Muse Spark 1.3 Contributor"), or `KIKO_TEST_MODEL`. Kiko has no default model, so `connectTestModel` connects the provider and then picks Kiko's model, as the human does.
- Jev judge: provider id `typesafe`, key `TYPESAFE_API_KEY`.
- `kit.ts` reads both from the shell or `apps/server/.dev.vars` and stores them with `PUT /api/credentials/<provider>` (`connectTestModel`, `connectProvider`). Without the typesafe credential there is no judge; capture `auto` then costs nothing.

## Drive

Write a scenario in `scripts/` that imports `./kit` (run with `bun`, from the repo root):

| Kit call | What it does |
| --- | --- |
| `setup({ name, jev, policy? })` | dev login, connect opencode-go, Jev on/off, sets `memory_policy` (batch 2, idle 3 s, jev delay 1 s) |
| `setJev(ctx, on)` | toggle mid-run: PUT or DELETE the typesafe credential |
| `openChat(ctx, title)` / `say(room, text)` | new room; human message, waits for the agent idle, returns the agent's bubbles |
| `transcript(room)` | full room log (human, agent, system) |
| `lifeLines(ctx)` | memory `list` over the user socket (source "you" = captured, "@slug" = agent note) |
| `reminders(ctx)` / `routines(url, s)` | `GET /api/reminders`; routines and runs |
| `usage(ctx, room)` | `{ agent, memory }`; `memory` is the `MEMORY_USAGE` counters (capture_model, capture_jev, jev_input, jev_output, jev_errors, facts_replaced...) |
| `background(memory)` | sum of background input and output tokens, for cost A/B |
| `age(ctx, room, ms)` / `seen(ctx, ago)` / `due(ctx, id)` | dev routes below |
| `save(ctx, name, data)` | writes JSON evidence |

Smoke: `bun .cursor/skills/verify-initiative/scripts/smoke.ts [--jev]`. `silent-ab.ts <label>` runs the silent-loop measurement the same way. Loops from real bursts have a suite: `bun kiko verify initiative-loops` (model; `INITIATIVE_MODE=jev|nojev` picks one arm, default both; the Jev arm is skipped without `TYPESAFE_API_KEY`). For a cost A/B, run `smoke.ts` with and without `--jev` and compare the `background tokens` lines.

### Dev routes that exist (NODE_ENV=development, localhost only), all `POST /api/dev/agent/<name>`

Useful here: `pass` (runs the daily initiative pass now and returns what it woke and which loops it expired), `usage {roomId, slug?}`, `policy {policy}`, `age {roomId, ms}` (ages open tasks and reports them to UserDO, for stalled-task candidates), `seen {ago}` (human last seen; a week holds unasked runs), `budget {roomId, ms}` (budget for unasked runs), `due {id}` (routine due now), `pending`, `limits`. Also `loops` (`{open: {roomId, text, due}}` opens a human loop with any due date), `initiative`, `workers`, `composio`, `browser` (the last one is `{action}`: `lease`, `touch`, `dead`, `age`, `reap`, `switch`, `state`). Fake-agent and inspection routes: `fake`, `status`, `seed` (log turns with no run), `memory`, `classic`, `trace`. Also `GET /api/dev/stats`, `POST /api/reminders/<id>/rewind`.

### Gaps an initiative suite will hit

- No route ages memory lines or the life log (for staleness or "follow up on a stated deadline" behavior).
- `usage` memory counters are cumulative per user; take a before and after, or use a fresh user per arm.

## What the engine does

Use these rules when a scenario asserts timing. They are in `apps/server/src/initiative/engine.ts`.

- Daily pass. Once a day at 09:00 in the owner's time zone, one open loop that is due or overdue wakes its chat's lead (a loop with no chat goes to the Kiko chat). The oldest due date goes first. A loop nudged in the last 3 days waits.
- Retry. A wake that was busy, gone, or refused tries again in an hour, not a day.
- Stale. An open loop with no due date that nobody mentioned for 30 days closes in the pass.
- Jev failures. A burst gets three Jev passes in all: the first try and two retries, 15 seconds apart (`LOOPS_TRIES` and `LOOPS_DELAY_MS` in `user/initiative-loops.ts`). After the third the burst is let go.

## Evidence

Each `save` lands in `artifacts/initiative/<timestamp>-<name>/` (transcript, lifelines, usage, reminders, routines JSON). Proof standard: real user path (CLI client sockets and credentials route), the agent's actual bubbles, and the side effects (life lines, reminders, counters) read back, not just the reply. Cleanup removes the server, never the artifacts.

## Cleanup

`server.sh stop` kills the PID in `artifacts/initiative/server.pid` and its children, and nothing else. It never touches another process on the port, so it cannot stop another session's server. Dev users and rooms stay in local wrangler state, which is fine.

Features: [features/README.md](./features/README.md).
