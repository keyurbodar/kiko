# limits

Covers server overhead, token cost, and latency. There is no reply limit: a user gets every reply.

Suites: `overhead`, `token-cost`, `latency`, `latency-model`. Flags: `token-cost` and `latency-model` set `model: true` and need `OPENCODE_API_KEY`. None sets `human: true`. `overhead` and `latency` read and reset dev counters, so each needs its own server.

## Sub-features

- **Server overhead** (`overhead`): timed steps such as `GET /api/health (no session)`, `user socket upgrade`, `send to ack`, `send to second tab`, `room socket upgrade (warm room)`, and `send to ack (N messages)`. It also checks replay order, that a hello at the newest seq replays nothing, and that a resume from `seq - 5` replays the exact tail. `KIKO_OVERHEAD_RUNS` (20) and `KIKO_OVERHEAD_BIG` (1500) set runs and size.
- **Token cost** (`token-cost`): 30 turns (`KIKO_TOKEN_TURNS`) in `memory` mode (`KIKO_TOKEN_MODES`, default `memory`). It prints fresh input, cached and output tokens, and estimated cost. It fails only if memory mode forgets the code from turn 2.
- **Latency, fake agent** (`latency`): `send to ack`, `burst close to typing (cold agent)`, `typing to first bubble (warm agent)`, `stop to idle`, `warm reconnect to first frame`, and per-turn counts of RPCs, statements and rows. The restart case fails if the agent is not alive within 15 s.
- **Latency, real model** (`latency-model`): `KIKO_LATENCY_RUNS` (10) turns, then `KIKO_LATENCY_WEB_RUNS` (3) questions about example.com. The answer must mention "example domain".

## How to get to it (user POV)

1. Send a message and watch the typing indicator and the first bubble.
2. Open a second tab on the same chat. It shows a new message soon after the send.
3. Chat for a while, then ask for a fact from early on. The agent still knows it.

## Driving it with the kiko CLI

One server per suite, each on its own port:

```bash
bun kiko verify overhead --url http://localhost:<port>
bun kiko verify latency --url http://localhost:<port>
bun kiko verify token-cost --url http://localhost:<port>
bun kiko verify latency-model --url http://localhost:<port>
```

Optional: `KIKO_LATENCY_RESTART` (a shell command the suite runs to restart the server).

## Gotchas

- Dev counters live in one module per Worker isolate, shared by every session on that server. A reset from one run corrupts another run's numbers.
- The stats and dev agent routes answer 404 unless `NODE_ENV=development` and the host is localhost.
- `latency` with no `KIKO_LATENCY_RESTART` logs a skip. That is not a pass for restart timing.
- `token-cost` waits 60 s in memory mode before reading usage. Its costs use fixed weights, so they are estimates.
