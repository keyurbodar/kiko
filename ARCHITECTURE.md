# Architecture

Kiko serves one owner per Worker. This page records the decisions a maintainer would get wrong without it. Read the code for everything else.

## One Durable Object

Everything an owner has lives in one `OwnerDO` with one SQLite database. Rooms, agents, the user, files and schedules are plain classes inside it, and they call each other directly. There are no calls, queues or retries between objects, because there is only one object. Each browser tab opens one socket to it.

- **Room** (`room/`) holds one human and one or more agents. Untagged messages go to the lead, `@name` goes to one agent, and `@all` goes to every agent.
- **Agent** (`agent/`) is a room member with its own `pi-durable` harness. Its state is a journal in the same database (`core/agent/src/journal.ts`). Only `agent/factory.ts` builds agents.
- **User** (`user/`) owns credentials, memory, reminders, routines and presence.
- **Files** (`files/`) is an index in SQLite. The bytes live in R2, or in the database when the owner has no R2.
- **Extensions** are a manifest and a script that add tools, instructions or schedules. They run in QuickJS and reach the outside only through the sandbox bridge. Only the human installs one.

## A prompt, end to end

1. The client applies the message locally, then sends it over the socket.
2. `OwnerDO` stores the message row and acknowledges it.
3. Human messages that arrive before a short pause form a burst. The burst goes to the agents it addresses.
4. Admission persists a ready ticket and returns. An alarm runs one queued run to completion with a budget of 40 outbound calls. Runs execute one at a time because overlapping events share Cloudflare's subrequest limit.
5. Each agent writes its reply as short bubbles. Each finished model turn writes one journal row.

## Socket RPC

`core/protocol` is the contract: every wire type is an Effect Schema, and `OwnerRpcs` (`core/protocol/src/rpc.ts`) lists every call a client makes over `/api/rpc`. `apps/server/src/rpc/` speaks the Effect RPC JSON wire format, so the stock `RpcClient` with a socket protocol works against it. The old frame protocol on `/api/ws` stays until the client moves.

- **Nothing lives in memory between messages.** Each unary request is decoded, run as an Effect and answered with an `Exit` inside one `webSocketMessage`. A stream subscription is a `{requestId, stream, cursor}` entry in the socket attachment, and broadcasts are turned into `Chunk` frames for it, so a stream survives hibernation. Updating the cursor rewrites the attachment, which is not a billed row.
- **Streams follow t3code.** `user.subscribe` and `room.subscribe` send a snapshot or the events after `afterSequence`, then `synchronized`, then live events and signals. Events at or below the cursor are dropped.
- **Retries are free.** Every command carries a client `commandId`. A send stores it in the message's existing `client_id` column and a repeat returns the first ack. Creates use client-made ids (room, agent, task, install) as their primary key, and most other commands set a value, so a repeat changes nothing and writes nothing.
- **One auto-response pair.** A Durable Object can only auto-answer one exact frame. It stays `ping`/`pong`, which the computer daemon and the old client send, so an RPC `Ping` wakes the object to get its `Pong`. When the old client is gone, move the pair to the RPC frames and the daemon with it.

## Writes are the budget

A warm prompt writes 6 billed rows: the human's message, the reply, one journal row, a ready ticket and its deletion, and one alarm. Opening the app and an idle minute write nothing. The e2e fails if the median warm prompt writes more than 7.

- **Derive instead of store.** An agent's unanswered input is the human messages after its delivery cursor, `humanDeliveredSeq`, which survives journal resets. A member only receives messages posted after it joined or became lead.
- **No extra indexes.** Message ids are `<seq>.<hex room>`, so lookups use the `(room_id, seq)` key.
- **Write only on change.** Unchanged settings, cursors and schedules are not rewritten.
- **One alarm, only when needed.** `owner/clock.ts` arms it for pi tasks, routines, leases and reminders when no tab is connected. Nothing schedules work after an error.
- **Lazy search.** The FTS index stores one document per batch of messages, built on first search and refreshed only for what changed.
- **Cold history** moves to R2 (`owner/history-*.ts`).

## Safety rules

- Credentials are encrypted in `OwnerDO`. They are never logged or sent to the client.
- Only the Worker builds a Durable Object name, in `lib/names.ts`.
- An agent reaches the outside only through its budgeted egress.
- Schema changes append a step to the end of `owner/schema.ts`. Existing steps never change, because installs replay them.
- Every alarm handler and delivery is safe to run twice.
- Models, providers and Composio tools come from `pi-ai` and Composio at run time, never from a hard-coded list.

## Client

The client paints from IndexedDB first and applies every action locally before the server answers. The first-paint tiers stay small, and `scripts/bundle-budget.ts` fails the build when one grows past its limit.

After first paint the client warms every lazy module in `apps/web-solid/src/app/idle-preload.ts`, so opening the sidecar, palette, search, emoji picker, composer extras or a route page never waits on a chunk. Add a new lazy boundary to that list.

A service worker (`apps/web-solid/scripts/service-worker.ts`, built to `/sw.js`) caches hashed `/assets/*` files cache-first and, once the client is idle, downloads every lazy chunk listed in the build's `/sw-manifest.json`. It never touches `/`, `/index.html`, `/api/*`, `/pc/*`, websockets or non-GET requests, so a release still reaches an install through the network-first HTML. It deletes cached files the current manifest no longer lists and unregisters itself when `/sw-off` exists or the manifest is missing. To switch it off in every install without a release, serve a `/sw-off` file.

Solid components run top to bottom once, and memos and effects evaluate as soon as they are created. Declaration order inside a component is runtime order, which is why lint rejects any use before definition.

The live computer view is its own lazy chunk and is never in a first-paint tier. It tries a WebRTC peer to the daemon first, with input on a DataChannel, and falls back to JPEG frames over the user socket after 5 seconds. Neither path writes to SQLite, and a viewer that is closed holds no socket subscription.

## Verification

There are no unit or integration tests. Correctness rests on static gates that are cheap enough to run on every commit, and on one end-to-end pass against the real Worker in CI.

| Gate | Tool | Why |
|---|---|---|
| Format | oxfmt | One style, no review noise |
| Lint | oxlint, `--deny-warnings` | Catches use-before-define, runtime cycles and dead code paths that TypeScript accepts |
| Complexity | Biome, cognitive complexity 30 | oxlint has no complexity rule, so Biome runs that one rule only |
| Layering | `scripts/check-imports.ts` | `core/` and `packages/` stay independent of `apps/` |
| Dead code | knip | Unused files, exports and dependencies |
| Generated | `scripts/check-generated.ts` | `*.gen.ts` matches its Markdown source |
| Types | tsgo per package | About 4x faster than tsc |
| Bundles | `vite build`, `wrangler deploy --dry-run` | Imports that resolve in types but not in the bundle |
| Behavior | `bun kiko verify journal-overhead`, `verify:web` | Real prompts and a real browser against `wrangler dev` |

`scripts/check-changed.ts` runs the static gates for only the files and packages a change touches. The pre-commit hook runs it on staged files. CI runs every gate on each pull request, and `main` requires the `Check` and `E2E` jobs to pass before a merge, so every commit a release ships has already passed CI.

## Computers

`apps/computer` is a daemon the owner runs on their own machine. It dials out to the Worker, so no inbound port and no tunnel is needed. The wire protocol lives in `core/computer/src/` and both sides share it.

- **It signs every connect.** `key.jwk` holds an Ed25519 private key in the config dir at 0600, and `api/pc/connect` carries the signed timestamp. The Worker verifies it and the ±60s skew before it will accept the socket.
- **The daemon never trusts the Worker's arguments.** Every `call` is decoded against the `Calls` schema in `wire.ts` first, and a frame that fails is answered with `failed` rather than reaching an op.
- **`policy.json` is the local ceiling**, checked before every op. A denied op answers `denied` and the Worker cannot override it. The human holder is a second ceiling: while the owner holds the screen, `act` is refused here even if the Worker asked.
- **One input queue.** Every step that changes input runs through `InputQueue`, so two calls can never interleave keystrokes, and a timeout releases a held drag rather than leaving the button down.
- **A deadline kills the process tree, never a name.** Shell commands run detached in their own process group and the deadline signals that group, so a child that outlives its parent still dies and nothing else does.
- **Desktop tools go through cua-driver over MCP stdio.** Tools are discovered with `tools/list` at connect time and every argument is filtered against the advertised schema, because the driver's input shape differs by platform and version. Element ids are the driver's `element_token`s mapped to our small integers per capture; an unknown id answers `stale` so the agent looks again. Images shrink to a 1280 long edge and coordinates map back through the capture's own scale.
- **No desktop is not a broken machine.** When cua-driver is missing, or Linux has no `$DISPLAY`/`$WAYLAND_DISPLAY`, `caps.desktop` is false and shell and files keep working.
- **`src/live/` is the seam for the live view.** `connection.ts` hands `rtc`, `live`, `input` and `control` frames to the `Live` object it is given. The default in `src/live/index.ts` reports no live capability and still forwards holder changes.
- **Writes cost nothing here.** The daemon keeps captures, pending calls and the holder in memory. Nothing is written per call or per ping.

## Releases

`scripts/release.ts` builds and signs a release, and the release workflow publishes it to `latest-owner.json`. The workflow commits the version bump off `main` and pushes only its tag, because `main` accepts changes only through a pull request with green CI and has no bypass. The newest `v*` tag is the current version; `package.json` on `main` can lag behind it. Moving an install from v0.4 to `OwnerDO` deletes the old databases after the owner types `delete-existing-data` in the installer.

The same signed manifest names the five `kiko-computer` daemon binaries and their sha256, and the release uploads them to the GitHub release for its tag. A Worker serves `GET /pc/install.sh` and `/pc/install.ps1` from `BACKEND.version`, pinning the hashes it reads back from that manifest and verifying its signature first, so an install never runs a binary the release did not sign. A Worker whose version is not published yet hands the script the release base and lets it verify against `SHA256SUMS-computer` instead.
