# @kiko/extensions (parked)

Parked 2026-10-15. The user-extensions feature lives here and is imported by nothing, so none of it reaches the Worker bundle. It is outside the gate: `biome.json` ignores this folder, `scripts/check-exports.ts` skips it, and this package declares no `typecheck` or `test` script. The `UserDO` extension tables stay in `apps/server/src/user/schema.ts`, because migration steps are counted by list length and a step must never be removed from the middle.

To bring the feature back: move the modules back under the apps, re-add the protocol types and events, wire the `UserDO` and `AgentDO` call sites and the catalog build, restore the client store and Settings surface, and re-add the package to the workspace gate.

What follows is the original architecture section 24, moved here unchanged.

## 24. User extensions

Users and agents add pi-durable extensions while kiko runs, on the Free plan, without a deploy. An extension is a JSON manifest and a few JavaScript files. The manifest says what the extension is and what it may do. The server enforces exactly that. The script runs in QuickJS inside the agent's object.

### 24.1 Decision

- An extension is data: `extension.json` plus files, stored by content hash in the user's `UserDO`. User extensions never live in the repository, so a pull from upstream never conflicts with them.
- The manifest mirrors pi-durable's extension points one to one: `tools`, `sections`, `hooks`, `wraps`. Kiko adds `calls`, `egress`, `secrets`, `state`, `triggers`, and `tests`. The format is versioned by `"yuki": 1` and checked by `checkManifest` in `core/sandbox/src/manifest.ts`, which `@kiko/protocol` re-exports: the same function on the server, in the CLI, and in the client. The trigger rate rule is the one check that needs `rrule`, so it runs apart from that function, in `triggerGapProblems` (`core/sandbox/src/recurrence.ts`), on the server's check and install only.
- DEVIATION (U20): the section key is `<extension>_<id>`, not `name:id`. pi-durable's key pattern has no colon, and `_` cannot appear in a name or id, so two extensions cannot share a key.
- The script is JavaScript, run by QuickJS compiled to wasm (`quickjs-wasi` 3.6.2). The wasm is imported with the Worker, so no code is evaluated by V8. The script is data for a bundled interpreter.
- Only the human installs. Agents, the catalog, and files the human opens can only propose. The install is reachable from the human's socket alone.

**Reasoning.**

- Dynamic Workers (`worker_loaders`) would run real Worker code per extension, but they need the Paid plan (section 12.4). QuickJS needs nothing but the Worker.
- A remote extension (a user's own Worker called over HTTP) was rejected by the owner. It adds a hop per call and a second deployment per user.
- A declarative format with a hand-made step language was rejected. Once it has branches and loops it is a programming language that is worse to write than JavaScript, and kiko would own its docs and its edge cases forever. Models write JavaScript better than any other language, which is what makes agents good extension authors.

**Measured.** Under `wrangler dev`, QuickJS starts in about 9 ms cold and 1 to 2 ms warm. A hook call costs about 11 µs. A turn already uses about 1.5 s of CPU (section 17.2), so an extension adds little. On the deployed Free account, a cold VM plus one hook call took 17 ms of CPU in a Durable Object, and 2,000 hook calls in one request passed; Durable Objects there are not held to 10 ms (experiment 4, section 17.3).

### 24.2 Storage

`UserDO` owns four tables, in `user/extensions.ts`:

- `extensions`: one row per installed extension. The bundle, its hash, the on switch, the agents it is on for (null means every agent), who wrote it, the chat its triggers post to, and the last error an agent reported.
- `extension_proposals`: installs that wait. One open proposal per extension name; a newer one replaces the older. At most 20.
- `extension_secrets`: sealed like provider keys (section 11), with the provider id `ext:<name>:<secret>`. The client sees only whether each secret is set.
- `extension_state`: `kiko.state`, keyed by extension, scope, and key. A value is at most 64 KB, an extension keeps at most 1,000 keys.

The client gets extensions and proposals in the user snapshot and as user events (`extension`, `extension_removed`, `extension_proposal`, `extension_proposal_removed`). It keeps them in IndexedDB, so settings paints at once. Every change is optimistic: the user store lays it over the server's lists and rolls it back when the server says no.

### 24.3 The sandbox

`core/sandbox/src/vm.ts` runs one VM per extension version per agent process.

- The VM has no `fetch`, timers, `process`, `WebAssembly`, or bindings. The only way out is `__host`, which the prelude hides before the extension's module runs. Each invocation gets its own `kiko` object, and the host decides per call what it may do.
- Data crosses as JSON text only, so a guest object never becomes a host object.
- CPU: the interrupt handler counts. The Workers clock does not move during computation, so a time check would never fire. QuickJS calls the handler about once per 5,000 loop iterations. 300 calls, about 100 ms, is the limit per entry into the VM.
- Memory: 16 MB per VM. A VM that runs out is thrown away and restarted on the next call. Wasm memory never shrinks and an isolate's 128 MB is shared, so a VM that grew past 8 MB is retired after its call, and every VM is released when the agent goes idle. A VM starts at about 1.3 MB, and a warm start takes 1 to 2 ms.
- Wall time: an invocation that has not settled in 30 seconds fails.
- Imports resolve only to files in the bundle.

### 24.4 How an extension becomes a pi-durable extension

`core/sandbox/src/compile.ts` turns a manifest into an ordinary `Extension` named `ext:<name>`. Each tool, section, hook, and wrap is a host function that calls into the VM. The bridge enforces the manifest on every call:

| `kiko.` | Rule |
| --- | --- |
| `call(tool)` | Only tools in `calls`, only tools the agent has, never the caller itself, and only with an effect the caller's effect covers. A `read` tool calls only reads; `write` adds writes; `message` adds messages; `external` calls anything. The callee meets every selected extension's `beforeTool` and `afterTool` hooks in selection order, as the model's own call would: the first block makes `call` throw with its reason, so a user's guard extension also guards a tool another extension reaches through `call`. Calls nest at most 4 deep, so two tools that call each other stop at once |
| `fetch(url)` | From a tool or tool wrap. Any tool may GET without a body; another method or a body needs an `external` tool. `guestRequestProblem` (`core/sandbox/src/compile.ts`) refuses a request the rule forbids, and `UserDO` checks it again and fetches (24.7) |
| `state` | Needs `state` in the manifest. Sections only read. In a private chat (section 7.10) user-wide state only reads |
| `next(args)` | Only in a tool wrap. Runs the wrapped tool |

Hooks and sections can use only `state` and `log`. A failing hook changes nothing. `onYield` may continue a run at most three times in a row.

A manifest tool declares its effect like a built-in tool. A tool wrap keeps the wrapped tool's effect.

DEVIATION from the earlier plan: effects are declared in the manifest and enforced at run time, not computed from the code. A script's calls are dynamic, so they cannot be read ahead of time.

**Why a read tool may GET.** A GET to a host the human approved at install is a read: it changes nothing. So any tool may GET, and sending anything (another method, or a body) stays `external`.

### 24.5 Selection and sync

`factory.ts` stays the one place that selects extensions. `UserExtensions.sync` installs the given versions in the agent's registry, removes the rest, and returns the selection: every built-in extension, then the user's in name order. Hooks run in selection order (pi-durable `agentHooks`).

A user extension never shares a tool name with a built-in tool or with another user extension. Such an extension is left out of the agent and the reason is shown on its row in settings.

Before each run, `AgentDO.syncExtensions` asks `UserDO.extensionsFor(slug)` for the versions this agent runs, fetches the bundles it has not stored, syncs, and configures the root conversation when its selection changed. Input that joins a working run (section 6.2: a steer, a queue, or a restart) skips `beginRun`, so the host's `joinRun` hook makes the same call before submitting it. pi-durable resolves the agent again at each model request, so the joined input's next request has the new selection. So an install, a switch, or an update reaches the human's next message, even one that arrives while the agent is still finishing. The call happens once per joined input, never per model turn. The same compare also brings a new built-in extension to an existing agent, which a conversation created before it would otherwise never select.

### 24.6 Writing extensions

- An extension in the chat's files lives at `/extensions/<name>/extension.json` plus its script, the same way skills live at `/skills/<name>/SKILL.md`.
- The built-in skill `build-an-extension` is the SDK reference for agents.
- `extension_check` (read) validates the manifest, loads the script, checks its exports against the manifest, and runs the manifest's `tests` with every call, fetch, and state op answered by mocks.
- `extension_propose` (message) runs the same check, then stores a proposal and posts one line in the chat.
- `extension_list` and `extension_open` let an agent see what is installed and copy one into the chat's files to change it.
- The human can install from the file header of an `extension.json` too. The client reads the folder and proposes it.
- Settings, extensions: waiting installs with their powers in plain lines (riskiest first), the code, and a line diff for an update; installed extensions with a switch, the agents that use them, their secrets, and remove; the catalog.

### 24.7 Fetch and secrets

`UserDO.extensionFetch` is the only way a script reaches the network.

- The extension must be installed and on. `guestRequestProblem` applies one rule to the bridge, the checker, and `UserDO`: only `https`, a host that matches `egress` (where `*.example.com` covers every subdomain), a listed method, safe headers, and a text body of at most 256 KB with no body on a GET.
- `{{secret.NAME}}` in the URL, a header value, or the body is filled in here, and only when the host is one of that secret's `hosts`. The script never holds a key.
- A server that echoes a secret does not hand it back: every set secret is replaced by its placeholder in the response text. `set-cookie` and `authorization` response headers are dropped.
- `safeRequest` in `core/durable/src/safe-fetch.ts` makes the request. It has `safeFetch`'s address checks, and it never follows a redirect, so headers chosen for one host never reach another. Bodies are at most 256 KB each way, and the deadline is 10 seconds.

### 24.8 Triggers

A trigger is a recurring reminder (section 14) made as `ext:<name>`, posted to the chat the extension came from, for the agent that wrote it, or else to the kiko chat for kiko. Installing, switching on, or updating replaces the extension's reminders; switching off and uninstalling cancel them. A trigger repeats at most every 30 minutes, the reminder rule. `triggerProblem` (`core/sandbox/src/rule.ts`) refuses a rule that fires every minute or that `ruleProblem` refuses. `triggerGapProblems` finds the fastest gap over the first 500 occurrences of a rule (`repeatProblem`, `GAP_SAMPLES`). ASSUMPTION: 500 occurrences reach the fastest gap of any rule kiko accepts. `extension_check` and install apply both.

DEVIATION (U68): the recurrence code moved from `apps/server/src/user/recurrence.ts` to `core/sandbox/src/recurrence.ts`, with `rrule` declared in `@kiko/sandbox`. The trigger rule has to be one check, and the checker in `@kiko/sandbox` cannot import `apps/`. The pure syntax rule sits in `rule.ts`, which does not import `rrule`, so `@kiko/protocol` (loaded by the client) stays free of it.

### 24.9 The catalog

`apps/server/catalog/<name>/` holds extensions reviewed upstream. `apps/server/scripts/gen-catalog.ts` bundles them into `user/catalog.gen.ts`, and a test fails when the file is stale or an entry fails its own `extension_check`. A catalog install goes through the same review as any other. Sharing is through the catalog, never a share link.

### 24.10 Verification

- `apps/server/test/script-vm.test.ts`: the sandbox. The bridge, the CPU stop, the memory cap, no I/O globals, imports only from the bundle.
- `apps/server/test/user-extensions.test.ts`: a real harness on the faux model. Tools with state and calls, user extensions last, sections in the prompt, a fetched result passed through as it is, the effect rules, hooks, wraps, name clashes, `onYield`'s limit, and every catalog entry.
- `apps/server/test/extension-store.test.ts`: the store in workerd with an echo server. Install gating, triggers, secrets per host, redaction, egress, switches, scopes, and users kept apart.
- `bun kiko verify extensions`: end to end on the dev server with the fake agent.

