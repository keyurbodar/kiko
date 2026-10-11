# fanout

Proves that one agent turn can make many Composio web searches in parallel: at least 15 calls, overlapping in time (not run one after another), and finished inside the wall-clock limit.

Suite: `fanout`. Flags: `model: true`, `human: true`.

## Sub-features

- A warm-up turn runs one search so later timings are not skewed by cold start.
- A fan turn asks for at least 15 topics (for example "latest stable Bun version", "latest Rust stable release") in one message. The suite counts calls and measures wall time against the sum of call times.
- Pass: `calls >= 15`, `wall/sum <= 0.6` (calls overlapped), and wall time under 60 s for the fan.

## How to get to it (user POV)

1. Ask the agent for many facts that need web search, all in one message ("latest release of each of these 20 tools").
2. Watch the composio search calls appear; several should run at once.
3. The answer arrives once, with all the facts.

## Driving it with the yuki CLI

```bash
bun yuki verify fanout --url http://localhost:8787
```

Required in the shell: `COMPOSIO_API_KEY`, and optionally `YUKI_COMPOSIO_MODEL` (defaults to `opencode-go/muse-spark-1.3-contributor`). `human: true`, so it runs only by name. It spends real Composio and model quota; say so before running it.

## Gotchas

- The suite exits with "COMPOSIO_API_KEY is not set in this shell" if the key is missing. Set it in the shell, never in a file that gets printed.
- `TURN_MS` is 150 s per turn; a slow model fails the turn, not the overlap check.
- A fast single-call turn passes `calls` only if it made 15; a turn that makes fewer fails even if every call was quick.
- Run it alone. Parallel runs share the Composio rate limit and skew the wall-time ratio.
