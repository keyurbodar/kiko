---
name: verify-initiative
description: "Prove Kiko's proactive behavior (reminders, initiative nudges, Jev memory capture, background cost) end to end with REAL models, no fakes: boots wrangler dev, signs in a dev user, stores OpenCode Go and TypeSafe keys through the credentials route, drives the human through the CLI client, and captures evidence. Use for 'verify initiative', 'A/B Jev', 'does the agent follow up', or before claiming proactive work behaves."
---

# Verify initiative

Builds on `verify-kiko` (same CLI client and dev server). Real models only: the `proactive` suite in `apps/cli/src/verify/suites/proactive.ts` uses fakes; this skill does not. Spends tokens, so keep scenarios short. Never print or commit a key.

## Launch

```bash
.cursor/skills/verify-initiative/scripts/server.sh start    # builds apps/web-solid once if dist is missing, starts the dev server, waits for /api/health
.cursor/skills/verify-initiative/scripts/server.sh doctor   # health, dev routes, port owner, key presence
.cursor/skills/verify-initiative/scripts/server.sh stop     # when done
```

`start` refuses if something already answers on 8787 (another worktree's server): drive that one, or set `KIKO_URL=http://localhost:<your port>` and every `server.sh` action and `bun kiko` command targets yours. It needs `apps/server/.dev.vars` and fails without it. Log and pid are in `artifacts/initiative/` (git ignores `artifacts/`). Run `doctor` first whenever anything looks off.

## Models and keys

- Agent model: provider `opencode-go`, model `muse-spark-1.3-contributor`, or `KIKO_TEST_MODEL`. Kiko has no default model, so `connectTestModel` connects the provider and then picks Kiko's model, as the human does.
- Jev judge: provider `typesafe`, key `TYPESAFE_API_KEY`.
- `kit.ts` reads both from the shell or `apps/server/.dev.vars` and stores them with `PUT /api/credentials/<provider>`. Without the typesafe credential there is no judge; capture `auto` then costs nothing.

## Drive

Write a scenario in `scripts/` that imports `./kit` (run with `bun`, from the repo root):

| Kit call | What it does |
| --- | --- |
| `setup({ name, jev, policy? })` | dev login, connect opencode-go, Jev on/off, sets `memory_policy` (batch 2, idle 3 s, jev delay 1 s) |
| `setJev(ctx, on)` | toggle mid-run: PUT or DELETE the typesafe credential |
| `openChat(ctx, title)` / `say(room, text)` | new room; human message, waits for the agent idle, returns its bubbles |
| `transcript(room)` / `lifeLines(ctx)` | full room log; memory `list` over the user socket (source "you" = captured, "@slug" = agent note) |
| `reminders(ctx)` / `routines(url, s)` | `GET /api/reminders`; routines and runs |
| `usage(ctx, room)` / `background(memory)` | `{ agent, memory }` counters; background input plus output tokens, for cost A/B |
| `age(ctx, room, ms)` / `seen(ctx, ago)` / `due(ctx, id)` | dev routes below |
| `save(ctx, name, data)` | writes JSON evidence |

Smoke: `bun .cursor/skills/verify-initiative/scripts/smoke.ts [--jev]`. For a cost A/B, run it with and without `--jev` and compare the `background tokens` lines.

### Dev routes (`NODE_ENV=development`, localhost only), all `POST /api/dev/agent/<name>`

Useful here: `pass` (runs the daily pass now and returns what it woke), `usage {roomId, slug?}`, `policy {policy}`, `age {roomId, ms}` (ages the chat's open tasks and reports the board to UserDO, which is what the pass reads), `seen {ago}`, `budget {roomId, ms}`, `due {id}`, `pending`, `limits`. Also `GET /api/dev/stats` and `POST /api/reminders/<id>/rewind`.

No route ages memory lines or the life log. `usage` memory counters are cumulative per user: take a before and after, or use a fresh user per arm.

## What the engine does

Use these rules when a scenario asserts timing. They are in `apps/server/src/initiative/engine.ts`.

- Each chat reports its open task board to `UserDO.chatTasks` when its tasks change, and the pass reads those rows. A task owned by an agent is raised with that agent; any other goes to the chat's lead.
- Once a day at 09:00 in the owner's time zone, the chat's oldest open task wakes the chat. The oldest change goes first, one chat per pass at `digest` and up to three at `active`. A task raised in the last 3 days waits. A private or deleted chat is skipped.
- A wake that was busy, gone, or refused tries again in an hour.
- Wake ids are `task:<room>:<task>#<day>`, so a second pass the same day is a duplicate, not a second message.

## Evidence

Each `save` lands in `artifacts/initiative/<timestamp>-<name>/`. Proof standard: the real user path (CLI client sockets and the credentials route), the agent's actual bubbles, and the side effects (life lines, reminders, counters) read back, not just the reply. `server.sh stop` kills only the PID in `artifacts/initiative/server.pid` and its children, and never touches the artifacts.
