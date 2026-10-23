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

`core/protocol` is the contract: every wire type is an Effect Schema, and `OwnerRpcs` (`core/protocol/src/rpc.ts`) lists every call a client makes over `/api/rpc`. `apps/server/src/rpc/` speaks the Effect RPC JSON wire format, so the stock `RpcClient` with a socket protocol works against it. There is no other client socket, and the REST routes that duplicated an RPC are gone. HTTP stays for sign-in, `/api/me`, `/api/health`, `/api/version` (probed before sign-in), file bytes and uploads, webhooks, the computer daemon and dev-only routes.

The client probes `/api/version` before each connect. A backend whose answer lacks `rpc: true` predates `/api/rpc`, so the supervisor parks in `blocked` and the update UI shows instead of a retry loop; `package.json` on `main` lags the release tag, so the check is a capability, not a version compare. `apps/web-solid/src/app/legacy-update.ts` updates such a backend over its old `/api/ws` frames (`hello`, then `update.start`). Delete it once no backend older than 0.8.0 remains.

- **Transports stay thin.** Each entry in `rpc/handlers.ts` calls one service method: `room/commands.ts` for a room, `User`, its `kernel` and `pc` wirings, or `rpc/subscriptions.ts` for streams. Methods are `Effect.fn` spans that fail with the contract's tagged errors, and the dispatcher turns any defect into the `StorageError` every RPC declares.

- **Nothing lives in memory between messages.** Each unary request is decoded, run as an Effect and answered with an `Exit` inside one `webSocketMessage`. A stream subscription is a `{requestId, stream, cursor}` entry in the socket attachment, and broadcasts are turned into `Chunk` frames for it, so a stream survives hibernation. Updating the cursor rewrites the attachment, which is not a billed row.
- **Streams follow t3code.** `user.subscribe` and `room.subscribe` send a snapshot when `afterSequence` is 0 or too far behind to replay, otherwise the events after it, then `synchronized`, then live events and signals. A user replay ends with a projection of every chat, because chat activity is projected from room state and not stored as events. Events at or below the cursor are dropped. Broadcast frames are decoded through the contract's JSON codec before they become stream items, so tagged errors in signals survive the trip.
- **Retries are free.** Every command carries a client `commandId`. A send stores it in the message's existing `client_id` column and a repeat returns the first ack. Creates use client-made ids (room, agent, task, install) as their primary key, and most other commands set a value, so a repeat changes nothing and writes nothing.
- **One auto-response pair.** A Durable Object can only auto-answer one exact frame. It is the stock client's `{"_tag":"Ping"}` to `{"_tag":"Pong"}`, so an idle tab never wakes the object, and the computer daemon sends the same frame. Daemons that still send `ping` get `pong` from `webSocketMessage`.

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

The client paints from IndexedDB first and applies every action locally before the server answers.

There is no service worker. `/sw.js` is a kill switch that unregisters the old one and clears its caches in installs that registered it. Hashed `/assets/*` files are served `public, max-age=31536000, immutable`, and `index.html` is served `no-cache`, so every load picks up the current build. A deploy removes the previous build's chunks, so an open tab can hit a 404 on its next lazy import. `vite:preloadError` then reloads the page once, guarded by a `sessionStorage` key that a clean startup clears. Without `sessionStorage` it does not reload, and the import rejects as usual.

Solid components run top to bottom once, and memos and effects evaluate as soon as they are created. Declaration order inside a component is runtime order, which is why lint rejects any use before definition.

The live computer view is its own lazy chunk and is never in a first-paint tier. It tries a WebRTC peer to the daemon first, with input on a DataChannel, and falls back to JPEG frames over the user socket after 5 seconds. Neither path writes to SQLite, and a viewer that is closed holds no socket subscription.

## Verification

Static gates are cheap enough to run on every push. Behavior is proven by Vitest against real code: no mocks, no DOM emulator, and no end-to-end suite against a deployed app.

| Gate | Tool | Why |
|---|---|---|
| Format | oxfmt | One style, no review noise |
| Lint | oxlint, `--deny-warnings` | Catches use-before-define, runtime cycles and dead code paths that TypeScript accepts |
| Test hygiene | `oxlint-plugin-kiko` | Tests never read the wall clock, sleep, poll, set their own timeout or retry, or skip without a `quarantine: #issue` line. Browser tests render through `apps/web-solid/test/render.tsx` |
| Complexity | Biome, cognitive complexity 30 | oxlint has no complexity rule, so Biome runs that one rule only |
| Layering | `scripts/check-imports.ts` | `core/` and `packages/` stay independent of `apps/` |
| Dead code | knip | Unused files, exports and dependencies |
| Generated | `scripts/check-generated.ts` | `*.gen.ts` matches its Markdown source |
| Types | tsgo per package | About 4x faster than tsc |
| Bundles | `vite build`, `wrangler deploy --dry-run` | Imports that resolve in types but not in the bundle |
| Unit tests | Vitest, `*.test.ts` beside the source | One root `vitest.config.ts`, `retry: 0`, `.only` fails in CI |
| Browser tests | Vitest browser mode in headless Chromium, `*.browser.test.tsx` | Solid components run through the app's own Vite plugins |
| Write budget | `apps/server/integration/journal-overhead.integration.test.ts` | Starts the real Worker with `unstable_startWorker` on a fresh persist dir and fails when a warm prompt writes more than 7 billable rows, a quiet minute writes anything, objects call each other, or a failing prompt shows or persists anything but one error row |

`scripts/ci-changes.ts` maps changed files to workspace packages and their dependents. CI uses it to skip jobs a change cannot affect, and `scripts/check-changed.ts` uses the same mapping locally. `bun run check:changed` is the pre-push hook: it formats-checks and lints the changed files, runs knip, layering and generated checks, typechecks the affected packages, and runs the tests beside the changed files, all in parallel, and remembers a passing run until an input changes. The pre-commit hook only formats staged files.

CI runs `Changes`, `Lint`, `Build and Typecheck`, `Test`, `Test Web` and `Worker` side by side. Branch protection requires only the aggregate `Check` job, which fails when any job fails or skips without `Changes` saying it could. Pushes to `main` run every job, and a release refuses to tag a commit whose `Check` has not passed.

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

## Hosted Workers

`infra/` owns the two Workers Kiko itself serves: the front door (`kiko-app`, `app.kiko.works`) and the installer (`kiko-installer`, `api.kiko.works`). `infra/alchemy.run.ts` declares both with Alchemy and deploys them from `.github/workflows/deploy.yml`. The owner Worker (`apps/server/wrangler.jsonc`) is not here: the installer uploads it into an owner's account, so it keeps its wrangler config, `wrangler dev` and the `release.ts` dry-run.

- **Adoption, never recreation.** Both Workers were created by `wrangler deploy` before Alchemy owned them, so the stack wraps its body in `adopt(true)`. Adopting leaves the live Durable Object namespace (`Installer`) and its data in place; a first deploy reports `adopted` and one binding create, and later deploys are no-ops.
- **`plan` and `deploy` need the Cloudflare state store.** `Cloudflare.state()` keeps state in an `alchemy-state-store` Worker on the account, created once with `bunx alchemy provider cloudflare bootstrap`.
- **`legacy_module_registry` is pinned** on both Workers. Alchemy defaults new Workers to `new_module_registry`, and flipping the registry under a running Worker is a code change no deploy can undo. Drop the flag deliberately, with a deploy that expects the switch.
- **`apps/server/wrangler.front-door.jsonc` stays for the CI bundle gate only.** `wrangler deploy --dry-run` there and in `release.ts` needs no credentials, so CI keeps a bundle check on every entry point; the deploy itself ignores these two configs.
- **Secrets are set once, out of band.** The installer reads `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `CF_OAUTH_CLIENT_ID`, `FRONT_DOOR_ORIGIN`, `RELEASE_BASE_URL`, `RELEASE_PUBLIC_KEY` and `TRUSTED_ORIGINS` as `secret_text` bindings that Alchemy does not declare. Cloudflare keeps an undeclared secret binding on upload, so a deploy neither needs those values nor wipes them.
