---
name: verify-initiative
description: "Prove Yuki's proactive behavior (reminders, initiative nudges, Jev memory capture, background cost) end to end with REAL models, no fakes: boots wrangler dev, signs in a dev user, stores OpenCode Go and TypeSafe keys through the credentials route, drives the human through the CLI client, and captures evidence. Use for 'verify initiative', 'A/B Jev', 'does the agent follow up', or before claiming proactive work behaves."
---

# Verify initiative

Builds on `verify-yuki-server` (same CLI client and dev server). Real models only: the suites in `apps/cli/src/verify/suites/proactive.ts` use fakes; this skill does not. Spends tokens, so keep scenarios short. Never print or commit a key.

## Launch

```bash
.cursor/skills/verify-initiative/scripts/server.sh start    # builds apps/web-solid once if dist is missing, starts bun dev:server, waits for /api/health
.cursor/skills/verify-initiative/scripts/server.sh doctor   # health, dev routes (HTTP 200), port owner, key presence
.cursor/skills/verify-initiative/scripts/server.sh stop     # when done
```

`start` refuses if something already answers on 8787 (another worktree's server): drive that one or set `YUKI_URL=http://localhost:<your port>`. When `YUKI_URL` is set, every `server.sh` action and every `bun yuki` command targets your own server, and the CLI prints `yuki: target <url>` on its first line. It also needs `apps/server/.dev.vars`, the symlink a git hook adds; it fails without it. Log and pid are in `artifacts/initiative/` (git ignores `artifacts/`). Run `doctor` first whenever anything looks off.

## Models and keys

- Agent model: provider `opencode-go`, model id `muse-spark-1.3-contributor` (display name "Muse Spark 1.3 Contributor"). This is `DEFAULT_MODEL` in `apps/server/src/agent/factory.ts`; connecting the provider is enough, no per-agent override.
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

Smoke: `bun .cursor/skills/verify-initiative/scripts/smoke.ts [--jev]`. `silent-ab.ts <label>` runs the silent-loop measurement the same way. The attention engine has its own suite: `bun yuki verify initiative` (model; `INITIATIVE_MODE=jev|nojev` picks one arm, default both; the Jev arm is skipped without `TYPESAFE_API_KEY`; `INITIATIVE_ONLY=a,b,...` picks scenarios). It prints a `background tokens` line per arm. For an A/B, run the same scenario with and without `--jev` and compare those lines.

### Dev routes that exist (NODE_ENV=development, localhost only), all `POST /api/dev/agent/<name>`

Useful here: `attention {action}` (the initiative engine: `rhythm` with `mode: now` makes the human usually write at this hour, `age` with `ms` moves loops, due times, rests, pending nudges, and an agent's own reminders into the past, `pass` runs the attention pass now and returns its verdicts and wakes, `state` reads rhythm, appetite, marks, wakes), `usage {roomId, slug?}`, `policy {policy}`, `age {roomId, ms}` (ages open tasks and reports them to UserDO, for stalled-task candidates), `seen {ago}` (human last seen; a week holds unasked runs), `budget {roomId, ms}` (budget for unasked runs), `due {id}` (routine due now), `pending`, `limits`. Also `loops`, `quiet`, `initiative`, `workers`, `composio`, `browser` (the last one is `{action}`: `lease`, `touch`, `dead`, `age`, `reap`, `switch`, `state`). Fake-agent and inspection routes: `fake`, `status`, `seed` (log turns with no run), `memory`, `classic`, `trace`. Also `GET /api/dev/stats`, `POST /api/reminders/<id>/rewind`.

### Gaps an initiative suite will hit

- `attention {action: "age"}` fires an agent's own reminders that would have come due; a reminder for the human still cannot be moved earlier.
- No route ages memory lines or the life log (for staleness or "follow up on a stated deadline" behavior).
- `usage` memory counters are cumulative per user; take a before and after, or use a fresh user per arm.

## Evidence

Each `save` lands in `artifacts/initiative/<timestamp>-<name>/` (transcript, lifelines, usage, reminders, routines JSON). Proof standard: real user path (CLI client sockets and credentials route), the agent's actual bubbles, and the side effects (life lines, reminders, counters) read back, not just the reply. Cleanup removes the server, never the artifacts.

## Cleanup

`server.sh stop` kills the PID in `artifacts/initiative/server.pid` and its children, and nothing else. It never touches another process on the port, so it cannot stop another session's server. Dev users and rooms stay in local wrangler state, which is fine.

Features: [features/README.md](./features/README.md).
