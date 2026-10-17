---
name: verify-kiko
description: Prove Kiko behavior end to end. Use when a task changes the Kiko web app (SolidJS client in apps/web-solid) or the backend (Worker and Durable Objects in apps/server), or before you claim either works. Drives the web UI with agent-browser and the backend with the bun kiko CLI.
---

# Verify kiko

Two drivers, one proof. Use `agent-browser` to drive the web app the way a person does. Use `bun kiko verify` to drive the backend over the same protocol the client uses. A change is not done until you have run it and shown the output.

Never print a key. Never ask the owner to paste one. Keys live in `~/.config/kiko/dev.vars`, linked from `apps/server/.dev.vars`.

## Launch

Start one run with its own server and client. Each run gets a run id, its own ports, and its own state.

```bash
.cursor/skills/verify-kiko/bin/up.sh [--run-id <id>] [--server-port 8791] [--client-port 5191] [--owner verify-kiko]
```

- Defaults: server `8791`, client `5191`, owner `verify-kiko`, run id from the clock.
- The inspector port is the server port plus 1000.
- `up.sh` refuses a port that already answers, and refuses a run dir that exists. Pick a new `--run-id` or new ports. It never deletes a run.
- It builds `apps/web-solid/dist` once if it is missing (a fresh worktree needs it).
- It waits up to 240 s for `GET /api/health` and the client page. On timeout it stops its own run and prints the log tails.
- It signs in as the dev owner and writes the bearer token to `/tmp/kiko-verify/<run-id>/token` (mode 0600). The token is never printed.
- Everything goes under `/tmp/kiko-verify/<run-id>/`: `env`, `server.log`, `client.log`, `build.log`, the `*.launcher.pid` files, `listeners.pid`, `state/` (wrangler's persisted data), and `evidence/`.

## Doctor

Read-only. Run it before a run, and whenever something looks wrong.

```bash
ss -ltnp "sport = :8791"                       # who holds the port
curl -fsS http://localhost:8791/api/health     # {"ok":true}
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:5191/
cat /tmp/kiko-verify/<run-id>/listeners.pid    # the PIDs this run recorded
```

Pass: the port holder is a PID listed in your run's `listeners.pid`, health answers `{"ok":true}`, and the client returns `200`. A holder you did not start is another session's server. Stop, report it, and do not kill it.

Use `localhost`, not `127.0.0.1`.

## Sign-in

`up.sh` signs in for you. To sign in again, or as another owner, call the dev route:

```bash
curl -fsS -X POST http://localhost:8791/api/auth/dev/session \
  -H 'content-type: application/json' -d '{"name":"verify-kiko"}' | jq -r .token > /tmp/kiko-verify/<run-id>/token
chmod 600 /tmp/kiko-verify/<run-id>/token
```

The route only exists in a development build and only for local hosts. A GET to it redirects to `/#token=<token>`, which is how the browser signs in. The client stores the token from the hash.

Open the browser with the token:

```bash
agent-browser --session kiko-<run-id> open "http://localhost:5191/#token=$(cat /tmp/kiko-verify/<run-id>/token)"
agent-browser --session kiko-<run-id> wait --load networkidle
```

It lands on `/chat/00000000-0000-7000-8000-6b696b6f0000`, Kiko's home chat.

## Model setup

Kiko needs a model key to answer. Connect a provider with the helper. It reads the key from the shell or from `apps/server/.dev.vars`, sends it once, and prints only the status and the check.

```bash
.cursor/skills/verify-kiko/bin/connect-model.sh <run-id> opencode-go
```

Expected output:

```text
PUT /api/credentials/opencode-go -> 200
POST /api/credentials/opencode-go/check -> {"provider":"opencode-go","chat":true,"judge":false}
```

The key variable for OpenCode Go is `OPENCODE_API_KEY`. The raw API is `PUT /api/credentials/<provider>` with JSON `{"apiKey":"..."}` and bearer auth. `GET /api/credentials` lists providers. `POST /api/credentials/<provider>/check` tests a key. `DELETE /api/credentials/<provider>` disconnects. Never echo the key or a request body.

Then set Kiko's model in the composer. Click the model button ("Choose model", or the current model name), then pick the model. For OpenCode Go the proof model is "Cat Jam Free". The button then reads `cat-jam-free`.

## Drive

Use `agent-browser` only. Do not use ego-browser or any other driver.

```bash
S=kiko-<run-id>
agent-browser --session $S snapshot -i          # list elements with refs @eN
agent-browser --session $S click @eN            # refs change after every snapshot; re-snapshot first
agent-browser --session $S fill @eN "hi"
agent-browser --session $S wait --text "hi" --timeout 30000
agent-browser --session $S get text "[data-component=chat-transcript]"
```

Useful selectors and labels, from the client:

- Composer: `[data-component=prompt-input]`, textbox "Message", button "Send" (disabled while empty).
- Transcript: `[data-component=chat-transcript]`.
- Sidebar: button "New chat", `[data-component=sidebar-row]`, `[data-component=sidebar-settings]`, `[data-component=sidebar-recipes]`.
- Model: button "Choose model" (or the model name), "Reasoning" after a model is chosen.
- Tasks: `[aria-label=Tasks]`, `[data-component=task-list]`, `[data-component=task-step]`, `[data-component=task-progress]`.

Sending is optimistic. Your bubble appears before the server answers, so a bubble alone is not proof. Wait for the agent's reply text in the transcript, and for the Send button to be disabled again. Wait for the text, not for a fixed sleep.

## Evidence

Save evidence under `/tmp/kiko-verify/<run-id>/evidence/`. Name files for the step.

```bash
E=/tmp/kiko-verify/<run-id>/evidence
agent-browser --session $S get text "[data-component=chat-transcript]" | tee $E/transcript.txt
agent-browser --session $S screenshot $E/chat.png
```

Use `screenshot --full` for a long page. Put the proof line in your report with the file it came from. Cleanup never deletes evidence. Keep failed runs too, so their logs can be read.

## Cleanup

```bash
.cursor/skills/verify-kiko/bin/down.sh <run-id>
```

`down.sh` stops only the PIDs recorded in that run's `listeners.pid` and launcher PID files, and their children. It sends TERM, waits 2 s, then KILLs any recorded survivor. It then closes the run's agent-browser session (`kiko-<run-id>`). It never runs `pkill` or `killall`, and never touches evidence. It prints the evidence path.

After it runs, confirm `ss -ltnH "sport = :8791"` and `:5191` print nothing.

Do not run `agent-browser close --all`. It closes other sessions too.

## Backend

Use the kiko CLI for backend behavior. It talks to the server the way the client does.

```bash
export KIKO_SESSION_FILE=/tmp/kiko-session-$USER.json   # the CLI bearer token, kept outside the repo
bun kiko health --url http://localhost:8791
bun kiko login --dev --name alice --url http://localhost:8791
bun kiko whoami --url http://localhost:8791
bun kiko verify --list                                  # all suites
bun kiko verify <suite> --url http://localhost:8791     # one suite
bun kiko verify --no-model --url http://localhost:8791  # every suite that needs no model key
```

`KIKO_URL` picks the target for every command. `--url` overrides it. The first line of each command is `kiko: target <url>`. Start your own server with `up.sh`, and never point two runs at one server. Suites that read the dev counters (`latency`) need a server to themselves.

`login --dev` works only with `NODE_ENV=development`. Keys for model suites come from the shell: `set -a; . apps/server/.dev.vars; set +a`.

Suites live in `apps/cli/src/verify/suites/<name>.ts`. Each default-exports `{ name, model?, human?, run(v) }`. Set `model: true` if the suite calls a model. Set `human: true` if it needs a person; the runner skips it unless it is named. In `run`: `const s = await v.as("alice")`, `const room = await s.room(id)`, `room.send(text)`, `room.expect(match, ms)`, `(await s.user()).expect(...)`.

Suites that need a Worker `--var`:

- `cross-origin` needs the Worker started with `--var TRUSTED_ORIGINS:https://app.example.test`. Without it the suite prints a skip note and passes.

### Suite map

| Suite or command | Feature file |
| --- | --- |
| `health`, `selftest` | health |
| `agents`, `team-ask`, `team-flow`, `team-routing`, `team-loops`, `team-model`, `team-race`, `hardcore` | agents |
| `mid-run`, `mid-run-model`, `burst-backlog`, `team-priority` | mid-run |
| `stop-window` | stop-window |
| `workers`, `workers-model` | workers |
| `chats`, `activity` | chats |
| `long-text` | long-text |
| `chief` | chief |
| `workspace` | workspace |
| `reactions` | reactions |
| `search`, `room-search` | search |
| `room-sync`, `user-sync`, `turn` | room-sync |
| `files`, `file-tools`, `attachments` | files |
| `bash` | bash |
| `browser`, `browser-run`, `kernel`, `browser-takeover` | browser |
| `composio`, `composio-extension` | composio |
| `fanout` | fanout |
| `skills` | skills |
| `routines`, `reminders`, `routine-triggers`, `routines-model`, `routines-scale` | routines |
| `credentials`, `byok`, `provider-login` | account |
| `agent-models`, `model-pinned`, `model-sweep` | models |
| `overhead`, `token-cost`, `latency`, `latency-model` | limits |
| `memory-jev` | memory-jev |
| `memory-edge` | memory-edge |
| `memory-tools`, `memory-session`, `memory-eval`, `memory-hard`, `soul` | memory |
| `proactive` | proactive |

Themes (`apps/server/src/user/theme.ts`) have no suite. `apps/server/test/user.test.ts` covers them.

The feature files in the table above are not all written yet. Until one exists, read the suite file itself.

### The rule

A task that changes backend behavior adds or extends its suite in the same pull request. It also adds or updates its feature file and its row in the map. A suite must fail when the behavior breaks. A test that only proves the code runs is not a proof.

## Features

Web-app features are in `features/`. Start with `features/README.md`. Each feature file has the sub-features, how to reach them as a user, how to drive them with `agent-browser`, and the gotchas.

## Helpers

| Script | Use |
| --- | --- |
| `bin/up.sh [--run-id <id>] [--server-port <n>] [--client-port <n>] [--owner <name>]` | Start one run and sign in. Prints the run dir, URLs, and the browser command. |
| `bin/connect-model.sh <run-id> <provider>` | Connect a provider key from the shell or `apps/server/.dev.vars`. Prints the status and the check only. |
| `bin/down.sh <run-id>` | Stop that run's recorded PIDs and its browser session. Keeps evidence. |

## Heavy commands

Wrap heavy commands in `issues/bin/heavy.sh`: the gate, test runs, a typecheck, a dev server, and `bun kiko verify`. The machine has 4 CPUs. `heavy.sh` refuses to run when `/tmp` has under 1 GB free (exit 75).

```bash
issues/bin/heavy.sh bun kiko verify <suite> --url http://localhost:8791
```
