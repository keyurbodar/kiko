# Phase 0. Foundation and experiments

This phase builds the empty server, the CLI, and CI, and it runs the ten experiments from architecture section 21. P0-05 proves that `pi-durable` runs inside a Durable Object. No task that builds on `AgentDO` starts until it passes. Frontend tasks do not wait for it.

An experiment task ends with a short result file in `docs/research/` and, where the result changes a decision, an edit to `docs/architecture.md`.

## Tasks

### P0-01 Scaffold the server Worker and the workspace

`deps: none` `difficulty: 2` `area: infra` `parallel: no`

**Verify.** `bun dev:server` starts and `curl localhost:8787/api/health` returns `{"ok":true}`. `bunx wrangler deploy --dry-run` succeeds in `apps/server`.

**Goal.** Create `apps/server` as one Worker with every binding the architecture names, so later tasks add code and never touch the root config.

**Read first.** Architecture sections 3, 4, and 20.

**Files.** Create `apps/server/` (`wrangler.jsonc`, `src/index.ts`, `src/user/user-do.ts`, `src/room/room-do.ts`, `src/agent/agent-do.ts`, `package.json`, `tsconfig.json`). Edit the root `package.json`.

**Build.**

- Set root `workspaces` to `apps/*` and `packages/*`. Add root scripts `dev:server`, `dev:web`, `typecheck`, `test`, `kiko`, and `plan`.
- Declare three SQLite-backed Durable Object classes (`UserDO`, `RoomDO`, `AgentDO`) as empty classes with a migration tag.
- Declare bindings for D1 (`AUTH_DB`), R2 (`FILES`), KV (`PREVIEWS`), one queue (`JOBS`), and static assets that point at `apps/web-solid/dist`.
- Turn on `nodejs_compat`. Add `.dev.vars.example` with `OPENCODE_API_KEY`, `CREDENTIALS_KEK`, and `BETTER_AUTH_SECRET`. Add `.dev.vars` to `.gitignore`.
- Add `GET /api/health`.

**Done when.** Every binding resolves under `wrangler dev` and typecheck passes. No secret value is in git.

### P0-02 Clean the frontend baseline

`deps: none` `difficulty: 2` `area: frontend`

**Verify.** `bun run typecheck` and `bun test` pass in `apps/web-solid` and `packages/ui`. `bun run build` output contains no `chat-harness` file.

**Goal.** Remove dead weight from the client before anyone builds on it.

**Read first.** `docs/research/frontend-current.md`, sections 1, 7, 8, and 9.

**Files.** `apps/web-solid/package.json`, `apps/web-solid/vite.config.ts`, `apps/web-solid/OWNERSHIP.md`, `packages/ui/package.json`, `apps/web-solid/dist/`.

**Build.**

- Remove unused dependencies: `class-variance-authority` in the app, `@tanstack/solid-query`, `@thisbeyond/solid-dnd`, `culori`, `@solid-primitives/bounds`, and `@solid-primitives/media` in `packages/ui`. Keep `@solidjs/router` and `@solidjs/meta`, which P2-02 uses. Keep `blobatar`, which nothing imports directly but `@blobatar/solid` requires as a peer dependency.
- Keep `src/chat/harness.html` for development and drop it from the production build inputs.
- Delete the stale `dist/` directory. Git already ignores it.
- Delete `OWNERSHIP.md`. Fix `src/composer/ATTRIBUTION.md` so it names only files that exist.
- Remove one of the two scroll-to-latest controls.

**Done when.** The checks pass and `git grep` finds no import of a removed package.

### P0-03 Define the wire protocol package

`deps: P0-01` `difficulty: 3` `area: backend`

**Verify.** `bun run typecheck` passes in `packages/protocol`, and `bun test packages/protocol` passes the fixture round-trip test.

**Goal.** Put every type that crosses the network in one package that the client, the server, and the CLI import.

**Read first.** Architecture sections 6.4, 7.1, and 9.2.

**Files.** Create `packages/protocol/` (`src/room.ts`, `src/user.ts`, `src/envelope.ts`, `src/rich-text.ts`, `src/ids.ts`, `src/fixtures.ts`).

**Build.**

- Write `ClientToRoom`, `RoomToClient`, `RoomEvent`, `RoomSnapshot`, `ClientToUser`, `UserToClient`, `Envelope`, and the rich text tree as plain TypeScript types with no runtime dependency.
- Brand the id types (`UserId`, `RoomId`, `MessageId`, `AgentSlug`) and export the slug pattern.
- Export a small set of fixture frames that the mock room and the tests share.
- Export Effect `Schema` versions from a separate entry (`@kiko/protocol/schema`) for the server and the CLI only.

**Done when.** Importing `@kiko/protocol` from the client adds no runtime code to the client bundle.

### P0-04 Scaffold the kiko CLI

`deps: P0-01` `difficulty: 2` `area: backend`

**Verify.** `bun kiko health --url http://localhost:8787` prints `ok` and exits 0. It exits 1 when the server is down.

**Goal.** Create the command that every backend task uses to prove its work.

**Read first.** Architecture section 20.

**Files.** Create `apps/cli/` (`src/main.ts`, `src/commands/health.ts`, `src/commands/ws.ts`, `package.json`).

**Build.**

- Parse `kiko <command> [flags]` with a `--url` flag that defaults to the local dev server and a `--json` flag for machine output.
- Add `health`, and `ws <path>`, which opens a WebSocket, sends frames from stdin, and prints frames it receives as JSON lines.
- Exit non-zero on any failure, with one line that says what failed.

**Done when.** The two commands work against `wrangler dev`.

### P0-05 Prove pi-durable in a Durable Object

`deps: P0-01` `difficulty: 5` `area: backend`

**Verify.** `bun test apps/server/test/sqlite-conformance.test.ts` passes the `pi-durable` storage conformance suite inside workerd, and `curl -X POST localhost:8787/api/experiments/turn` returns a model answer after the dev server was restarted mid-run.

**Goal.** Settle experiment 1. This is the gate for the whole plan.

**Read first.** Architecture sections 2, 4.4, and 21. `docs/research/pi-durable.md`, sections 2 and 4. `refs/pi/packages/durable/src/storage/sqlite/database.ts`.

**Files.** Create `apps/server/src/agent/sqlite.ts`, `apps/server/test/sqlite-conformance.test.ts`, `apps/server/src/experiments/turn.ts`, and `docs/research/experiment-1-durable-in-do.md`.

**Build.**

- Add `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, and `@earendil-works/chord` at exact versions.
- Implement `SqliteDatabase` over `ctx.storage.sql` and `ctx.storage.transaction()`. Queue unrelated operations while a transaction runs, as the interface comment requires.
- Run the conformance suite that `pi-durable` exports from its `testing` entry against the facade, using `@cloudflare/vitest-pool-workers`.
- In a throwaway route, open a `Harness` in `AgentDO`, run one turn on the test model with the key from `OPENCODE_API_KEY`, kill the process mid-stream, and show that an alarm plus `harness.resume()` finishes the run.
- Record what worked, what needed a workaround, and the measured cold-open time.

**Done when.** The result file states pass or fail in its first line. On fail, stop and report. Do not work around a failing conformance case.

### P0-06 Measure the cost of one turn

`deps: P0-05` `difficulty: 3` `area: backend`

**Verify.** `bun kiko measure turn --runs 5` prints rows written, rows read, requests, CPU ms, and wall time per turn, and `docs/research/experiment-2-turn-cost.md` contains that output.

**Goal.** Settle experiments 2 and 4 and replace the estimates in architecture section 17 with measurements.

**Read first.** Architecture section 17.

**Files.** Create `apps/cli/src/commands/measure.ts` and `docs/research/experiment-2-turn-cost.md`. Edit `docs/architecture.md` section 17.

**Build.**

- Count rows with `cursor.rowsWritten` and `cursor.rowsRead` inside the facade from P0-05, behind a debug flag.
- Read CPU and wall time from the `wrangler tail` invocation log.
- Run the same turn on a deployed Free-plan preview to see whether the 10 ms CPU limit applies inside a Durable Object.
- Redo the tables in section 17 with the measured numbers and remove the ESTIMATE label.

**Done when.** Section 17 cites the result file and its user counts follow from the measured numbers.

### P0-07 Prove write coalescing

`deps: P0-05` `difficulty: 4` `area: backend`

**Verify.** `bun test apps/server/test/coalescing-storage.test.ts` passes the conformance suite through the wrapper, and `bun kiko measure turn --coalesce` reports fewer rows written than without the flag.

**Goal.** Settle experiment 3. Decide whether the Free plan is a real tier or a demo tier.

**Read first.** Architecture section 17.5. `refs/pi/packages/durable/src/types.ts` (the `Storage` and `StorageWrite` types) and `src/harness/generation.ts` (the partial commit path).

**Files.** Create `apps/server/src/agent/coalescing-storage.ts`, its test, and `docs/research/experiment-3-coalescing.md`. Edit `docs/architecture.md` section 17.5.

**Build.**

- Wrap `SqliteStorage` in a `Storage` that holds partial-output writes in memory and flushes them every 2 seconds and before any other write.
- Find out from the `StorageWrite` shape whether a partial write can be told apart. If it cannot, record that and stop.
- Show that a crash inside the 2-second window still resumes to a correct answer.

**Done when.** Section 17.5 states the decision as verified or withdrawn, with the measured rows per turn.

### P0-08 Check bundle size, the model catalog, and provider imports

`deps: P0-01` `difficulty: 3` `area: backend`

**Verify.** `docs/research/experiment-5-bundle-and-catalog.md` lists the Worker bundle size from `wrangler deploy --dry-run --outdir`, the startup time, the catalog location, the test model id, and one line per provider sign-in module with "imports" or "fails".

**Goal.** Settle experiments 5, 6, and 7.

**Read first.** Architecture sections 11.4, 11.5, and 11.6. `docs/research/pi-packages.md`, section 1.

**Files.** Create `apps/server/src/experiments/imports.ts` and the result file. Edit architecture section 11.

**Build.**

- Build the Worker with `pi-ai`, `pi-durable`, and TypeBox imported and record the size and startup time.
- Inspect the published `pi-ai` package for the generated model catalog. If it is missing, record how pi's `generate-models.ts` can run at build time.
- Find the catalog id for "deepseek v4.1 flash" under the `opencode-go` provider.
- Import each provider's OAuth module under `wrangler dev` and record whether it loads.

**Done when.** Architecture section 11 has no UNVERIFIED label left for these three items.

### P0-09 Register kiko as an Executor OAuth client

`deps: P0-01` `difficulty: 3` `area: backend` `human: yes`

**Verify.** `bun kiko executor probe` prints the tool names returned by `tools/list` from `https://executor.sh/mcp` for a real account, and `docs/research/experiment-8-executor-oauth.md` records the flow that worked.

**Goal.** Settle experiment 8. Prove that a Worker can get a per-user credential for Executor Cloud.

**Read first.** Architecture section 12. `docs/research/executor.md`.

**Files.** Create `apps/cli/src/commands/executor.ts`, `apps/server/src/experiments/executor-oauth.ts`, and the result file.

**Build.**

- Recommend Executor Cloud to the owner and wait. A human must create the Executor account and complete the first sign-in in a browser.
- Run discovery, dynamic client registration, and the PKCE code exchange with `@earendil-works/pi-mcp` from a Worker route.
- Call `tools/list` with the token. Record the access-token lifetime and whether a refresh token arrived.
- If registration is refused, repeat with a personal API key and record that the API-key path is the only one.

**Done when.** The result file names the working flow and lists the tools seen. No token is committed.

### P0-10 Prove a Solid binding for headless-tree

`deps: P0-02` `difficulty: 3` `area: frontend`

**Verify.** Open `http://localhost:5173/src/experiments/tree.html`. A 1,000-node tree expands, collapses, and moves selection with the arrow keys, and `docs/research/experiment-9-headless-tree.md` records the bundle cost.

**Goal.** Settle experiment 9.

**Read first.** Architecture section 19.9. `docs/research/kat-ui.md`, the file tree section.

**Files.** Create `packages/ui/src/v2/components/tree/create-tree.ts`, `apps/web-solid/src/experiments/tree.html`, and the result file.

**Build.**

- Add `@headless-tree/core`. Write `createTree`, a Solid binding that maps the core's state to signals.
- Render 1,000 nodes with expand, collapse, selection, and keyboard movement. No styling beyond indent.
- Record the gzip size the core adds.

**Done when.** The result file says keep or replace. On replace, it names the fallback from architecture section 21.

### P0-11 Check recurrence across daylight-saving changes

`deps: P0-01` `difficulty: 2` `area: backend`

**Verify.** `bun test apps/server/test/recurrence.test.ts` passes inside workerd.

**Goal.** Settle experiment 10 and leave behind the function that reminders use.

**Read first.** Architecture section 14.

**Files.** Create `apps/server/src/user/recurrence.ts` and its test.

**Build.**

- Write `nextOccurrence(rrule, tz, afterUtc)` on the `rrule` package.
- Test "every day at 09:00" and "every monday at 09:00" in `America/New_York` and `Europe/Berlin` across both daylight-saving changes of one year. The local time must stay 09:00.
- If a case fails, switch to `rrule-temporal` and record why in architecture section 14.

**Done when.** The tests pass and section 14 has no ASSUMPTION label for the library.

### P0-12 Add CI for typecheck, tests, and the plan check

`deps: P0-01` `difficulty: 2` `area: infra`

**Verify.** A pull request that breaks typecheck fails the workflow. `bun scripts/plan.ts --check` runs in the workflow and passes.

**Goal.** Catch broken types, broken tests, and a stale plan on every pull request.

**Files.** Create `.github/workflows/ci.yml`. Wire `ultracite-agents.md` standards to a real lint config (`biome.json`).

**Build.**

- Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, the lint check, and `bun scripts/plan.ts --check`.
- Cache the Bun install directory.
- Do not add a job that needs a model key.

**Done when.** The workflow passes on `main` and fails on a deliberately broken branch.

### P0-13 Create the backend verification skill

`deps: P0-04` `difficulty: 3` `area: docs`

**Verify.** A fresh agent session that is told only "verify the server" finds the skill and runs `bun kiko health` without other guidance.

**Goal.** Give agents one documented way to drive the backend the way a user does.

**Read first.** `.cursor/skills/verify-kiko/SKILL.md`, which covers the frontend.

**Files.** Create `.cursor/skills/verify-kiko-server/SKILL.md` and `features/`. Make `.claude/skills` a link to `.cursor/skills`.

**Build.**

- Run the `create-verification-skill` skill for the server. The driver is the kiko CLI against `wrangler dev`.
- Write one feature file per CLI suite as suites appear. Start with `health`.
- State the rule that a task adds its suite to the map in the same pull request.

**Done when.** The skill lists how to start the server, how to run a suite, and where suites live.

### P0-14 Upgrade Vite and compare the build

`deps: P0-02` `difficulty: 2` `area: frontend`

**Verify.** `bun run build` in `apps/web-solid` succeeds on Vite 8, tests pass, and the pull request description states the JS and CSS sizes before and after.

**Goal.** Move the client to the Rolldown-based Vite if the output is no larger.

**Read first.** Architecture section 19.3.

**Files.** `apps/web-solid/package.json`, `apps/web-solid/vite.config.ts`, `packages/ui/package.json`.

**Build.**

- Upgrade `vite`, `vite-plugin-solid`, and `@tailwindcss/vite` to versions that support Vite 8.
- Build before and after and record the sizes.
- If the build or the tests break in a way that takes more than this session, revert and record the reason in architecture section 19.3.

**Done when.** The client builds on one Vite version and section 19.3 has no ASSUMPTION label for it.
