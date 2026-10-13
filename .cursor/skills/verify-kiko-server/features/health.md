# health

Proves the Worker is up and answers, and that the verify runner itself works.

## Sub-features

- `bun kiko health` asks the Worker for `GET /api/health`. It waits up to 5 s. It exits 0 and prints `ok`, or prints JSON with `--json`.
- The `selftest` suite checks the runner and the CLI client against a local WebSocket server, not the product. It needs a dev-login server and no keys.

## How to get to it (user POV)

1. Open the app. If the Worker is down, nothing loads.

## Driving it with the kiko CLI

```bash
bun kiko health --url http://localhost:8787
bun kiko verify selftest --url http://localhost:8787
```

Pass: exit code 0 and an `ok` line. `selftest` sets neither `model` nor `human`.

## Gotchas

- Health fails if the server cannot be reached, returns a non-ok status, returns a body other than `{ok: true}`, or takes more than 5 s.
- The URL defaults to `$KIKO_URL`, then `http://localhost:8787`. Port 8787 often belongs to another session; always pass `--url`.
