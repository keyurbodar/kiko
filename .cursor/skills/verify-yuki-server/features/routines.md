# routines

Covers routines (an agent that runs on a trigger), reminders (scheduled messages), and routine triggers (a task status change or a human message fires a routine).

Suites: `routines` (create, fire, quiet run), `reminders` (fire, cancel, snooze, rewind), `routine-triggers` (task and message triggers).

## Sub-features

- **routines**: a routine with a timed trigger (`at` four seconds from now) runs and posts its tool result into the room. A routine that has nothing to say ends `quiet` and posts nothing. The routine's target and creator must both be `yuki`.
- **reminders**: a reminder that is due fires as a system message (`reason: reminder`). The suite drives cancel, snooze, and rewind through `api/reminders/<id>/<cancel|snooze|rewind>`.
- **routine-triggers**: three tasks moved to `review` within a window give one run. A human message fires the routine once; the agent's own replies fire nothing (checked over 65 s).

## How to get to it (user POV)

1. Ask the agent: "every morning at 9, check my tasks". It creates a routine and shows it in the routines list.
2. Wait for the time; the agent posts its result in the chat.
3. Set a reminder ("remind me in 10 minutes"). It arrives as a system message. Snooze or cancel it from the message.
4. Move a task to `review`. A routine watching that status runs once.

## Driving it with the yuki CLI

```bash
bun yuki verify routines --url http://localhost:8787
bun yuki verify reminders --url http://localhost:8787
bun yuki verify routine-triggers --url http://localhost:8787
```

These suites call dev routes (`api/dev/agent/...`), so the Worker must run with `NODE_ENV=development`.

## Gotchas

- `routine-triggers` waits 65 s on purpose. Do not shorten it; the window is what proves the agent's own messages do not fire a routine.
- `routines` checks a quiet run by counting agent texts before and after a one-second sleep. A slow model can post late and make the check pass falsely; re-run before trusting a pass.
- The reminder suite's time checks use the user's stored time zone. A zone mismatch shows up as a wrong wall-clock string in the failure.
