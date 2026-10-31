# Architecture

Kiko serves one owner per Worker. This page records the decisions a maintainer would get wrong without it. Read the code for everything else.

## One Durable Object

Everything an owner has lives in one `OwnerDO` with one SQLite database. Rooms, agents, the user, files and schedules are plain classes inside it, and they call each other directly. There are no calls, queues or retries between objects, because there is only one object. Each browser tab opens one socket to it.

- **Room** (`room/`) holds one human and one or more agents. Untagged messages go to the lead, `@name` goes to one agent, and `@all` goes to every agent.
- **Agent** (`agent/`) is a room member with its own `pi-durable` harness. Its state is a journal in the same database (`core/agent/src/journal.ts`). Only `agent/factory.ts` builds agents.
- **User** (`user/`) owns credentials, memory, reminders, routines and presence.
- **Files** (`files/`) is an index in SQLite. The bytes live in R2, or in the database when the owner has no R2.
- **Apps** (`apps/`) are Lakebed capsules an agent writes under `/home/apps/<name>/`. A second Worker, `<script>-builder` (`apps/builder`), compiles them. It ships in the same signed release, kiko uploads it with the owner's Cloudflare grant, and kiko reaches it only through the `BUILDER` service binding. It stays a separate Worker because its 14 MB esbuild wasm would otherwise compile on every `OwnerDO` cold start and share that isolate's 128 MB. Lakebed hosts the apps. Kiko keeps one row per app, with the deploy and account tokens sealed.

## A prompt, end to end

1. The client applies the message locally, then sends it over the socket.
2. `OwnerDO` stores the message row and acknowledges it.
3. Human messages that arrive before a short pause form a burst. The burst goes to the agents it addresses.
4. Admission persists a ready ticket and returns. An alarm runs one queued run to completion with a budget of 40 outbound calls. Runs execute one at a time because overlapping events share Cloudflare's subrequest limit. So no run may hold the slot while another agent waits: after 3 calls a run yields at its next task boundary and goes behind the queue, an `ask_human` wait ends as soon as another agent is queued, and the queued agents show who they are waiting for.
5. Each agent writes its reply as short bubbles. Each finished model turn writes one journal row.

## Socket RPC

`core/protocol` is the contract: every wire type is an Effect Schema, and `OwnerRpcs` (`core/protocol/src/rpc.ts`) lists every call a client makes over `/api/rpc`. `apps/server/src/rpc/` speaks the Effect RPC JSON wire format, so the stock `RpcClient` with a socket protocol works against it. There is no other client socket, and the REST routes that duplicated an RPC are gone. HTTP stays for sign-in, `/api/me`, `/api/health`, `/api/version` (probed before sign-in), file bytes and uploads, webhooks, the computer daemon and dev-only routes.

The client reads `/api/version` before each connect. The Worker answers it without waking `OwnerDO`, with the descriptor `{kiko: 1, version, protocol, selfUpdate}`. A protocol other than the client's parks the supervisor in `blocked` instead of a retry loop, and the chats keep painting from the cache, read-only, with the composer disabled. A backend behind `APP_VERSION` that has `selfUpdate` gets `POST /api/update` with no click. The client then polls `GET /api/update` and `/api/version` every 2 s for at most 3 minutes and reconnects without a reload once the descriptor matches. An answer without `kiko: 1`, or a 404, comes from a backend that predates the descriptor and cannot update itself, so the client offers one action: reconnect Cloudflare, which redeploys the Worker.

- **Transports stay thin.** Each entry in `rpc/handlers.ts` calls one service method: `room/commands.ts` for a room, `User`, its `kernel` and `pc` wirings, or `rpc/subscriptions.ts` for streams. Methods are `Effect.fn` spans that fail with the contract's tagged errors, and the dispatcher turns any defect into the `StorageError` every RPC declares.

- **Nothing lives in memory between messages.** Each unary request is decoded, run as an Effect and answered with an `Exit` inside one `webSocketMessage`. A stream subscription is a `{requestId, stream, cursor}` entry in the socket attachment, and broadcasts are turned into `Chunk` frames for it, so a stream survives hibernation. Updating the cursor rewrites the attachment, which is not a billed row.
- **Streams follow t3code.** `user.subscribe` and `room.subscribe` send a snapshot when `afterSequence` is 0 or too far behind to replay, otherwise the events after it, then `synchronized`, then live events and signals. A user replay ends with a projection of every chat, because chat activity is projected from room state and not stored as events. Events at or below the cursor are dropped. Broadcast frames are decoded through the contract's JSON codec before they become stream items, so tagged errors in signals survive the trip.
- **A tab coming back subscribes again from its cursor.** `ConnectionWakeups` turns `application-active` into one fresh subscribe, per room and for the user feed, on the session that is already open; every other wakeup only probes it. The cursor rides in the socket attachment, so a resubscribe replays instead of re-downloading and bills nothing. Because that replay is the server's snapshot of what is still live, the client drops what a sleeping tab kept: typing lines, agent status, and steps still marked running are settled when a chat goes back to `synchronizing`.
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

Customize, Files and Recipes are children of the `_chat` route, not siblings of it, and `app/chat-frame.tsx` renders the chat and the page outlet from the same element. That is what keeps the chat view, its scroll position and the composer draft alive while a page covers it: `Outlet` alone unmounts the previous match's component. The chat stays in the tree but goes `invisible` and `inert` so nothing in it can be read by a screen reader or take a click, and `--top-bar-h` hangs off `main-column:has(chat-view)` rather than off the top bar, because the top bar is not rendered while a page covers the chat. The sidebar reads the room from the previous URL on a covering page (`app/sections.ts:roomForRoute`), so the chat is still there when the page closes.

A chat snapshot is read from IndexedDB once per room per session, on the first of: the row scrolling into view in the sidebar, a hover, or the room opening. `sidebar/warm.ts` warms the visible rows at idle so opening a never-hovered room does not wait on a disk read. Nothing about warming reaches the server, and the atom's idle TTL is what bounds the memory.

The design system follows Cursor's web app, and every value comes from `packages/theme`. A theme is about 18 opaque seeds (`chrome`, `sidebar`, `editor`, `base`, `accent`, `onPrimary`, `focus`, the three status colours and eight hues). `palette.ts` derives everything else from them. Text, icon, fill and stroke each get four or five tiers (`--text-primary..quaternary`, `--icon-*`, `--bg-primary..quinary`, `--stroke-*`), and every tier is `base` mixed toward transparent at a fixed share. A tier therefore reads the same on any surface it lands on, and the contrast setting scales the shares. High-contrast themes use a steeper ladder rather than different seeds. Tones (`--bg-accent`, `--bg-danger-soft` and so on), hues and shadows come from the same seeds, so an imported VS Code theme only has to name the seeds. `gen-palette.ts` writes the dark and light blocks into `index.css`, plus one Tailwind utility per colour token (`bg-tertiary`, `text-secondary`, `icon-tertiary`, `border-secondary`). It also writes the boot bundle in `index.html`. `system.ts` owns the scale: type 11 to 22px with 13px UI text in Geist, four Geist Serif display steps (18 to 36px) for the wordmark and page and empty-state titles, radii, control heights 20/24/28/32, sidebar and conversation geometry, durations, eases and layers. `paint()` sets the palette tokens inline on `<html>`, so CSS cannot override them, and a colour literal in a component is a bug. Icons are Cursor's set on a 300 grid, vendored under `scripts/cursor-icons/` and compiled by `scripts/gen-icons.ts`. Recipe glyphs stay on Phosphor, because the Cursor set has no food icons.

Geist, Geist Mono and Geist Serif are cut from pinned upstream files by `scripts/subset-fonts.py`. It runs by hand, never in the build, and writes `apps/web-solid/src/fonts`, the `fonts` block in `index.css` and the font preloads in `index.html`, so Vite hashes the files into `/assets/`. Geist and Geist Mono each have a core file, exactly the set Fontsource called `latin`, and an extended file behind `unicode-range` with the rest of Latin, Vietnamese and Cyrillic. Each `unicode-range` lists only what its file draws, and CJK and everything else falls through to system fonts. Each extended rule is declared before its core rule. Chromium gives a letter followed by a combining mark to the last declared face that covers both, and only the core then draws `a` plus a macron the way Fontsource's `latin` did. Chromium shapes each file's run on its own, so no kerning crosses a file boundary: the core kerns as it always did, and the script strips kerning between the old Fontsource groups inside each extended file for the same reason. Geist Serif stays one file, since splitting it would change kerning. Weights run 400 to 900, because nothing asks for less. The script drops only the variation deltas below 400 and copies the rest verbatim, since letting fontTools re-encode them moves points. Hinting stays, because Chromium on Linux rasterizes every glyph differently without it. Every OpenType feature the client never turns on is gone. After it writes, the script checks every glyph at six weights, and every pair of characters one file shapes together, against the sources, and exits nonzero on any difference. Rerun it when the client starts using a weight under 400, a feature such as `frac`, `case` or a stylistic set, or when a source is bumped.

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
- **Desktop control is built in, with no driver to install.** `src/desk/` has one backend per OS behind `Backend`: macOS captures with `/usr/sbin/screencapture` and injects with CoreGraphics `CGEvent`, Linux uses X11 `XGetImage` and XTest, Windows uses GDI `BitBlt` and `SendInput`. Steps land in the frontmost app exactly as the owner's own input would. Screenshots shrink to a 1280 long edge, and a step's pixel maps back through the capture's own area, so Retina points and image pixels never mix. There are no element ids; the agent clicks pixels.
- **No desktop is not a broken machine.** Linux without `$DISPLAY` (a Wayland-only session) has no backend, so `caps.desktop` is false, `hello.note` says why, and shell and files keep working.
- **macOS permissions belong to kiko.app.** Bun ad-hoc signs the daemon, so its code hash, and with it every Screen Recording and Accessibility grant, would change with each release. The app is signed with one stable self-signed certificate, its designated requirement is pinned to that certificate's leaf, and the daemon runs as `kiko.app/Contents/MacOS/kiko-core` so TCC attributes it to the bundle. `hello.access` reports what macOS has granted. The daemon asks once at start, rechecks every 30s while something is missing, and reconnects when the answer changes so the app and the agent stop asking.
- **A silent socket is a dead socket.** The daemon closes a socket that has heard nothing, not even a pong, for 50s and dials again, so a sleep or a network change cannot leave it parked on a half-open connection. The hub answers `not connected` at once to a call for a computer whose pings have stopped.
- **`src/live/` is the seam for the live view.** `connection.ts` hands `rtc`, `live`, `input` and `control` frames to the `Live` object it is given. The default in `src/live/index.ts` reports no live capability and still forwards holder changes.
- **Pairing again replaces, never dedupes.** `pair` sends the `pcId` already in the config dir as `replaces`, and the Worker deletes that row in the same turn that inserts the new one, so a re-run install leaves one row. Nothing matches on host or name, because two machines can share both.
- **The daemon never replaces itself.** `welcome` carries the Worker's `BACKEND.version`, and `scripts/build.ts` stamps the same root `package.json` version into the daemon's `VERSION`. On a mismatch the daemon runs `${worker}/pc/install.sh` (or `install.ps1`) with no pair link, so the checksums stay in one place. The installer replaces the whole app and restarts it: `launchctl kickstart -k` on macOS, `systemctl --user restart` on Linux, and on Windows a detached helper that quits `kiko.exe`, waits for it to exit, swaps the files and starts it again. It tries once per served version per process, backs off after a failure, and waits for running calls. A daemon the app did not start skips this, because nothing would replace it.
- **The daemon tells the menu what it is doing.** It writes `state.json` in its config dir (`{connected, name}`) and `agent.json` in the app's dir (`{app}`) only when the value changes, so the menu bar shows the connection and the app the agent is working in without polling the socket.
- **Writes cost nothing here.** The daemon keeps captures, pending calls and the holder in memory. Nothing is written per call or per ping.

## Desktop drivers

`apps/desktop` is the kiko app the owner installs. It serves the driver contract in `crates/kiko-driver` (JSON lines over a local socket that it passes to `kiko-core` as `KIKO_DRIVER`) and implements `kiko_driver::Native` once per OS. Background mode never moves the pointer, changes focus or raises a window; a route that cannot honor that answers `background_unavailable` and says foreground mode would work.

- **Linux keeps AT-SPI on its own thread.** `crates/kiko-native-linux` owns a current-thread Tokio runtime on a dedicated thread, so the synchronous trait never touches the owner's executor. Every proxy disables zbus property caching (`CacheProperties::No`): Qt5's AT-SPI bridge reads the second argument of every `Properties` call and segfaults on the one-argument `GetAll` that lazy caching sends.
- **A window id is the AT-SPI bus name plus object path.** It survives restacking. `_NET_CLIENT_LIST`, `_NET_WM_PID` and the title map it to an X window, so capture and foreground input share one identity, and `_NET_ACTIVE_WINDOW` and `_NET_WM_STATE_HIDDEN` decide `focused` and `minimized`.
- **Capture reads the window manager's frame, not the client window.** Xvfb, and some X servers, only redirect direct children of the root, so `NameWindowPixmap` fails on a reparented client; the driver names the top ancestor's pixmap and crops the client rect out of it. That is why a fully covered window still returns its own pixels.
- **Focus is foreground-only on Linux.** AT-SPI `GrabFocus` raises the window, so background `focus` and `key` answer `background_unavailable`; background typing goes through `EditableText` instead. Foreground input is XTest after `_NET_ACTIVE_WINDOW`. A Wayland-only session has neither until the RemoteDesktop portal lands, so it answers `background_unavailable` too.
- **Chromium exposes actions without names.** Its buttons answer `GetActions` with blank names, so a press falls back to action 0 when every name is empty.

## Releases

`scripts/release.ts` builds and signs a release, and the release workflow publishes it to `latest-owner.json`. The workflow commits the version bump off `main` and pushes only its tag, because `main` accepts changes only through a pull request with green CI and has no bypass. The newest `v*` tag is the current version; `package.json` on `main` can lag behind it. Owner Workers migrate from one baseline tag, `v5`, which creates `OwnerDO`. `core/durable/src/release.ts` refuses any signed manifest with `deleted_classes`, so neither an update nor an install can delete stored data.

The same signed manifest names the kiko app archives (`kiko-macos-universal.zip`, `kiko-windows-x64.zip`, `kiko-linux-{x64,arm64}.tar.gz`) and the five bare `kiko-computer` daemon binaries with their sha256, and the release uploads all of them to the GitHub release for its tag. The bare binaries stay for one release cycle so an install that has not updated yet can still fetch its own update. A Worker serves `GET /pc/install.sh` and `/pc/install.ps1` from `BACKEND.version`, pinning the hashes it reads back from that manifest and verifying its signature first, so an install never runs an archive the release did not sign.

The installer replaces whatever was there: on macOS it unpacks `~/Applications/kiko.app` beside the old one and renames it into place, then points a `com.kiko.computer` LaunchAgent at `kiko.app/Contents/MacOS/kiko`; on Linux it writes `~/.local/share/kiko/{kiko,kiko-core}`, a systemd --user unit (or an autostart entry when there is no user session) and the desktop entry; on Windows it unpacks `%LOCALAPPDATA%\kiko` and a HKCU Run entry. It pairs through `kiko-core pair`, keeps the config dir, and deletes the old daemon install — the launchd job and `.move` job, the systemd unit, the Run value and the binaries — only after the new app has started.

Config that is the same for every owner ships in the release, not in the owner's Worker: the Clerk public key, the trusted front-door origin, and the release base and signing key are constants in `apps/server/src/lib/release-config.ts`. Production ignores env copies of them, so a self-update repairs any drift and a Clerk key rotation needs a release. DEV may override them from `.dev.vars`. `core/durable/src/clerk-token.ts` is the one Clerk verifier, shared with the installer.

`GET /api/version` is the frozen descriptor `{kiko: 1, version, protocol, selfUpdate}`. The Worker answers it without waking `OwnerDO`, and fields may be added but never removed. `ensureHome` seeds the Kiko chat on the first user subscribe of each object instance, not on sign-in or `/api/me`.

`POST /api/update {version}` starts a self-update and `GET /api/update` reads it: `idle`, `uploading`, `restarting`, or `failed` with one of `no_grant`, `grant_refused`, `release_unavailable`, `release_untrusted` and `cloudflare_error`. A start while one runs returns that run's state. The update is one upload that lists every binding: the release's Durable Object bindings, then `inherit` for each binding the Worker keeps, minus the config the release now ships. A token refresh can rotate the Cloudflare refresh token, so the object stores the newest grant sealed next to the sha256 of the `CF_GRANT` it came from, and uses it only while that hash matches. A reconnect writes a new `CF_GRANT`, so it always wins, and an update writes at most that one row.

## Installing

The owner's Worker is the one record of who owns it: `OWNER_ID` is a `plain_text` binding, so the installer reads it through Cloudflare's settings API and never calls the backend. Control of the Cloudflare account is the root of trust; the Clerk pointer (`publicMetadata.kiko = {v: 1, url, accountId, script}`) and the browser's record are caches, and `OWNER_ID` wins when they disagree.

- **Scan, then act.** `apps/installer/src/scan.ts` classifies every `kiko` or `kiko-*` script: `Mine` (`OWNER_ID` is the caller), `Other` (another `OWNER_ID`), `Unclaimed` (it has a Durable Object binding but no readable `OWNER_ID`, which is every install made before this scheme) or `Foreign` (no Durable Object, never touched). `Mine` redeploys in place. `Other` and `Unclaimed` answer `decide` until the caller sends `take_over`, which keeps the data and needs a migration tag the release knows, or `start_fresh`, which deletes the script with `?force=true` first. An empty account gets `kiko`, unless a `Foreign` script holds that name.
- **One upload writes every binding.** The upload lists the release's Durable Object bindings, `OWNER_ID`, a fresh `CF_GRANT`, new secrets where needed, and `inherit` for everything kept, so no follow-up secret writes exist and stale bindings fall away.
- **A new owner rotates the session secret.** Every take-over and every fresh install writes a new `SESSION_SECRET`, so the previous owner's sessions, file links and pair codes die at once. `CREDENTIALS_KEK` is never rotated, because it seals the stored keys and grant. On start, `OwnerDO` compares `OWNER_ID` with the owner it last saw and deletes every paired computer when it changed; that check writes one row per change, not per start.
- **Every failure names its retry.** `same` retries with the same grant, reusing the OAuth tokens the installer keeps for ten minutes; `new-grant` needs a new Cloudflare sign-in; `token` needs a new API token. One `Installer` object per Clerk user serializes that user's installs and detaches.
- **Detach clears the pointer only.** `POST /detach` leaves the Worker and its data in place, so connecting the same account again finds it as `Mine`.

## Hosted Workers

`infra/` owns the two Workers Kiko itself serves: the front door (`kiko-app`, `app.kiko.works`) and the installer (`kiko-installer`, `api.kiko.works`). `infra/alchemy.run.ts` declares both with Alchemy and deploys them from `.github/workflows/deploy.yml`. The owner Worker (`apps/server/wrangler.jsonc`) is not here: the installer uploads it into an owner's account, so it keeps its wrangler config, `wrangler dev` and the `release.ts` dry-run.

- **Adoption, never recreation.** Both Workers were created by `wrangler deploy` before Alchemy owned them, so the stack wraps its body in `adopt(true)`. Adopting leaves the live Durable Object namespace (`Installer`) and its data in place; a first deploy reports `adopted` and one binding create, and later deploys are no-ops.
- **`plan` and `deploy` need the Cloudflare state store.** `Cloudflare.state()` keeps state in an `alchemy-state-store` Worker on the account, which the deploy job creates or adopts with `alchemy provider cloudflare bootstrap` before every deploy.
- **`legacy_module_registry` is pinned** on both Workers. Alchemy defaults new Workers to `new_module_registry`, and flipping the registry under a running Worker is a code change no deploy can undo. Drop the flag deliberately, with a deploy that expects the switch.
- **`apps/server/wrangler.front-door.jsonc` stays for the CI bundle gate only.** `wrangler deploy --dry-run` there and in `release.ts` needs no credentials, so CI keeps a bundle check on every entry point; the deploy itself ignores these two configs.
- **The installer's Clerk key comes from the deploy.** Alchemy binds `CLERK_JWT_KEY` from the `CLERK_JWT_KEY` repository variable, the same PEM public key the release embeds. A deploy without it fails before it builds anything.
- **The other installer secrets are set once, out of band.** The installer reads `CLERK_SECRET_KEY`, `CF_OAUTH_CLIENT_ID`, `RELEASE_BASE_URL`, `RELEASE_PUBLIC_KEY` and `TRUSTED_ORIGINS` as `secret_text` bindings that Alchemy does not declare. Cloudflare keeps an undeclared secret binding on upload, so a deploy neither needs those values nor wipes them.
