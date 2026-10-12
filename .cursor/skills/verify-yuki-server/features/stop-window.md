# stop-window

Stop inside the one-second window after a human message keeps the message. The agent answers it once, after the stop, and the room posts no notice about it.

Suite: `stop-window`. Flags: none. It uses the dev fake route, so the Worker needs `NODE_ENV=development`.

## Sub-features

- A message is sent, and the agent must not have started (no `typing` yet). The suite fails with "the agent started before the stop" if the window already closed.
- A `stop` frame is sent inside the window.
- The agent then answers the message once: `heard: window message`.
- The bubble list is exactly that one answer, and no system message says "could not reach" or "answered at".

## How to get to it (user POV)

1. Send a message and press stop right away, before the agent starts typing.
2. The agent still answers the message once. No notice says the message was missed.

## Driving it with the yuki CLI

```bash
bun yuki verify stop-window --url http://localhost:8787
```

Uses the dev fake route, so the Worker needs `NODE_ENV=development`. No keys.

## Gotchas

- The suite fails at start if `typing` already appeared: the burst window closed and the stop landed too late.
- It checks exact bubble text and the absence of a notice. Wording changes in the fake agent or the harness fail it.
