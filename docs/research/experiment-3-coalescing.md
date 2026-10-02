Result: pass. A `Storage` wrapper can tell a partial-output commit apart, passes the conformance suite, cuts the rows one turn writes from 536 to 96, and a crash inside a window still resumes to a correct answer.

# Experiment 3: write coalescing

Question: can kiko batch `pi-durable`'s partial-output commits without editing `pi-durable`? Architecture section 17.5 makes this the difference between a real Free tier and a demo tier.

Versions: `@earendil-works/pi-durable` 1.0.0, `@earendil-works/pi-ai` 1.0.0, `@earendil-works/chord` 1.0.0, wrangler 4, Miniflare 4.20260730.0. Run on 2026-10-02 on a local Mac.

## What a partial commit looks like

`streamResponse` in `refs/pi/packages/durable/src/harness/generation.ts` commits the streamed message at most every 100 ms (`PARTIAL_THROTTLE_MS`). Its commit callback only changes `live.generation` and returns `undefined`, so the Session writes one thing: a `document.change` with a `delta` to the conversation's `pi.live` document (`LiveDoc`, history `latest`). Every op in that delta has `generation` as its first path segment.

One other commit has the same shape. The `request` phase sets `generation` to `{ attempt }` before it sends a request, and when no partial is left over that commit is also a lone delta. The wrapper holds it too. That is safe, because after a crash the task is still at its `request` checkpoint and sends the request again. The other commits in that file that change `generation` (the deferred poll, the tool-round handover, the answer) return a task checkpoint or outcome, so they carry a task write too. A `StorageWrite` names a document by id only, so the wrapper reads the document's kind and version from the inner storage once and caches it.

`SqliteStorage` stores a delta as one `document_revisions` row and bumps `durable_metadata.next_seq`. Concatenated Chord ops apply exactly like the separate batches (`apply` walks them in order). A batch that starts with `r` replaces the whole value, and Chord allows `r` only at index 0, so the wrapper drops the held ops before such a batch.

## What was built

- `apps/server/src/agent/coalescing-storage.ts`. `createCoalescingStorage(inner, { intervalMs?, now?, holds? })` returns a `Storage` plus `flush()` and `stats()`. `holdsPartialOutput` is the default policy.
  - It holds a commit only when the commit is one delta, to a document that exists at that version and keeps no history (`scope` is not a conversation, or `history` is `latest`), and the policy accepts it. Anything else writes the window first and then itself.
  - A window is written when a partial arrives 2 seconds or more after the window opened, and before any other commit, any document read, `flush()`, and `close()`. There is no timer, because a Durable Object must not schedule work with `setTimeout`. The stream always ends in a commit that is not held, so a window never outlives its stream.
  - A held commit returns the seq its flush will get, the inner storage's last seq plus one. The first commit after opening is never held, because that seq is not known yet. The flush checks that it got the predicted seq.
  - Held ops are copied, because `Storage` keeps detached values and a caller may reuse its batch.
- `apps/server/test/coalescing-storage.test.ts` and its worker `apps/server/test/coalescing-worker.ts`. They run inside workerd through Miniflare.
- `apps/server/src/experiments/coalescing.ts`, `AgentDO.experimentCoalescing`, the dev-only route `POST /api/experiments/coalescing?coalesce=1&ms=15000`, and the CLI command `bun kiko measure turn [--coalesce] [--ms <ms>]`. One turn runs in a fresh `AgentDO` with pi-ai's faux provider at 50 tokens a second, so a measurement costs nothing. Rows are counted by summing `cursor.rowsWritten` over every `ctx.storage.sql.exec`. Opening the harness and creating the root conversation are not counted.

## What was checked

```text
$ bun test test/coalescing-storage.test.ts
rows per 4 s turn: plain rowsWritten 186 (30 commits), coalesced rowsWritten 66 (30 commits, 26 held)
crash inside a window: { pending: 3, memoryChars: 480, storedChars: 384 }
 4 pass
 0 fail
```

- Conformance, default policy: all 23 cases pass. The suite never writes a `pi.live` document, so this shows the wrapper passes everything else through unchanged.
- Conformance, a policy that holds every single-delta commit: all 23 cases pass. This drives the suite's own document cases through the held path. The first run failed two cases, which led to two rules above: held ops are copied, and only documents without history are held. A rewindable document can be read at the seq of any commit, and merging commits removes those points.
- A 4-second turn writes under half the rows, gives the same answer, and holds more than 10 commits.
- Crash. The object streams a 6-second answer through the wrapper. Once at least one window has been written and a new one holds 3 partials, it reads what is stored with a second `SqliteStorage`, waits for `ctx.storage.sync()`, and calls `ctx.abort()`. A new instance opens the harness and calls `resume()`. The transcript then holds an aborted assistant entry whose text is exactly the stored 384 characters (the 96 characters held in memory are gone), followed by the full new answer with `stopReason` `stop`.

Under `wrangler dev` on port 8807, with `NODE_ENV=development`:

```text
$ bun kiko measure turn --url http://localhost:8807
as shipped: 531 rows written, 99 commits (0 held), 15592 ms
$ bun kiko measure turn --coalesce --url http://localhost:8807
coalesced: 91 rows written, 99 commits (95 held), 15649 ms
$ bun kiko measure turn --json --url http://localhost:8807
{"coalesce":false,"status":"done","streamMs":15478,"rowsWritten":536,"commits":100,"held":0,"answerChars":3000}
$ bun kiko measure turn --coalesce --json --url http://localhost:8807
{"coalesce":true,"status":"done","streamMs":16989,"rowsWritten":96,"commits":99,"held":95,"answerChars":3000}
```

## Findings

- Rows per partial commit are about 5, not 2. `cursor.rowsWritten` counts index rows, and `document_revisions` has an index. The estimate in architecture section 17.2 is low.
- The faux model commits a partial about every 160 ms, because pi-ai sends a chunk of 3 to 5 tokens. A real model that streams in smaller chunks reaches the 100 ms throttle, so the as-shipped count rises. The coalesced count stays near one flush per 2 seconds.
- Section 17.5's old reasoning said the saved partial is not reused. It is: recovery appends it to the transcript as an aborted assistant entry (`convertPartial`). Coalescing makes that aborted text up to 2 seconds shorter. The final answer is unaffected.
- DEVIATION: `Seq` is documented as strictly increasing per commit. The held commits in one window share one seq. Nothing in `pi-durable` 1.0.0 reads a publication's seq (checked with grep over `src/`), but a kiko commit listener must not assume each publication has a seq of its own.
- Miniflare refuses a computed `import()` in pi-ai's auth context (`importNodeModule`). The test bundle replaces that one expression. Wrangler accepts it unchanged.

## Decision

Coalesce. The agent host (P1-06) opens `Harness` on `createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(ctx.storage)))`. With about 25 rows of kiko's own per turn and 30 turns a day, a user writes about 3,600 rows a day coalesced and about 16,800 as shipped. The Free plan's 100,000 rows a day then covers about 27 daily users instead of about 6.
