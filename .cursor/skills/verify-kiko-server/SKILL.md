---
name: verify-kiko-server
description: "Drive the kiko backend (Worker and Durable Objects) the way a user does, using the kiko CLI against wrangler dev. Use for 'verify the server', 'check the backend', or before claiming a backend task works."
---

# Verify kiko server

The driver is the kiko CLI. It speaks the same protocol as the client. For the frontend, use `verify-kiko`.

## Start the server

From `apps/server`. Pick a free port. Do not leave it running.

```bash
cp ~/.config/kiko/dev.vars .dev.vars        # once, git ignores it
bunx wrangler d1 migrations apply kiko-auth --local   # once
NODE_ENV=development bunx wrangler dev --port 8787 --inspector-port 9229
```

If wrangler complains about the assets directory, run `bun run build` in `apps/web-solid`. Stop it with `lsof -ti :8787 | xargs kill`.

## Check it is up

```bash
bun kiko health --url http://localhost:8787
```

## Sign in

```bash
export KIKO_SESSION_FILE=$PWD/.kiko-session   # keeps sessions apart
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

Suites are in `apps/cli/src/verify/suites/<name>.ts`. Each exports `{ name, model?, run(v) }`. Set `model: true` if it calls a model. In `run`: `const s = await v.as("alice")`, `const room = await s.room(id)`, `room.send(text)`, `room.expect(match, ms)`, `(await s.user()).expect(...)`.

## The rule

A task that changes backend behavior adds or extends its suite in the same pull request. It also adds a feature file in `features/` named after the suite, and a row in the map below.

## Map

| Suite or command | Feature file |
| --- | --- |
| `kiko health` | [health](./features/health.md) |
| `selftest` | runner self check, no feature file |
| `executor-connect` | [executor-connect](./features/executor-connect.md), needs a human sign-in |
