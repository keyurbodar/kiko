---
name: verify-yuki-server
description: "Drive the yuki backend (Worker and Durable Objects) the way a user does, using the yuki CLI against wrangler dev. Use for 'verify the server', 'check the backend', or before claiming a backend task works."
---

# Verify yuki server

The driver is the yuki CLI. It speaks the same protocol as the client. For the frontend, use `verify-yuki`.

## Start the server

From `apps/server`. Pick a free port. Do not leave it running.

```bash
cp ~/.config/yuki/dev.vars .dev.vars        # once, git ignores it
bunx wrangler d1 migrations apply kiko-auth --local   # once
NODE_ENV=development bunx wrangler dev --port 8787 --inspector-port 9229
```

If the inspector port 9229 is taken, start wrangler with `--port 8790 --inspector-port 9240` and pass `--url http://localhost:8790` to every command.

If wrangler complains about the assets directory, run `bun run build` in `apps/web-solid`. To stop a server you started, use its recorded PID (see Cleanup). Never kill whatever holds the port.

## Check it is up

```bash
bun yuki health --url http://localhost:8787
```

## Sign in

```bash
export YUKI_SESSION_FILE=$PWD/.yuki-session   # keeps sessions apart
bun yuki login --dev --name alice --url http://localhost:8787
bun yuki whoami --url http://localhost:8787
```

The dev login only works with `NODE_ENV=development`. Never print key values.

## Run suites

```bash
bun yuki verify --list                                  # all suites
bun yuki verify <suite> --url http://localhost:8787     # one suite
bun yuki verify --no-model --url http://localhost:8787  # none that need a model key
```

Show the output. A passing unit test is not a pass.

## Where suites live

Suites are in `apps/cli/src/verify/suites/<name>.ts`. Each exports `{ name, model?, run(v) }`. Set `model: true` if it calls a model. In `run`: `const s = await v.as("alice")`, `const room = await s.room(id)`, `room.send(text)`, `room.expect(match, ms)`, `(await s.user()).expect(...)`.

## Doctor

Read-only. Run it before any verify. It changes nothing.

```bash
# 1. Is the port free, or held by a PID we started?
lsof -nP -iTCP:8787 -sTCP:LISTEN -t
# If a PID prints, compare it with the one we recorded in .verify-evidence/<run>/<suite>/wrangler.pid.
# A match is ours. No match: stop, report it, do not kill it.

# 2. Is the Worker up?
bun yuki health --url http://localhost:8787

# 3. Is the session valid? (a fresh login is needed if this fails)
bun yuki whoami --url http://localhost:8787
```

Pass: no port holder, or a holder whose PID matches our record; health exits 0; whoami names the user.

## Parallel run

Run several suites at once, each on its own `wrangler dev` server. `scripts/verify-parallel.sh` (inside this skill folder) does the work:

- suite `i` gets HTTP port `8811+i` and inspector port `9311+i`
- each server runs from `apps/server` with `NODE_ENV=development`, its own `--persist-to` state, and its own session file in a temp dir
- it applies D1 migrations, waits for `bun yuki health`, runs `bun yuki verify <suite>`, then kills only the PID it started (and that PID's children)

Invoke it from the repo root:

```bash
bash .cursor/skills/verify-yuki-server/scripts/verify-parallel.sh agents bash files browser-run
```

Target: the whole run under 10 minutes. Each suite has a 540 s cap (`VERIFY_SUITE_LIMIT`); a suite that hits it is killed and reported as a fail. Do not run suites that need a person (`human: true`) in parallel; run those by name, alone. Suites that share a key (for example `KERNEL_API_KEY`) should run in separate calls.

## Evidence

Every run writes to `.verify-evidence/<run-id>/<suite>/` at the repo root:

- `verify.log`: the suite's output (the pass or fail line is the proof)
- `wrangler.log`, `migrate.log`, `health.log`: the server side
- `wrangler.pid`: the PID the helper started, used by Cleanup

`.verify-evidence/` is git-ignored (see `.gitignore`). Cleanup never deletes it. The session file is kept in a temp dir and removed; it is not in the evidence directory.

Show the verify output in the final report; name the evidence directory it came from.

## Cleanup

```bash
bash .cursor/skills/verify-yuki-server/scripts/verify-parallel.sh --cleanup
```

This stops only the PIDs recorded in `.verify-evidence/*/*/wrangler.pid`, and their children. It leaves the evidence in place. Run it after every failed attempt so no server or port is left behind. For a single manual server, stop the PID you started: `kill <pid>`.

## The rule

A task that changes backend behavior adds or extends its suite in the same pull request. It also adds a feature file in `features/` named after the suite, and a row in the map below.

## Map

| Suite or command | Feature file |
| --- | --- |
| `yuki health` | [health](./features/health.md) |
| `composio` | [composio](./features/composio.md) |
| `memory-jev` | [memory-jev](./features/memory-jev.md) |
| `memory-edge` | [memory-edge](./features/memory-edge.md) |
| `memory-isolation` | [memory-isolation](./features/memory-isolation.md) |
| `agents`, `team-ask`, `team-flow`, `team-routing`, `team-loops` | [agents](./features/agents.md) |
| `bash` | [bash](./features/bash.md) |
| `files`, `file-tools`, `attachments` | [files](./features/files.md) |
| `browser`, `browser-run`, `kernel` | [browser](./features/browser.md) |
| `routines`, `reminders`, `routine-triggers` | [routines](./features/routines.md) |
| `extensions` | [extensions](./features/extensions.md) |
| `room-sync`, `user-sync` | [room-sync](./features/room-sync.md) |
| `fanout` | [fanout](./features/fanout.md) |
| `selftest` | runner self check, no feature file |
