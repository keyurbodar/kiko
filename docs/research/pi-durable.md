# pi-durable research notes

Source root: `/Users/keyur/Documents/kiko/refs/pi/packages/durable` (abbrev `D/`). Pointers are `file:line`.
Pi sibling packages are under `/Users/keyur/Documents/kiko/refs/pi/packages/` (abbrev `P/`).
Method: direct source reads, no execution. "NOT FOUND" = grepped, absent. "UNVERIFIED" = could not confirm from source.

## 1. What it is

- Name `@earendil-works/pi-durable`, version `1.0.0`, "Durable conversation, task, and document runtime for Pi" (D/package.json:2-4). MIT, ESM, node >=22.19.0 (:96-97 area, `engines`).
- CHANGELOG: one entry, `[1.0.0] - 2026-10-01`, "Initial release" (D/CHANGELOG.md:5-9). README line 3: "**Experimental.** The API changes without notice between releases." Spec header still says "Pico5" (D/docs/spec.md:1).
- Runtime dependencies (D/package.json "dependencies"): `@earendil-works/chord ^1.0.0`, `@earendil-works/pi-ai ^1.0.0`, `diff 8.0.4`, `typebox 1.3.27`. Nothing else. It does NOT depend on pi-agent-core, pi-protocol, pi-server, pi-client, pi-mcp, pi-codemode.
- Reverse: no other pi package depends on pi-durable (only durable/package.json matches `pi-durable` across P/*/package.json). Pi's own coding-agent uses pi-agent-core, not durable. So durable is a new, not-yet-adopted-by-Pi runtime.
- Published vs workspace: it has `files`, `prepublishOnly`, and a "publish README and changelog" commit (git log: `eaa8b0d06 fix(durable): publish README and changelog...`, `a13d35a74 Release v1.0.0`), and README install line `npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord` (D/README.md:41). Whether it is actually on the npm registry: UNVERIFIED (no network check made). Also built from the monorepo root build script (refs/pi/package.json:15).
- Exports map: `.`, `./env`, `./env/node`, `./tools`, `./storage/memory`, `./storage/jsonl`, `./storage/jsonl/node`, `./storage/sqlite`, `./storage/sqlite/node`, `./testing` (D/package.json:9-67). Package root is kept free of Node/env/sqlite/jsonl imports by a test (D/test/storage-runtime-boundary.test.ts:26-48).
- pi-ai (P/ai/package.json) is the model/auth/catalog layer; chord is "Application composition runtime for services, replicated state, RPC, and plugins" (P/chord/package.json).

## 2. Deployment model (critical)

- There is NO Durable Object class, NO wrangler config, NO Worker entry, NO alarm code in the package. Greps for `DurableObject`, `cloudflare`, `alarm`, `hibernat`, `websocket`, `ctx.storage` in `D/src`, `D/README.md`, `D/docs/spec.md` return exactly one hit: README.md:527 ("The portable SQLite and JSONL cores ... run without Node APIs, for example on Bun or in Cloudflare Durable Objects, given an asynchronous `SqliteDatabase` facade or a `FileSystem`"). That sentence is the entire Cloudflare story. NOT FOUND: any wrangler snippet, migrations (`new_sqlite_classes`), DO base class, or CF adapter.
- What the host must write itself:
  1. A DO class (host-defined) whose constructor/`blockConcurrencyWhile` builds a `SqliteDatabase` facade over `ctx.storage.sql` (interface: D/src/storage/sqlite/database.ts:1-38: `exec`, `run`, `get`, `all`, `transaction(cb)`, `close`; all async; a transaction handle must queue other ops; rollback on throw).
  2. `await SqliteStorage.open(db)` (D/src/storage/sqlite/storage.ts:144) which applies migrations itself (`applySqliteMigrations`, D/src/storage/sqlite/migrations.ts:93-125).
  3. `Harness.open(storage, { models, registry, settings?, env?, ... }, context)` (D/src/harness/harness.ts:407-432; options type D/src/harness/types.ts:423-452).
  4. `harness.resume()` (D/src/harness/types.ts:538+, impl harness.ts:236) after every cold start to continue unfinished work.
- Node-only reference adapter exists (`openNodeSqliteStorage(path)` D/src/storage/sqlite/node.ts:205-210, uses `node:sqlite` `DatabaseSync`). It is not usable in workerd; it only shows what a facade must do. `SqliteStorage` is constructed through `static open(db)`; its constructor is private (storage.ts:138).
- Minimal host wiring in README (Node, not CF) at D/README.md:44-67 (Quick Start) and :103-111 (SQLite persist):
  ```ts
  const harness = await Harness.open(await openNodeSqliteStorage("./session.sqlite"), { models, registry }, context);
  const root = await harness.root(context);
  harness.resume();
  ```
  `context` is a chord `Context` (cancellation carrier), `BACKGROUND_CONTEXT` from `@earendil-works/chord/context` (README:47,52).
- Concurrency rule: "One process owns a storage at a time; there is no cross-process locking" (README:527). Spec: old and new Harness must never own the same Session concurrently; open new only after old `close()` resolved (D/docs/spec.md:3162-3166). In a DO this is naturally satisfied by single-threaded DO instance, but the host must ensure only one Harness per DO instance.
- Bundle weight caveat: package root loads TypeBox; ~23 MB peak RSS unbundled, ~4 MB tree-shaken (README:554). Relevant to the 128 MB Worker limit.
- Does `pi-ai` run in workerd? pi-ai has `providers/cloudflare-ai-gateway.ts`, `cloudflare-workers-ai.ts`, `cloudflare-auth.ts`, `cloudflare-stream.ts` (P/ai/src/providers/). Default `AuthContext` reads `process.env` and uses dynamic `node:fs` import guarded by try/catch (P/ai/src/auth/context.ts:14-45). Whether the full pi-ai import graph bundles under workerd: UNVERIFIED.

## 3. Extension points (exact types)

All in D/src/harness/types.ts unless noted. Re-exported from D/src/index.ts.

- Extension bundle (types.ts:257-267): `{ name; tools?: Tool[]; sections?: PromptSection[]; hooks?: HookRegistration[]; wraps?: Wrap[]; tasks?: AnyTask[] }`. Built with `defineExtension` (harness/define.ts). Installed into `createRegistry()` (harness/registry.ts); `registry.install(ext)` replaces same-name in place, `uninstall` (types.ts:289-294). Registry is process-local, not persisted (spec.md:2253-2260). Conversations select extensions by name (README:143).
- Custom tools: `ToolRegistration<TParameters, TDetails> = Tool<TParameters> & { replay?: "safe"|"unsafe"; executionMode?: "parallel"|"sequential"; prepareArguments?(args); outputLimits?: {maxBytes,maxLines,retain:"head"|"tail"}; execute(args, api: ToolExecutionApi, context): Promise<ToolExecutionResult> }` (types.ts:201-228). Define with `defineTool({ name, description, parameters: Type.Object(...), execute })` (README:152-164). Schema is TypeBox, validated by pi-ai `validateToolArguments` (README:554).
  - `ToolExecutionApi` (types.ts:166-198): `taskId, conversationId, callId, registry, agent(ctx), env: ExecutionEnv|undefined, output(chunk), diagnostic({severity,message,code?}), details(value, ctx), commit(tx=>..., ctx), memo(name,[candidate],ctx), createTask(task,input,options,ctx), getTask, waitForTask, conversation(id, ctx): ConversationHandle|undefined`. Also DocumentObserver + DocumentReader.
  - `ToolExecutionResult` (types.ts:143-156): `{ content?, isError?, details?, diagnostics?, usage?: Usage, control?: ToolControl }`; `ToolControl = { addTools?: string[]; terminate?: true; handoff?: string }` (types.ts:130-134). `addTools` is the dynamic tool-activation mechanism (spec.md:2963, 3530).
  - Same-name later tool wins; `wrapTool(tool, fn)` decorates (README:168-176).
- Hooks (typed `hook(TaskDef, handlers)`; README:367-386):
  - `GenerationHooks` (types.ts:593-607): `beforeRequest({messages}, api, ctx) => {messages}|undefined` (per-request message replacement, "for that request only"), `afterResponse(message, api, ctx)`, `onYield(answer, api, ctx) => {continue: UserInput}|undefined`, `afterTools(assistantId, resultIds, api, ctx)`.
  - `ToolHooks` (types.ts:609-624): `beforeTool(call, api, ctx) => {arguments?, block?: string}|undefined` (a throw blocks), `afterTool(call, result, api, ctx) => ToolExecutionResult|undefined` (replaces result).
  - `CompactionHooks` (types.ts:626-643): `beforeCompact({reason, entries, messages, firstKept, instructions?}, api, ctx) => {decline:true}|{summary:string}|undefined`.
  - `HookApi` (types.ts:~575-591): `taskId, conversationId, memo(), snapshot/snapshotAsOf` reads.
  - Scope: hooks apply only in conversations that select the extension; there is no registry-wide hook (spec.md "Guards left out of a selection", footgun list in 12; README:386). This matters for security guards: a conversation configured with an explicit `extensions` array that omits the guard runs without it.
- System prompt injection: `PromptSection = { key; render(input: PromptInput, ctx): string|undefined|Promise<...>; tag?: boolean }` (types.ts:241-246); `PromptInput = { conversationId, agent, env, shown, read }` (types.ts:~225-239). Built with `section(key, fn, {tag:false})`. Rendered before each request; only deltas stored as `pi.system` entries (README:178-186; spec.md:3002-3128). Per-conversation `instructions` render last as section `instructions` (README:186). Sections that change every call defeat prompt caching (README:186; spec footgun "Unstable prompt text").
- Per-turn context injection: (a) `beforeRequest` hook above (ephemeral, not persisted); (b) a `write` submission appending an app entry (`{type:"write", entry:{kind, data, model?}}`, types.ts:55-72; README:297) — entries with `model: [Message]` enter context; (c) a dynamic section reading app docs through `input.read`.
- Events/subscribers:
  - `conversation.viewState(ctx)` -> chord `AttachedReplicatedState<ConversationView>` with `subscribe` (README:261-272; types.ts Conversation interface :484+). `ConversationView = { conversation, entries, docs: {pi.agent, pi.live, pi.inbox, pi.usage} }` (D/src/harness/view.ts:25-32).
  - `conversation.watch(ctx)` -> `WatchHandle<ConversationView>` with exact chord ops per commit (README:274-285).
  - `watchEvents(harness, conversationId, ctx)` -> `AgentEventStream { snapshot; start(listener(events, ctx)); stop(); closed }` (D/src/harness/events.ts:136-145; README:351-365). Labeled "Experimental" (README:351; spec.md:3955).
  - `harness.watchDoc/documentState`, `harness.taskGraph/watchTaskGraph` (README:473, 509).
  - Session-level: `subscribeCommits(listener)`, `subscribeClose(listener)` (D/src/types.ts:905-907); listeners must not throw/block (spec.md:1521-1530).
  - `HarnessOptions.onReport(error)` receives non-fatal extension errors (types.ts:~451).
- Storage adapters: interface `Storage` (D/src/types.ts:993+), implemented by `MemoryStorage`, `SqliteStorage`, JSONL storage. Custom backends should pass `registerStorageConformance` from `@earendil-works/pi-durable/testing` (README:538-552; D/src/testing/storage-conformance.ts, 1583 lines).
- Env/sandbox abstraction: `HarnessOptions.env?: (target: EnvTarget{conversationId,cwd?,read}, ctx) => ExecutionEnv|undefined|Promise<...>` (types.ts:416-441). `ExecutionEnv = FileSystem & Shell` (D/src/env/index.ts:172-173). See section 13.
- Model selection: per conversation `AgentState.model: {provider, modelId}` (types.ts:20-24, 297-308) set via `root({agent})`, `createConversation({agent})`, `conversation.configure({model, thinkingLevel,...})` (README:190-209). Resolved with `models.getModel(provider, id)`; unknown model fails the task `no_model` (spec.md ~3350; generation.ts:130,193,225). Host-wide default for unset fields: NOT FOUND as a single "defaultModel" option; `HarnessSettings` (types.ts:392-401) has no model field, so every conversation must be configured with a model (the `agent.model` is `undefined` otherwise and generation fails `no_model`).
- Credentials: durable has no credential API. It takes `models: Models` (types.ts:425) and calls `models.streamSimple(...)` (generation.ts:399) and `completeSimple` (compaction.ts:172). Auth resolution is inside pi-ai. See section 9.
- Settings (live getters allowed): `HarnessSettings { extensions?, stream?: ConversationStreamOptions{transport,timeoutMs,maxRetries,maxRetryDelayMs,headers,metadata,cacheRetention,deferred}, retry?, compaction?, toolExecution?, steeringMode?, followUpMode? }` (types.ts:350-401).
- App documents: `defineDoc({kind, version, scope:"conversation"|"session"|"task", history:"latest"|"rewindable", fork, initial})` (D/src/documents.ts:41-60; README:489-509). `HarnessOptions.conversationCreated(tx, conversation)` runs in every conversation-creating commit (types.ts:~444-449).
- Custom tasks: `defineTask({name, version, initial, phases, abort, migrate?})` (D/src/tasks.ts:4-8) delivered via `Extension.tasks`.

## 4. Turn lifecycle

- Entry: `conversation.submit({type:"input", content, requestId?, whenBusy?}, ctx)` (types.ts:55-72, 484+; README:60). Admission is a durable commit: `pi.user` entry + run + generation task in one commit when idle (spec.md:2142-2150 table). `requestId` dedups per conversation (spec.md:2163; README:113-120).
- Execution: scheduler serially reserves tasks and runs handlers off the Session line; all in-process JS (D/src/harness/scheduler.ts; spec.md:1869-1875, "§5.4"). Built-in tasks: `pi.generation` (phases `prepare`, `request`, `retry`, `poll`, `tools`), `pi.tool`, `pi.compaction` (spec.md:3168-3552, esp. generation checkpoint 3315-3345).
- Per turn: generation `prepare` (resolve agent, render sections, append `pi.system` deltas, check compaction thresholds) -> `request` (stream via `models.streamSimple`, partial committed at most every 100 ms: `PARTIAL_THROTTLE_MS = 100`, generation.ts:108) -> classify in one commit -> on `toolUse` create one `pi.tool` task per call owned by the generation and `waiting` on them -> `tools` phase -> next generation (spec.md:3380-3470; README:92-99).
- Intent-before-effect for tools: tool `call` phase records intent in a commit, then `execute` (spec.md:3475-3520; README:166).
- Eviction/hibernation: the package has NO wake mechanism. Durability is "state is committed before shown"; after any process death, reopen storage and `Harness.open` then `harness.resume()` (README:5, 113). On open, scheduler loads live tasks and flips `running` -> `pending` (scheduler.ts:231-252). Only after the host calls `resume()` (or submits/waits, which enable scheduling, types.ts:~540-545) does work continue. So in a DO the host must call `resume()` on every constructor/`blockConcurrencyWhile` and must keep the DO instance alive during a turn; nothing here keeps the DO awake.
- Alarms: NOT FOUND. Delays (retry backoff, deferred poll) use in-process `setTimeout` via `delay()` (scheduler.ts:1215-1225, 1300-1320; MAX_TIMER_DELAY 2^31-1 at :53). Retry backoff is stored durably (`until` in the checkpoint, spec.md generation checkpoint `retry`), so a restarted Harness resumes sleeping to the stored time, but nothing wakes a dead DO at that time. A host must schedule a DO alarm itself (from `inspect()`/`pi.live.generation.retry.at`) and call `resume()` in `alarm()`.
- Crash mid-turn:
  - mid-stream: a committed partial in `pi.live` is converted into an aborted `pi.assistant` entry on recovery, then the same request is resent with the same pinned model/thinking/stream options, rerunning `beforeRequest` (spec.md `request` description ~3355-3365). At most ~100 ms of streamed text lost (README:287).
  - mid-tool: rerun only if tool is `replay:"safe"` (and both stored and current declaration safe); otherwise the model receives an `interrupted` error result with output so far (README:166; spec.md:3500-3512). Default is `unsafe` (types.ts:203-204).
  - Tool env on recovery is rebuilt from the current `cwd` (spec footgun "Environment on recovery").
  - Missing task definition after restart: task stays `pending`, blocked `missing_task` until the extension is reinstalled (spec.md:1946-1956; README:257). So the host must install the same registry before `resume()`.
  - Fatal storage errors poison the Session; do not continue using it (spec footgun "Fatal storage errors").
- Failure policy: provider errors retried with durable backoff per `retry` setting (`DEFAULT_RETRY_POLICY` exported, index.ts:~13); overflow triggers one compact-and-retry (README:347). Non-retryable error settles inputs `unanswered` with `model_error` and leaves inbox items queued (spec.md:2236-2243).
- Long wall time in one DO invocation: UNVERIFIED (nothing in the package addresses Workers CPU/wall limits; model streaming is awaited in-process).

## 5. Steering and interruption

- Steer: `conversation.submit({type:"input", content, whenBusy:"steer"}, ctx)` (README:295-297; types.ts:55-72 `whenBusy?: "steer"|"followUp"|"reject"`). Placed at the `postTools` boundary, i.e. after the current tool round, joining the running work (README:300; spec.md:2214-2220 boundary table). It is NOT injected mid-stream or mid-tool; if the model answers without tools, steers are placed at the `final` boundary and start a successor run.
- Follow-up: default (`whenBusy` omitted or `"followUp"`), placed at `final` boundary when the run answers (README:299-301; spec.md:2214-2220).
- Reject: `whenBusy:"reject"` throws `ConversationBusy` (D/src/errors.ts).
- Write while busy: `{type:"write", entry}` queued, appended at next boundary without triggering the model (README:297).
- Queue mode: `settings.steeringMode`/`followUpMode`: `"one-at-a-time"` (default) or `"all"` (types.ts:~139 `QueueMode`, README:304).
- Withdraw queued item: `submission.abort(ctx)` -> `"aborted"|"already_placed"|"settled"` (types.ts:79-83); `harness.abortSubmission(id, ctx, conversationId?)` (types.ts:~560).
- Abort the turn: `conversation.abort(ctx, {background?})` — withdraws queued inputs (writes stay), aborts every task of current work, resolves when idle (README:399; types.ts:~519-523). Run settles inputs `unanswered` reason `aborted`. During streaming this cancels the invocation signal; generation abort handler converts committed partial to an aborted `pi.assistant`. `harness.abortTask(id, ctx)` for one task (types.ts:~565).
- Reset/handoff: `conversation.reset(handoffText|undefined, ctx)`; queued while busy; ends current run with inputs `unanswered` reason `reset` (README:308-317; spec.md:2229-2233).
- Wait: `submission.wait(ctx)` resolves `done`/`unanswered`; cancelling the ctx cancels only the wait (README:76).

## 6. Streaming and transport

- The package has NO transport. NOT FOUND: WebSocket, SSE, hibernatable WebSocket, RPC server, HTTP handler. Clients are in-process observers (view state, watch, agent events). The sibling packages `pi-protocol`, `pi-server`, `pi-client` depend only on chord and protocol (P/protocol, P/server, P/client package.json), not on durable; nothing connects them to durable (UNVERIFIED whether protocol could carry chord ops; not investigated).
- What a host forwards: `conversation.watch(ctx)` yields `watch.value` (full view at attachment) and, via `watch.start((value, ops) => ...)`, the exact chord delta `Op[]` of each commit (README:274-283). The agent-event alternative is `watchEvents` (`AgentEvent` union: events.ts:56-86): `snapshot`, `run_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`, `inbox_update`, `submission`, `auto_retry_*`, `deferred_poll`, `entry_appended`, `agent_changed`, `usage_changed`, `task_failed`, `compaction_start/end`. Message updates carry deltas (`MessageChange`: text/thinking deltas, toolcall deltas, block, message; events.ts:~28-33).
- Entry schema: `EntryRecord = { id, conversationId, kind, model?: Message[], data?: JsonValue, head?, edits?, byTaskId? }` (D/src/types.ts:317-332). Built-in kinds: `pi.user`, `pi.assistant`, `pi.system`, `pi.tool-result`, `pi.reset`, `pi.compaction` (D/src/entries.ts:13-33). Messages are pi-ai `Message` types.
- Resume-from-offset: NOT FOUND, explicitly rejected: "A client that joins late or reconnects starts from the current view; nothing is replayed" (README:285). Slow consumer: at most 100 pending frames, then replaced by one full-view frame (README:285; for events: ">100 batches" -> new `snapshot`, README:365). Committed order is by `Seq` (commit sequence), but no public "from seq N" subscription was found. Storage entries are queryable with cursor paging: `conversation.entries(query, limit, cursor, ctx)` newest-first (types.ts:~506-512).
- Cadence: partial text/tool output committed at most every 100 ms (README:287), so streaming is coarse-grained by design; a crash loses at most that window.
- So yuki must build: WS/SSE endpoint inside the DO that on connect sends `watchEvents(...).snapshot` (or view) then pipes `start()` batches; reconnection = new snapshot.

## 7. Storage

- SQLite schema v1 (D/src/storage/sqlite/migrations.ts:9-86), all `STRICT`, records stored as JSON text columns:
  - `durable_schema(singleton, version)` (migrations.ts:106-110)
  - `durable_metadata(singleton, next_id TEXT, next_seq INTEGER)` (:10-14)
  - `record_ids(id, record_type IN conversation|entry|task|submission|document)` (:16-19)
  - `conversations(id, owner_conversation_id, owner_task_id, record)` (:20-27)
  - `entries(id, conversation_id, head, commit_seq, record)` + indexes (:28-36)
  - `tasks(id, conversation_id, kind, status, abort_requested, background, record)` + 4 indexes (:37-50)
  - `submissions(id, conversation_id, request_id, status, record)` (:51-60)
  - `documents(id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)` (:61-75)
  - `document_revisions(document_id, seq, kind base|delta, version, content)` (:76-84)
- Persisted: conversations, entries, tasks (live task replaces one row; terminal tasks stay as small records), submissions, documents with base+delta revisions (spec.md:4381-4397). Built-in docs per conversation: `pi.agent`, `pi.live`, `pi.inbox`, `pi.usage` (README:84).
- One SQL transaction = one Session commit (spec.md:4383). A DO's `ctx.storage.sql` is synchronous with `transactionSync`; the async facade has to be adapted (UNVERIFIED how, no example). Node adapter uses a serial operation queue (D/src/storage/sqlite/node.ts:23-60).
- Durability: Node adapter WAL, `synchronous=NORMAL` (README:524). Memory and JSONL also exist; JSONL `main.jsonl` is never compacted (spec.md:4448-4449).
- Compaction of long conversations (not storage GC): `pi.compaction` entries hold a summary and `head` = first kept entry; older entries stay in storage (README:321). Policy `CompactionPolicy { enabled, reserveTokens (16384 default per README example), keepRecentTokens (20000), backgroundTokens (32768) }` (types.ts:371-382; defaults `DEFAULT_COMPACTION_POLICY`, agent.ts). Triggers: blocking above `contextWindow - reserveTokens`, background below that, overflow-error retry once, manual `conversation.compact(instructions)` (README:319-349; spec.md:3586-3746). Summarizer uses the conversation's own model via `models.completeSimple` (compaction.ts:111-172), spend counted in `pi.usage`. Hook `beforeCompact` can supply own summary/decline.
- Raw history is never deleted; no GC/pruning API found: NOT FOUND (JSONL main not compacted; SQLite entries unbounded).
- Truncation: `D/src/truncate.ts` is only for TOOL OUTPUT (2000 lines / 50 KB defaults, :1-15 "Shared truncation utilities for tool outputs"). Streaming tool output is bounded separately by `D/src/harness/output.ts` (`boundOutput`, `sanitizeOutput` strips control chars, :23-25), per-tool via `outputLimits` (types.ts:~206-210). Truncation is by whole lines, head or tail.
- Usage/cost: `pi.usage` per `provider/model` and tool; `harness.usage()` session total (README:511-517; usage.ts:7).

## 8. Subagents

- No built-in `subagent` tool. The package supplies the primitives and two example implementations.
  - Primitives: task-owned conversations `createConversation({ownership:{kind:"task", taskId}})` inside `api.commit` (README:413-419; D/src/types.ts ConversationOwnership); `api.conversation(id, ctx)` returns a `ConversationHandle {id, submit, abort, waitForIdle}` (types.ts:120-128); a child starts as a copy of the owner's `pi.agent` (README:208); `configure(tx, id, {model, extensions})` to alter child (README:420, exported `configure` index.ts:~12); `api.details({conversationId})` to let a UI attach to the child (README:423).
  - Ownership semantics: aborting parent call aborts child; parent idle only when child idle; `{background:true}` tasks are boundaries (README:433-437; spec.md:2031-2119).
  - Foreground example: README:402-431 and `D/test/examples/22-subagent-foreground.ts` (replay "safe", child found again via `tx.scanConversations({ownerTaskId})`).
  - Background persistent subagents: `D/test/examples/23-subagent-background.ts` (spawn, message steer/follow-up, wait, stop, list; anchor task + reporter task + `app.subagents` doc; request ids `subagent:${taskId}` for idempotency) (README:442).
  - Child tasks (non-conversation fan-out): `tx.createTask(..., {ownership:{kind:"task", taskId}})`, `waiting` with `on`, `policy: "failFast"|"allSettled"` (README:444-469).
  - Task graph view: `harness.taskGraph(ctx)` (README:471-485).
- Cost accounting rule: a subagent tool must NOT report the child's usage in its result; child's `pi.usage` already counts it (spec footgun "Double-counted subagent spend", spec.md ~4510).
- What is missing for a `spawn_subagent` tool: nothing in the harness; you write the extension from the README/example code (it is product code in examples, not exported from `src/index.ts`; `src/tasks.ts` is only `defineTask`, 8 lines). Pitfalls to design for: the foreground child holds the parent run (spec footgun "Owned work holds its owner"); extension selection edit semantics when copying (`{add,remove}` edits host default, spec footgun "Selection edits and copies"); copy is one-time (spec footgun "Copies are one-time"). Cross-session (different DO) subagents: NOT FOUND, all subagents live in the same Session/storage, so same DO.

## 9. Auth, login, BYOK, model catalog

- Durable does none of it. It only requires `models: Models` (D/src/harness/types.ts:425) and calls `getModel`, `streamSimple`, `completeSimple`, `fetchDeferred`, `cancelDeferred` (generation.ts:130,193,225,228,258,399; compaction.ts:112,150,172).
- Where it lives: pi-ai.
  - `createModels({ credentials?: CredentialStore, modelsStore?, authContext? })` (P/ai/src/models.ts:362-366, 985); `MutableModels.setProvider/deleteProvider/clearProviders` (:355-359).
  - `Models` catalog and auth API (P/ai/src/models.ts:244-352): `getProviders, getModels, getModel(provider,id), refresh, checkAuth, getAvailable (models whose provider has complete auth), getAuth(providerId|model, overrides), login(providerId, type, interaction), logout, stream/complete/streamSimple/completeSimple, fetchDeferred, generateImages, classify`.
  - `CredentialStore { read, list, modify(providerId, fn) }` app-owned; "Login/logout orchestration is app-owned"; `modify` does serialized read-modify-write incl. OAuth refresh (P/ai/src/auth/types.ts:~55-100). Default `InMemoryCredentialStore` (P/ai/src/auth/credential-store.ts:9). A DO-SQLite-backed store would be host code.
  - `Credential = ApiKeyCredential {type:"api_key", key?, env?} | OAuthCredential {type:"oauth", refresh, access, expires}` (P/ai/src/auth/types.ts:~11-33). `ModelAuth {apiKey?, headers?, baseUrl?}`.
  - Providers are separate modules, e.g. `@earendil-works/pi-ai/providers/openai` (`openaiProvider()` "reads OPENAI_API_KEY", README:55); static catalog `models.generated.ts` and `providers/*.models.ts`; `OPENAI_API_KEY`-style env resolution via `AuthContext.env` defaulting to `process.env` (P/ai/src/auth/context.ts:19-28).
- How a key reaches a session: durable has no per-conversation credential field. `Harness.open` takes ONE `Models`. `ConversationStreamOptions` has `headers`, `metadata` but no `apiKey` (types.ts:350-360). Therefore BYOK in yuki = build one `Models` per DO/user (per-user `CredentialStore`) or a custom `Provider` whose auth looks up the user's key; per-conversation different keys inside one DO would require a custom provider/authContext keyed by something outside of durable. Not shown in any durable example: UNVERIFIED feasibility details.
- Model catalog in the UI: from `Models.getAvailable()`/`getModels()`; durable's `ModelRef` is just strings (types.ts:20-24). No validation at `configure()` time (stored by name; fails `no_model` at run time).
- No user accounts, sessions, multi-tenant routing, rate limits, billing in durable. Usage is tracked (`pi.usage`) but no budget enforcement: NOT FOUND.

## 10. Skills

- No SKILL.md discovery/loading. Only mentions: spec.md:2382-2383, 2395, 2416, 2421, 3079, 3137-3138 use a hypothetical `Skills` extension as an EXAMPLE of how extensions and reload behave (`defineExtension({name:"skills", sections:[section("skills", renderSkills)]})`). `renderSkills` is not defined anywhere. NOT FOUND in `D/src`. Pi's coding-agent may implement skills (not examined). Implementation path for yuki: a section (list of skill names+descriptions) + a `read`-style tool, with skills stored in a doc or the env filesystem.

## 11. Prompt injection / untrusted content

- NOT FOUND: no trust levels, no tagging of tool output as untrusted, no content isolation. Greps for `untrusted`, `prompt injection`, `sanitize`, `trust`, `approval` in `D/src` only find `sanitizeOutput` (strips control chars `[\x00-\x08\x0b-\x1f￹-￻]`, harness/output.ts:23-25), which is display hygiene, not injection defense.
- Tool results are written as `pi.tool-result` entries whose content ends with a rendered "diagnostics block" (entries.ts:19-24; spec.md:~3513). That channel is for truncation/spill remarks, not trust.
- Available seams to add it: `afterTool` hook (replace result; wrap text in delimiters), `beforeTool` hook (block/rewrite args, README:377), `wrapTool`, `beforeRequest` hook. Approval/permission flow: README:135 shows `beforeTool` returning `{block:"Needs approval"}`; spec.md:2416 mentions a `Permissions` extension as an example; no interactive approval primitive (pausing a tool for a human) is provided beyond writing a custom task that waits. UNVERIFIED if any example does human-in-the-loop (`27-plan-mode.ts` is a read-only mode via configure(), README:578).
- Pitfall: hooks apply per selected extension only (see section 3).

## 12. MCP and code mode

- NOT FOUND in durable (zero hits for `mcp`, `codemode`). Siblings exist: `P/mcp` (dep: cross-spawn only, so stdio-spawn oriented; not workerd-friendly as is), `P/codemode` (dep: `quickjs-wasi`), both consumed by `P/coding-agent` only (P/coding-agent/package.json). Not examined further, so their Worker compatibility is UNVERIFIED.
- Integration seam for durable: an MCP client exposed as an `Extension` whose `tools` are generated `ToolRegistration`s with JSON schema (TypeBox `Type.Unsafe`/raw schema) and `replay:"unsafe"`; dynamic discovery per conversation via `addTools` control (types.ts:130-134) or by re-installing the extension (registry reload, README:247-257). Code mode would be one tool whose `execute` runs a sandbox and calls other tools via `api.createTask`/direct calls; no primitive for tool-calling-tools exists besides what the tool code does itself.

## 13. documents.ts and env/

- `D/src/documents.ts` is NOT a file/workspace abstraction. It defines typed JSON state documents (`defineDoc`, `defineDocFamily`) stored in the same Session and committed atomically with entries (documents.ts:41-60; README:489-509). Scopes: session, conversation, task; history `latest` or `rewindable`; fork semantics `initial|current|asOf`; checkpoints and migrations (spec.md §3, 919-1520).
- `D/src/env/index.ts` is the workspace/sandbox abstraction:
  - `FileSystem` (env/index.ts:~109-146): `id` (namespace; equal ids see same files), `cwd`, `absolutePath, joinPath, readTextFile, openTextLineReader, readTextLines, readBinaryFile, writeFile, appendFile, truncateFile, flushFile, renameFile, fileInfo, listDir, canonicalPath, exists, createDir, remove, createTempDir, createTempFile, cleanup`; all return `Result<T, FileError>` (no throws).
  - `Shell { exec(command, {cwd, env, inheritEnv, timeout, onOutput, spill}, ctx): Result<{exitCode, spillPath?}, ExecutionError>; cleanup }` (env/index.ts:~160-170).
  - `ExecutionEnv = FileSystem & Shell` (env/index.ts:172).
  - Only implementation: `NodeExecutionEnv` (D/src/env/node.ts:437, 957 lines; Node `fs`/`child_process`). NOT FOUND: any in-memory, DO-SQLite, R2, or virtual filesystem implementation; no Worker-compatible Shell.
- Built-in tools `read`, `write`, `edit`, `bash` (`CodingTools`, D/src/tools/index.ts:18-22) require an env (`requireEnv`, D/src/tools/env.ts:5-8: throws "No execution environment is configured" otherwise). `read` refuses images (tools/read.ts:44-45; README:147 "Reading images is not supported yet"). `edit`/`write` serialize per env `id`+path (tools/file-mutation-queue.ts; README:245).
- Implication for "no containers": (a) skip `CodingTools`; write your own tools with `defineTool` that use DO SQLite/R2 directly, or (b) implement a `FileSystem` (and a stub `Shell` that returns `shell_unavailable` — that code exists in `ExecutionErrorCode`, env/index.ts:~68-74) backed by DO SQLite/R2 and keep read/write/edit while omitting `bash`. Per-conversation env is supported: `env({conversationId, cwd, read})` can look up an app document (README:233-245; example `D/test/examples/29-sandbox-per-conversation.ts`).
- JSONL storage depends only on `FileSystem`, so a custom FileSystem also gives a JSONL storage (spec.md:4398-4400), but SQLite is the natural DO choice.

## 14. Limits, caveats, experimental markers

- README:3 whole package "Experimental. The API changes without notice between releases." README:351 "Agent Events (Experimental)" (spec.md:3955 §9.4). Pi-ai PR #9548 `SystemMessage` contract is a stated prerequisite: "Pico5 targets the transcript SystemMessage contract from pi-ai PR #9548 ... once the PR lands" (spec.md:35-37). Whether pi-ai 1.0.0 contains it: UNVERIFIED (not checked; `SystemMessage` type presence in P/ai/src/types.ts not grepped).
- Single owner of storage; no cross-process locking (README:527).
- Package spec naming still "Pico5", handoff doc is a plan (docs/pico-v5-handoff.md, 917 lines). Not read in full.
- Non-goals (spec.md:4587-4601): no whole-Session DOM, no CRDT/offline multi-writer merge, no JSONL global compaction or corruption repair, no SQL translation of arbitrary Chord ops, no forced termination of non-cooperative extension code in one process (spec.md:3162 mentions it needs worker/process isolation).
- Footguns worth designing around (spec.md:4450-4586): long async commit callbacks hold the mutation line (never await models/network inside `commit`); read-before-write rule in a `Tx` (`ReadAfterWrite`); do not append raw entries to a busy conversation (use write submissions); queued follow-ups stay stuck after a failed run until next submission; compaction can drop an app edit placed while it summarizes; moving default extension selections append `pi.system` entries and bust the prompt cache; `close()` hangs on non-cooperative tools; fatal storage error poisons Session; reserved `pi.` names unenforced; doc kinds are persistent protocol, cannot rename.
- Watch backpressure: 100 frames then full-view replace; consumers cannot audit every transition (README:285; spec footgun "Buffered watches").
- Result record size: terminal task records are retained; put big results in entries (spec footgun "Large terminal results").
- TypeBox load cost (README:554).
- Test suite exists (about 50 test files in D/test/, conformance suite D/src/testing/storage-conformance.ts); none targets workerd (storage-runtime-boundary test only checks import graphs).

## Contradictions with "Pi already handles BYOK, login, auth, the model catalog and the agent loop"

- Agent loop: yes, but it is pi-durable's own loop (generation/tool tasks), not pi-agent-core's. durable does not depend on pi-agent-core.
- Model catalog, BYOK storage, OAuth login/refresh: in pi-ai (`Models`, `CredentialStore`), and "Login/logout orchestration is app-owned" (P/ai/src/auth/types.ts doc comment). yuki must build the credential store (per-user, DO/D1-backed), the login UI/flow, and key encryption. Default auth context reads `process.env` and `node:fs`.
- Auth of users/clients to the app: nothing anywhere in durable.
- No transport, no DO class, no alarm usage, no wrangler/migration guidance, no CF storage adapter: all host work.
- No resume-from-offset; reconnect = fresh snapshot.
- No skills, no MCP, no codemode, no prompt-injection handling, no real non-Node ExecutionEnv.
- Steering is only applied after a tool round, not mid-stream.
- Hooks and guards are per-extension selection, not global.
- Version 1.0.0 released 2026-10-01 with Experimental banner and API-churn warning.
