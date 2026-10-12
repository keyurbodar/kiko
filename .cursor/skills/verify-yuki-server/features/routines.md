# routines

Covers routines (an agent run on a trigger), reminders (scheduled system messages), and routine triggers (a task change, a message, a file, a webhook, or a watched page fires a routine).

Suites: `routines`, `reminders`, `routine-triggers`, `routines-model`, `routines-scale`. Flags: `routines-model` sets `model: true`. None sets `human: true`.

## Sub-features

- **routines**: a routine with a timed trigger runs and posts its result into the room. A run with nothing to say ends `quiet` and posts nothing. Also covered: a child routine, an outside tool call, a daily run limit of 2 with one run held, a 5 s run timeout, and the breaker that pauses a routine after 3 failed runs and tells the chat.
- **reminders**: a due reminder fires as a system message (`reason: reminder`). The suite covers a one-off, rewind, a daily reminder in `America/New_York`, and cancel. It does not snooze.
- **routine-triggers**: task (three tasks moved to `review` in a window give one run), message (a human message fires once, the routine's own target agent fires nothing, checked over 65 s), file, webhook, and watch triggers.
- **routines-model**: natural-language asks create the right routine or reminder with a real model. It also checks run cost and quiet runs. `ROUTINES_MODEL_N` sets the count (default 3).
- **routines-scale**: many routines due at the same second each run exactly once. `ROUTINES_SCALE_N` sets the count (default 300).
- Routines come from the agent's tools (creator `yuki`) or the HTTP API (creator `human`). Snooze works only on time triggers, and a snoozed paused routine stays paused. Deleting a chat cancels its reminders and routines and drops their webhook rows. Webhook creation rolls back if its lookup row cannot be saved.

## How to get to it (user POV)

1. Ask the agent: "every morning at 9, check my tasks". It creates a routine and shows it in the routines list.
2. Wait for the time. The agent posts its result in the chat, or stays quiet.
3. Set a reminder ("remind me in 10 minutes"). It arrives as a system message. Snooze or cancel it.
4. Move a task to `review`. A routine watching that status runs once.

## Driving it with the yuki CLI

```bash
bun yuki verify routines --url http://localhost:8787
bun yuki verify reminders --url http://localhost:8787
bun yuki verify routine-triggers --url http://localhost:8787
bun yuki verify routines-scale --url http://localhost:8787
bun yuki verify routines-model --url http://localhost:8787
```

`routines`, `routine-triggers` and `routines-scale` use the dev fake route, and `reminders` uses the dev-only rewind, so the Worker needs `NODE_ENV=development`. `routines-model` needs `OPENCODE_API_KEY` in the shell.

## Gotchas

- `routine-triggers` waits 65 s on purpose. The window proves the routine's own agent does not fire it.
- `routines` checks a quiet run by counting agent texts before and after a short sleep. A slow model can post late and make the check pass falsely. Re-run before trusting a pass.
- `reminders` passes its own time zones (`UTC`, `America/New_York`). The user's stored zone applies only to routines made through the HTTP route.
- `routines-scale` is heavy. Give it its own server.
- No suite covers chat-delete cancellation, webhook create rollback, or snooze. Unit tests under `apps/server/test` are the only proof today.
