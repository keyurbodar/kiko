Result: pass. `pi-durable` 1.0.0 runs inside a Durable Object, and a turn killed mid-stream finishes after a restart through an alarm and `harness.resume()`.

# Experiment 1: pi-durable in a Durable Object

Question: does `@earendil-works/pi-durable` run inside a Durable Object? Architecture section 21 makes this the gate for the whole plan.

Versions: `@earendil-works/pi-durable` 1.0.0, `@earendil-works/pi-ai` 1.0.0, `@earendil-works/chord` 1.0.0, wrangler 4.146.0, workerd 1.20261001.1. Run on 2026-10-02 on a local Mac under `wrangler dev` and Miniflare.

## What was built

- `apps/server/src/agent/sqlite.ts`. `openDurableObjectSqlite(storage)` implements pi-durable's `SqliteDatabase` over `ctx.storage.sql` and `ctx.storage.transaction()`. Every call goes through one promise chain, so an unrelated operation waits while a transaction runs, as the interface comment requires. The transaction handle skips the chain. A throw in the callback rolls back and rejects with the same error. `close()` lets queued work finish and refuses later work.
- `apps/server/test/sqlite-conformance.test.ts` and its worker `apps/server/test/sqlite-worker.ts`. The worker runs the cases from `createStorageConformance` (the `testing` entry) inside workerd, each in a fresh Durable Object. Three suites: the 23 conformance cases on a fresh storage, the same 23 with the storage closed and reopened after every commit (what eviction does), and 6 cases for the facade itself.
- `apps/server/src/experiments/turn.ts`. A throwaway route, `POST /api/experiments/turn?id=<requestId>` and `GET` for status. `AgentDO` opens a `Harness` on `SqliteStorage`, submits one input with a stable `requestId`, and waits. A heartbeat wakeup (through `lib/alarm.ts`) is set 5 seconds ahead while the run is live. The alarm handler opens the harness, calls `resume()`, and waits for idle.

## What was checked

Conformance, inside workerd through Miniflare:

```text
$ bun test test/sqlite-conformance.test.ts
 3 pass
 0 fail
```

The test fails when the behavior breaks. Removing the queue (one line in `sqlite.ts`) fails the facade case "holds an unrelated operation until the running transaction commits".

The turn, under `wrangler dev` on ports 8805 and 9305, with the script that kills wrangler and its workerd process with `kill -9` while the model streams:

```text
status before kill: tasks ["pi.generation:running"], partialChars 189
killed wrangler and workerd at 08:35:39
first request got: curl exit 52 (empty reply)
restarted at 08:35:47
08:35:47.050Z alarm resumes 1 tasks (open 24 ms)
08:36:05.705Z alarm finished the run
POST after restart: status "done", answer 5787 chars ("one, two, ... three hundred"), aborted 1
```

No request touched the object between the restart and "alarm finished the run". The persisted alarm woke it. The second `POST` with the same `requestId` found the settled submission and answered in 2 ms. `aborted: 1` is the committed partial that recovery turned into an aborted assistant entry before it sent the request again, as the pi-durable spec describes.

## What needed a workaround

- **OpenCode Go needs a session header.** The first real turn failed with `400 MissingSessionID: Request is missing x-opencode-session`. `pi-ai` adds that header only from a `sessionId` stream option, and `pi-durable` 1.0.0 never passes one (`harness/generation.js` builds the options from settings, the signal, and the thinking level). The fix uses a supported extension point: `HarnessOptions.settings.stream.headers = { "x-opencode-session": <stable id> }`. The experiment uses the Durable Object id. The real host should use a stable id per conversation. ASSUMPTION: one id per `AgentDO` is good enough until subagents share an object.
- **The key does not come from `process.env`.** `createModels({ authContext })` takes an `env(name)` function. The experiment returns `env.OPENCODE_API_KEY` from it. The real host passes a `CredentialStore` from `UserDO` instead (architecture section 11).
- **Bindings the facade does not support.** `ctx.storage.sql` rejects a `bigint` binding and returns a blob as an `ArrayBuffer`. ASSUMPTION: pi-durable's SQLite core binds only text, integers, and null. All 23 conformance cases pass under that assumption.
- **No `BEGIN` in `sql.exec`.** Transactions use `ctx.storage.transaction(async ...)`, which commits on resolve and rolls back on throw.

Nothing in pi-durable itself was patched or wrapped. No conformance case was skipped.

## Measured cold open

`SqliteStorage.open` plus `Harness.open`, including the migrations on a new object, timed with `performance.now()` inside the object:

| Case | Time |
| --- | --- |
| New object, migrations applied | 9 to 50 ms over five runs |
| Existing object after a process restart | 13 to 31 ms |
| Existing object after an idle eviction | 4 ms |

UNVERIFIED: these are local numbers on an Apple laptop. Production cold open, CPU time, and rows written per turn belong to experiment 2.

## Other observations

- `pi-durable` keeps its 100 ms partial throttle and retry delays on `setTimeout`. That is fine while a request or an alarm keeps the object alive, and the heartbeat alarm covers eviction, as architecture section 4.4 plans.
- The heartbeat fired while the first request was still streaming. `resume()` on a running scheduler is harmless, and the alarm handler then waited for the same run to go idle. The real host should not keep an alarm handler open for a whole run. It should resume, re-arm, and return.
- The DeepSeek V4.1 Flash id in the installed catalog is `deepseek-v4.1-flash` under provider `opencode-go` (`@earendil-works/pi-ai/dist/providers/data/opencode-go.json`, key `chat:deepseek-v4.1-flash`, API `openai-completions`). It is a reasoning model. The first text arrived roughly 15 seconds after the request for this prompt.
- `wrangler dev` restarts workerd by itself when only workerd dies. The kill has to stop the wrangler process too, or the old runtime keeps running and the test proves nothing.
