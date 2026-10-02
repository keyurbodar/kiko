# Phase 4. Providers and models

This phase replaces the development key with each user's own provider credentials. At the end, a user connects a provider in settings, picks a model, and chats with it. A user with no provider sees a prompt to connect one.

Kiko holds no model list and no provider adapter of its own. Everything comes from `pi-ai`.

## Tasks

### P4-01 Build the encrypted credential store

`deps: P1-05` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify credentials` passes: save a key, read back only the last four characters, disconnect, and see the row gone. `bun test apps/server/test/credentials.test.ts` passes a wrong-user decrypt failure and a key rotation.

**Goal.** Store provider credentials per user, encrypted, with `UserDO` as the only owner.

**Read first.** Architecture sections 11.1 and 11.2. `refs/pi/packages/ai/src/auth/types.ts`.

**Files.** Create `apps/server/src/user/credentials.ts`, `apps/server/src/lib/crypto.ts`, and tests.

**Build.**

- Derive the data key with HKDF-SHA256 from `CREDENTIALS_KEK` and the user id. Encrypt with AES-256-GCM, a random 12-byte IV, and `userId || providerId` as additional data.
- Store `kek_version` per row and support decrypting with an older secret during rotation.
- Implement pi-ai's `CredentialStore` over the table.
- RPC methods `connect(provider, apiKey)`, `disconnect(provider)`, and `listProviders()`, which returns provider id, kind, and last four characters.
- Never log a credential. Add a test that greps the log output of the suite for the test key.

**Done when.** No method returns a full credential to the Worker's HTTP layer.

### P4-02 Use each user's credentials in a run

`deps: P4-01, P1-12` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify byok` passes: a user with a connected provider gets an answer, a user with none gets a `no_provider` event and no run, and disconnecting mid-conversation makes the next message return `no_provider`.

**Goal.** Make every model request use the calling user's own credentials.

**Read first.** Architecture section 11.3.

**Files.** Create `apps/server/src/user/turn-context.ts`. Edit `apps/server/src/agent/factory.ts` and `host.ts`.

**Build.**

- Add `UserDO.turnContext(provider)`, which returns request auth, the timezone, and the limits. Later tasks add memory to the same call.
- Refresh an expired OAuth token inside `UserDO` before returning it.
- Call `turnContext` once at the start of a run and build a per-run `Models` from the result.
- Delete the dev-only `OPENCODE_API_KEY` path from the factory. The verify suites connect the test provider through `connect` like any user.
- Store the chosen model per room and per agent.

**Done when.** `git grep OPENCODE_API_KEY apps/server/src` finds nothing.

### P4-03 Serve the model catalog as a static asset

`deps: P0-08` `difficulty: 2` `area: infra`

**Verify.** `bun run build` in `apps/web-solid` emits `models-<hash>.json`, and `bun test scripts/build-catalog.test.ts` checks that every entry has provider, id, context window, and pricing.

**Goal.** Give the settings screen the `pi-ai` catalog without shipping it in the app bundle.

**Read first.** Architecture section 11.5. `docs/research/experiment-5-bundle-and-catalog.md`.

**Files.** Create `scripts/build-catalog.ts` and a Vite plugin entry in `apps/web-solid/vite.config.ts`.

**Build.**

- Read providers and models from `pi-ai` at build time and write one hashed JSON file with the fields the interface needs.
- Include for each provider which connect methods `pi-ai` offers (API key, device code, paste code).
- Add nothing by hand. A provider that `pi-ai` adds appears after a version bump and a rebuild.

**Done when.** The file is immutable-cached and loaded only by the settings route.

### P4-04 Bridge provider sign-in flows to the browser

`deps: P4-01, P0-08` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify provider-login --fake` passes with a fake provider that uses both `notify` and `prompt`. One real device-code flow is shown working by hand in the pull request.

**Goal.** Let a user sign in to a provider with the flow `pi-ai` offers, from the browser.

**Read first.** Architecture section 11.4. `docs/research/pi-packages.md`, section 1.

**Files.** Create `apps/server/src/user/provider-login.ts`. Edit the user socket.

**Build.**

- Run `Models.login(interaction)` inside `UserDO`. Send `notify` events to the client as `login.notify` frames and resolve `prompt` from a `login.answer` frame.
- Time out a login after 10 minutes and clean up.
- Enable only the flows that P0-08 showed can import on Workers.
- Put subscription sign-in behind the `PROVIDER_OAUTH` flag, off by default, as section 11.4 explains.

**Done when.** A login that the user abandons leaves no pending state in `UserDO`.

### P4-05 Build the provider and model settings

`deps: P4-03, P4-01, P2-07` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` providers feature: connect the test provider by pasting a key, see the last four characters, pick a model for a chat, and disconnect.

**Goal.** Let a user manage providers and choose models.

**Read first.** Product document, "Models and providers".

**Files.** Create `apps/web-solid/src/settings/providers.tsx`, `settings/model-picker.tsx`, and the settings route shell.

**Build.**

- A provider list generated from the catalog asset, with a connect dialog per provider and the methods the catalog lists for it.
- A model picker with search, context size, and price, usable from settings and from the chat top bar.
- Clear the key field on submit and never write the key to a store, to IndexedDB, or to the URL.
- Render the settings lists with `content-visibility: auto`.

**Done when.** The saved key is not in any store, log, or IndexedDB record after connecting.

### P4-06 Prompt for a provider in the chat

`deps: P4-02, P2-08` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` onboarding feature: a new account sends a message, sees the connect prompt in the transcript, connects, and the held message gets its answer.

**Goal.** Never fail a chat because no provider is connected.

**Files.** Create `apps/web-solid/src/chat/ConnectProvider.tsx`.

**Build.**

- Render a `no_provider` event as an inline card with a connect button that opens the dialog from P4-05.
- After a provider connects, resend the held burst.
- Show the same card on the empty state of a new account.

**Done when.** The human's message is never lost while the prompt is shown.

### P4-07 Show usage per chat

`deps: P4-02, P2-08` `difficulty: 2` `area: backend`

**Verify.** `bun kiko verify usage` passes: after one turn, the room reports input tokens, output tokens, and a cost that matches the catalog price for the test model.

**Goal.** Show a user what a chat has cost them.

**Read first.** `refs/pi/packages/durable/README.md`, "Usage and Cost".

**Files.** `apps/server/src/agent/outbox.ts`, `apps/server/src/room/log.ts`. Create `apps/web-solid/src/chat/UsageMeter.tsx`.

**Build.**

- At the end of a run, read `harness.usage()` and post the run's delta to the room.
- Keep running totals per room and per agent.
- Show the total in the chat's top bar menu.

**Done when.** A subagent's usage is counted once.
