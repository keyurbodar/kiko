---
name: verify-kiko-server
description: "Drive the kiko backend (Worker and Durable Objects) the way a user does, using the kiko CLI against wrangler dev. Use for 'verify the server', 'check the backend', or before claiming a backend task works."
---

# Verify kiko server

The driver is the kiko CLI. It speaks the same protocol as the client. For the frontend, use `verify-kiko`.

## Start the server

From the repo root. Pick a free port. Do not leave it running.

```bash
NODE_ENV=development bun run --cwd apps/server dev --port 8787 --inspector-port 9229
```

```bash
cd apps/server && bunx wrangler d1 migrations apply kiko-auth --local --persist-to <dir>
```

`verify-parallel.sh` runs this against its own state. `apps/server/.dev.vars` is a symlink to `~/.config/yuki/dev.vars`, added by a git hook. If it is missing, link it by hand.

Set `KIKO_URL=http://localhost:<your port>` to point every command at your own server; the CLI prints `kiko: target <url>` on its first line, and `--url` overrides it per command.

If the inspector port 9229 is taken, pass another `--inspector-port` and `--url http://localhost:<port>` to every command.

The Worker serves the client from `apps/web-solid/dist`. A fresh worktree has none, so run `bun run --cwd apps/web-solid build` once before the server, or wrangler reports the assets directory is missing. To stop a server you started, use its recorded PID (see Cleanup). Never kill whatever holds the port.

## Check it is up

```bash
bun kiko health --url http://localhost:8787
```

## Sign in

```bash
export KIKO_SESSION_FILE=/tmp/kiko-session-$USER.json   # keeps sessions apart, outside the repo
bun kiko login --dev --name alice --url http://localhost:8787
bun kiko whoami --url http://localhost:8787
```

The dev login only works with `NODE_ENV=development`. Never print key values.

## Run suites

```bash
bun kiko verify --list                                  # all suites
bun kiko verify <suite> --url http://localhost:8787     # one suite
bun kiko verify --no-model --url http://localhost:8787  # none that need a model key
```

Show the output. A passing unit test is not a pass.

## Where suites live

Suites are in `apps/cli/src/verify/suites/<name>.ts`. Each default-exports `{ name, model?, human?, run(v) }`. Set `model: true` if it calls a model. Set `human: true` if it needs a person; the runner skips it unless it is named. In `run`: `const s = await v.as("alice")`, `const room = await s.room(id)`, `room.send(text)`, `room.expect(match, ms)`, `(await s.user()).expect(...)`.

## Doctor

Read-only. Run it before any verify. It changes nothing.

```bash
# 1. Is the port free, or held by a PID we started?
lsof -nP -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || ss -ltnp "sport = :8787"
# If a PID prints, compare it with the one we recorded in .verify-evidence/<run>/<suite>/wrangler.pid.
# A match is ours. No match: stop, report it, do not kill it.

# 2. Is the Worker up?
bun kiko health --url http://localhost:8787

# 3. Is the session valid? (a fresh login is needed if this fails)
bun kiko whoami --url http://localhost:8787
```

Pass: no port holder, or a holder whose PID matches our record; health exits 0; whoami names the user.

## Parallel runs

Give every run its own server and port, so no run reads or resets another run's state. Other sessions may run servers at the same time.

On your own: start your server on a port nobody else holds (`--port <n>`), run `bun kiko verify <suite> --url http://localhost:<n>`, and stop only the PID you started. Suites that read or reset the dev counters (`latency` reads `/api/dev/stats`) need a server to themselves, so never point two runs at one server.

To run several suites at once, use `scripts/verify-parallel.sh` (inside this skill folder). It does the work:

- suite `i` gets HTTP port `8811+i` and inspector port `9311+i`
- each server runs from `apps/server` with `NODE_ENV=development`, its own `--persist-to` state, and its own session file in a temp dir
- it applies D1 migrations, waits for `bun kiko health`, runs `bun kiko verify <suite>`, then kills only the PID it started (and that PID's children)

Invoke it from the repo root:

```bash
bash .cursor/skills/verify-kiko-server/scripts/verify-parallel.sh agents bash files
```

Target: the whole run under 10 minutes. Each suite has a 540 s cap (`VERIFY_SUITE_LIMIT`); a suite that hits it is killed and reported as a fail. Suites marked `human: true` must run alone, by name; the script refuses them in a batch. Suites that share a key (for example `KERNEL_API_KEY`) should run in separate calls.

## Evidence

Every run writes to `.verify-evidence/<run-id>/<suite>/` at the repo root:

- `verify.log`: the suite's output (the pass or fail line is the proof)
- `wrangler.log`, `migrate.log`, `health.log`: the server side
- `wrangler.pid`: the PID the helper started, used by Cleanup

`.verify-evidence/` is git-ignored (see `.gitignore`). Cleanup never deletes it. The session file is kept in a temp dir and removed; it is not in the evidence directory.

Show the verify output in the final report; name the evidence directory it came from.

## Cleanup

```bash
bash .cursor/skills/verify-kiko-server/scripts/verify-parallel.sh --cleanup
```

This stops only the PIDs recorded in `.verify-evidence/*/*/wrangler.pid`, and their children. It leaves the evidence in place. Run it after every failed attempt so no server or port is left behind. For a single manual server, stop the PID you started: `kill <pid>`.

## The rule

A task that changes backend behavior adds or extends its suite in the same pull request. It also adds a feature file in `features/` named after the suite, and a row in the map below.

## Map

| Suite or command | Feature file |
| --- | --- |
| `kiko health`, `selftest` | [health](./features/health.md) |
| `agents`, `team-ask`, `team-flow`, `team-routing`, `team-loops`, `team-model`, `team-race`, `hardcore` | [agents](./features/agents.md) |
| `mid-run`, `mid-run-model`, `burst-backlog`, `team-priority` | [mid-run](./features/mid-run.md) |
| `stop-window` | [stop-window](./features/stop-window.md) |
| `workers`, `workers-model` | [workers](./features/workers.md) |
| `chats`, `activity` | [chats](./features/chats.md) |
| `long-text` | [long-text](./features/long-text.md) |
| `chief` | [chief](./features/chief.md) |
| `workspace` | [workspace](./features/workspace.md) |
| `reactions` | [reactions](./features/reactions.md) |
| `search`, `room-search` | [search](./features/search.md) |
| `room-sync`, `user-sync`, `turn` | [room-sync](./features/room-sync.md) |
| `files`, `file-tools`, `attachments` | [files](./features/files.md) |
| `bash` | [bash](./features/bash.md) |
| `browser`, `browser-run`, `kernel`, `browser-takeover` | [browser](./features/browser.md) |
| `composio`, `composio-extension` | [composio](./features/composio.md) |
| `fanout` | [fanout](./features/fanout.md) |
| `skills` | [skills](./features/skills.md) |
| `routines`, `reminders`, `routine-triggers`, `routines-model`, `routines-scale` | [routines](./features/routines.md) |
| `credentials`, `byok`, `provider-login` | [account](./features/account.md) |
| `overhead`, `token-cost`, `latency`, `latency-model` | [limits](./features/limits.md) |
| `memory-jev` | [memory-jev](./features/memory-jev.md) |
| `memory-edge` | [memory-edge](./features/memory-edge.md) |
| `memory-tools`, `memory-session`, `memory-eval`, `memory-hard`, `soul` | [memory](./features/memory.md) |
| `proactive` | [proactive](./features/proactive.md) |
| `initiative`, `initiative-loops` | the `verify-initiative` skill |

Themes (`apps/server/src/user/theme.ts`) have no suite; `apps/server/test/user.test.ts` covers sync across sockets, snapshots and refused text.
