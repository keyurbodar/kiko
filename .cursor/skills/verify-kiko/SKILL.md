---
name: verify-kiko
description: Prove Kiko behavior end to end. Use when a task changes the Kiko web app (SolidJS client in apps/web-solid) or the backend (Worker and Durable Objects in apps/server), or before you claim either works. Drives the web UI with agent-browser and the backend with the bun kiko CLI.
---

# Verify kiko

Two drivers, one proof. `agent-browser` drives the web app the way a person does. `bun kiko verify` drives the backend over the same protocol the client uses. A change is not done until you have run it and shown the output.

Never print a key. Never ask the owner to paste one. Keys live in `~/.config/kiko/dev.vars`, linked from `apps/server/.dev.vars`.

## Launch

```bash
.cursor/skills/verify-kiko/bin/up.sh [--run-id <id>] [--server-port 8791] [--client-port 5191] [--owner verify-kiko]
```

Defaults: server `8791`, client `5191`, owner `verify-kiko`, run id from the clock. The inspector port is the server port plus 1000.

`up.sh` refuses a port that already answers and a run dir that exists; it never deletes a run. It builds `apps/web-solid/dist` if missing, waits up to 240 s for health and the client page, then signs in as the dev owner and writes the bearer token to `/tmp/kiko-verify/<run-id>/token` (mode 0600) without printing it. Logs, pids, wrangler state, and `evidence/` sit in that run dir.

Pass: `ss -ltnp "sport = :8791"` names a PID in the run's `listeners.pid`, `curl -fsS http://localhost:8791/api/health` answers `{"ok":true}`, and the client returns `200`. A holder you did not start is another session's server: report it, do not kill it. Use `localhost`, not `127.0.0.1`.

## Sign-in

`up.sh` signs in for you. Open the browser with the token:

```bash
agent-browser --session kiko-<run-id> open "http://localhost:5191/#token=$(cat /tmp/kiko-verify/<run-id>/token)"
agent-browser --session kiko-<run-id> wait --load networkidle
```

It lands on `/chat/00000000-0000-7000-8000-6b696b6f0000`, Kiko's home chat.

## Model setup

Kiko needs a model key to answer. It reads the key from the shell or `apps/server/.dev.vars`, sends it once, and prints only the status and the check:

```bash
.cursor/skills/verify-kiko/bin/connect-model.sh <run-id> opencode-go
# PUT /api/credentials/opencode-go -> 200
# POST /api/credentials/opencode-go/check -> {"provider":"opencode-go","chat":true,"judge":false}
```

Then pick Kiko's model in the composer: click the model button ("Choose model", or the current model name). For OpenCode Go the proof model is "Muse Spark 1.3 Contributor".

## Drive

```bash
S=kiko-<run-id>
agent-browser --session $S snapshot -i          # list elements with refs @eN
agent-browser --session $S click @eN            # refs change after every snapshot; re-snapshot first
agent-browser --session $S fill @eN "hi"
agent-browser --session $S wait --text "hi" --timeout 30000
agent-browser --session $S get text "[data-component=chat-transcript]"
```

Useful selectors, from the client:

- Composer: `[data-component=prompt-input]`, textbox "Message", button "Send" (disabled while empty).
- Transcript: `[data-component=chat-transcript]`.
- Sidebar: button "New chat", `[data-component=sidebar-row]`, `[data-component=sidebar-settings]`.
- Tasks: `[data-component=task-list]`, `[data-component=task-step]`, `[data-component=task-progress]`.

Sending is optimistic: your bubble appears before the server answers, so a bubble alone is not proof. Wait for the agent's reply text in the transcript, and for Send to be disabled again. Wait for text, not for a fixed sleep.

## Evidence

Save evidence under `/tmp/kiko-verify/<run-id>/evidence/`, named for the step.

```bash
E=/tmp/kiko-verify/<run-id>/evidence
agent-browser --session $S get text "[data-component=chat-transcript]" | tee $E/transcript.txt
agent-browser --session $S screenshot $E/chat.png
```

Use `screenshot --full` for a long page. Put the proof line in your report with the file it came from. Keep failed runs too, so their logs can be read.

## Cleanup

```bash
.cursor/skills/verify-kiko/bin/down.sh <run-id>
```

`down.sh` stops only the run's recorded pids and their children, then closes its `kiko-<run-id>` browser session. It never runs `pkill`, `killall`, or `agent-browser close --all`, and never deletes evidence. After it, `ss -ltnH "sport = :8791"` and `:5191` print nothing.

## Backend

Use the kiko CLI for backend behavior. It talks to the server the way the client does.

```bash
export KIKO_SESSION_FILE=/tmp/kiko-session-$USER.json   # the CLI bearer token, kept outside the repo
bun kiko health --url http://localhost:8791
bun kiko login --dev --name alice --url http://localhost:8791
bun kiko verify --list                                  # every suite; (model) marks the ones that spend a key
bun kiko verify <suite> --url http://localhost:8791     # one suite
```

`KIKO_URL` picks the target for every command and `--url` overrides it. Start your own server with `up.sh` and never point two runs at one server. `login --dev` needs `NODE_ENV=development`. Model suites take keys from the shell: `set -a; . apps/server/.dev.vars; set +a`.

Run the suites your change touches, not the whole list: CI's `verify` job runs every model-free suite on each push. Suites that read the dev counters (`latency`) need a server to themselves. `cross-origin` needs the Worker started with `--var TRUSTED_ORIGINS:https://app.example.test`; without it the suite skips and passes.

Suites live in `apps/cli/src/verify/suites/<name>.ts` and default-export `{ name, model?, human?, run(v) }`. Set `model: true` if it calls a model, `human: true` if it needs a person (the runner skips it unless named). In `run`: `const s = await v.as("alice")`, `const room = await s.room(id)`, `room.send(text)`, `room.expect(match, ms)`.

A task that changes backend behavior adds or extends its suite in the same pull request. A suite must fail when the behavior breaks. A test that only proves the code runs is not a proof.
