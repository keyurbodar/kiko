# fanout

Proves that one agent turn can make many Composio web searches in parallel: at least 15 calls, at least 10 in flight at once, and finished inside the wall-clock limit.

Suite: `fanout`. Flags: `model: true`, `human: true`.

## Sub-features

- The prompt asks for all the topics "as one job", so the agent issues the searches itself in one turn.
- A warm-up turn runs one search so later timings are not skewed by cold start.
- Two fan turns, one with 20 topics and one with 30. Calls are counted from `composio.call.composio_search_*`, excluding `search_tools`. The warm-up is printed but not asserted.
- Pass for each fan: `calls >= 15`, peak in flight `>= 10` (`composio.peak`), wall time under 60 s, and no composio or tool error counter.
- Cleanup deletes the rooms and disconnects Composio.

## How to get to it (user POV)

1. Ask the agent for many facts that need web search, all in one message ("latest release of each of these 20 tools").
2. Watch the composio search calls appear; several should run at once.
3. The answer arrives once, with all the facts.

## Driving it with the kiko CLI

```bash
bun kiko verify fanout --url http://localhost:8787
```

Required in the shell: `COMPOSIO_API_KEY` and `OPENCODE_API_KEY`, and optionally `KIKO_COMPOSIO_MODEL` (defaults to `opencode-go/muse-spark-1.3-contributor`). `human: true`, so it runs only by name. It spends real Composio and model quota; say so before running it.

## Gotchas

- The suite exits with "COMPOSIO_API_KEY is not set in this shell" if the key is missing. Set it in the shell, never in a file that gets printed.
- `TURN_MS` is 150 s per turn; a slow model fails the turn, not the overlap check.
- A fast single-call turn passes `calls` only if it made 15; a turn that makes fewer fails even if every call was quick.
- Serial calls fail even when they are many and quick: `composio.peak` must reach 10 in flight.
- Run it alone. Parallel runs share the Composio rate limit and skew the wall-time ratio.
