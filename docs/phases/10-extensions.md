# Phase 10. User extensions

Users and agents add pi-durable extensions while kiko runs, on the Free plan, without a deploy. An extension is a manifest and a few JavaScript files that run in a QuickJS sandbox inside the agent's object. The human installs every one. Architecture section 24 has every decision.

The owner asked for this phase on 2026-10-04 and gave full authority over it. It shipped in one change, so the tasks below record what was built and how each part is verified.

## Tasks

### P10-01 Prove QuickJS runs in a Durable Object

`deps: none` `difficulty: 2` `area: backend` `parallel: no`

**Verify.** A throwaway Worker under `wrangler dev` imports `quickjs-wasi/quickjs.wasm`, runs a module that awaits a host promise, and stops `while (true) {}` with the interrupt handler.

**Goal.** Settle whether a bundled interpreter runs extension code on Workers without Dynamic Workers.

**Build.**

- Count interrupt calls, not time: the Workers clock does not move during computation.
- Measure the VM start and a hook call. Record them in architecture section 24.1.

### P10-02 Define the extension format

`deps: P10-01` `difficulty: 2` `area: docs`

**Verify.** `bun test` in `packages/protocol` passes `test/extensions.test.ts`, and a manifest with a bad name, a secret for a host outside `egress`, or a wrap of a safety section is refused with each problem named.

**Goal.** One manifest format, checked the same way on the server, in the CLI, and in the client.

**Files.** `packages/protocol/src/extensions.ts`, `user.ts`, `schema.ts`.

**Build.**

- The manifest mirrors pi-durable: `tools`, `sections`, `hooks`, `wraps`, plus `calls`, `egress`, `secrets`, `state`, `triggers`, `tests`.
- `checkManifest` and `checkBundle` return every problem as one plain line.
- `describeManifest` turns the manifest into the review lines the human reads.
- The user socket frames, events, and snapshot fields for extensions.

### P10-03 Build the sandbox and the compiler

`deps: P10-02, P7-01, P1-10` `difficulty: 4` `area: backend`

**Verify.** `bun run --cwd apps/server test script-vm user-extensions` passes: an infinite loop is stopped, a fetch taints the run so trust blocks the next external call, a read tool cannot fetch or call a write tool, and trust is selected last.

**Goal.** A user extension becomes an ordinary pi-durable extension whose every call the manifest limits.

**Files.** `apps/server/src/agent/script/vm.ts`, `compile.ts`, `check.ts`, `wasm.ts`. Edit `agent/factory.ts`.

**Build.**

- One VM per extension version per agent process, with a CPU budget, a memory cap, and a wall deadline.
- `kiko.call`, `kiko.fetch`, `kiko.state`, `kiko.next`, `kiko.log`, each checked per call.
- `UserExtensions` in the factory: sync installs, removes, and reports clashes; the selection ends with trust.

### P10-04 Store extensions in UserDO

`deps: P10-02` `difficulty: 3` `area: backend`

**Verify.** `bun run --cwd apps/server test extension-store` passes: a secret goes only to its own hosts, an echoed secret never reaches the script, and one user never sees another's extension.

**Goal.** Extensions are data the user owns, with secrets sealed and state scoped.

**Files.** `apps/server/src/user/extensions.ts`. Edit `user/user-do.ts`, `user/reminders.ts`, `lib/safe-fetch.ts`.

**Build.**

- Proposals, install, switches, agents, secrets, state, uninstall.
- `safeRequest`: one request with a method, headers, and a body, that never follows a redirect.
- Triggers as reminders made by `ext:<name>`.

### P10-05 Sync extensions into each run

`deps: P10-03, P10-04` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify extensions` passes against the dev server.

**Goal.** An install, a switch, or an update reaches the next run without a deploy.

**Files.** Edit `apps/server/src/agent/agent-do.ts`, `agent/dev-fake.ts`, `src/index.ts`.

### P10-06 Let agents write extensions

`deps: P10-05, P5-08, P8-05` `difficulty: 3` `area: backend`

**Verify.** `user-extensions.test.ts` shows `extension_check` naming a missing export, a failing test, and a call the extension may not make.

**Goal.** An agent writes, checks, and proposes an extension from the chat's files.

**Files.** `apps/server/src/agent/extensions/builder.ts`, `apps/server/skills/build-an-extension/SKILL.md`.

### P10-07 Build the extensions settings page

`deps: P10-04` `difficulty: 3` `area: frontend`

**Verify.** In a browser, a catalog extension is added, reviewed, installed, switched off, and removed, and each change shows before the server answers.

**Goal.** One place to review and manage extensions.

**Files.** `apps/web-solid/src/settings/extensions.tsx`, `line-diff.ts`, `sections.ts`, `settings-shell.tsx`. Edit `sync/user-store.ts`, `warm/chats.ts`, `files/pane.tsx`, `sidebar/settings/sidebar.tsx`.

### P10-08 Seed the catalog

`deps: P10-06` `difficulty: 2` `area: backend`

**Verify.** `user-extensions.test.ts` passes "every catalog extension passes extension_check with its own tests" and "the generated file is current".

**Goal.** Seven reviewed starters: weather, path-guard, tally, slack-post, daily-plan, house-style, decision-log.

**Files.** `apps/server/catalog/`, `apps/server/scripts/gen-catalog.ts`, `apps/server/src/user/catalog.gen.ts`.
