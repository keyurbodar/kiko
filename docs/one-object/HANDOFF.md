# Handoff: the one-object redesign

Updated 2026-10-20. Read this file first, then `AGENTS.md`. `README.md` explains the design. `strategy.html` shows the write-reduction plan as charts; open it in a browser.

## The problem

Kiko installs hit the Cloudflare Free plan's cap of **100,000 rows written a day**, and then every write and socket fails until 00:00 UTC. That happened to the owner's install with almost no use.

- **Root cause:** an agent alarm that retried forever. Its failure count lived in memory and reset whenever Cloudflare evicted the object. Two idle agents wrote about 115k rows a day.
- **Underlying cause:** four Durable Object classes. One prompt made about 18 calls between objects and wrote 136 rows.

## What PR #27 already does (committed and pushed)

PR [#27](https://github.com/keyurbodar/kiko/pull/27), branch `one-object/integrated` into `main`. It's open and ready for review, but not merged.

1. **One `OwnerDO`.** Rooms, agents, the user and files share one Durable Object and one SQLite database. There are no calls between objects, and each tab uses one socket.
2. **pi-durable is stored as a journal** (`core/agent/src/journal.ts`).
3. **One clock and no background timers.** A failure writes one error row and schedules nothing.
4. **Human-started runs execute inside their socket event**, and every run one event starts shares one 40-call budget (`Runs.budget()`). Alarm work runs one at a time.
5. **Cold history moves to R2.**
6. **No unit tests.** The only behavior check is `bun kiko verify journal-overhead`, which CI runs. Its gate (`ROW_GATE`) equals today's measured cost.
7. **Data is wiped on update.** The installer requires the exact acknowledgement `delete-existing-data`. New releases go to `latest-owner.json`.

Measured at the last commit (`evidence/e2e-before.log`, `evidence/e2e-after.log`):

| | `main` v0.4.16 | PR #27 at `de8db1c4` |
|---|---|---|
| Billed writes per prompt | 136 SQL rows, plus KV and alarms | 33 (30 SQL + 3 `setAlarm`) |
| Writes in the idle minute after a prompt, then after an error | 9, then 5 | 0, then 0 |
| A failing prompt | 248 rows + 6 alarms | 42 writes, 1 error row, then nothing |
| Calls between objects per prompt | ~18 | 0 |

## The goal now: 3 writes per simple prompt, with 2 as a stretch goal

### Measured billing facts

These come from `evidence/row-billing/RESULTS.md`, measured with the same `rowsWritten` counter Cloudflare bills from.

- One row bills 1, at any size up to 1.9 MB.
- Every secondary index adds 1 row per insert, or per update of an indexed column. Deletes don't bill index removals.
- An upsert that changes nothing bills 0. A delete bills 1 per row.
- **FTS5 bills 1 row per document, batched or not.** 500 documents in one transaction bill 500.
- Trigger writes are counted.
- `setAlarm` and each KV put or delete bill 1.
- A transaction adds nothing on its own; only rows count.
- One statement can bind at most 100 parameters.

### The design

Write one row at each moment that must survive a crash, with no extra indexes, and derive everything else from those rows. A simple chat has three such writes:

1. **The human's message row**, written before the ack. It is also the agent's to-do list: "unanswered" means human messages after the agent's last reply. That replaces the `pending` rows and the run ticket.
2. **The reply's message row**, written before "done". It also marks the run as ended, which replaces `ended_runs`.
3. **One journal row per finished model turn.** pi's roughly six saves per turn are batched in memory and flushed when the turn completes, and again before any tool with an `external` or `write` effect runs.

Longer runs cost: **writes = 2 + model turns + outside actions.**

The owner's rule: **no extra token cost to users and no UX change.** That's why the journal flushes at every finished model turn: a crash never redoes a finished model call or an outside action.

**Why not 1:** the human's message must be durable before the ack, and the reply only exists seconds later. Those are two separate moments.

**The stretch to 2:** store the agent's turn state inside the reply's message row. Only do this if it stays clean, because it couples the room's history to pi's storage format.

### Where today's 33 go, and the plan for each

| Writes | Source | Plan | Status |
|---|---|---|---|
| 3 `setAlarm` + 5 SQL | Crash-fallback wakeups and clock metadata, each set and then cleared | Derive the next alarm from existing rows. Set no alarm while a tab is connected; an evicted object resumes on the tab's reconnect | Track A, in flight |
| 2 | Run ticket | Derive it for human-started runs. Keep `owner_runs` only for alarm work | Track A, in flight |
| 3 | `pending` | Derive from human messages after the agent's delivered cursor (`unansweredFor`) | Track B, in flight |
| 2 + 1 + 1 + 2 | `events` for messages, `clients`, `ended_runs`, `mem_turns` | Fold into the message row, or compute when read | Track B, in flight |
| 2 | FTS trigger, 1 per message | One search document covers every message since the last search, built when a search runs. Lazy indexing alone saves nothing (1 row per document) | **Next round** (Track B only makes indexing lazy) |
| 5 | `messages` rows and indexes | Key by (room, seq) with no extra index, if query plans allow | Track B checks |
| 6 | `journal`, one per pi commit | One row per finished model turn, plus one before each outside action | Track C, in flight |

### Track results so far

**Track B is done, uncommitted.** With A and C's work in progress in the same tree, the e2e measured **11 writes per prompt**: idle 0 and 0, error rows 1 and 1, gate still 33. Room events for messages, `clients`, `ended_runs` and `mem_turns` now write nothing. Search indexes lazily: one transaction per search reindexes new, edited, deleted and archived messages. Exact replay JSON lives in `messages.message_payload`. Report: `/home/keyur/.cache/kiko-takeover/room-lazy-impl/report.md`.

What remains in those 11:

| Writes | Source | Next move |
|---|---|---|
| 5 | `messages` rows plus the `messages_id` and `messages_run` indexes | Query plans use both. To drop them, make message ids encode (room, seq), so id lookups become primary-key reads, and find run recovery by a bounded recent-seq scan |
| 3 | `pending` insert, plus its `pending_seq` index, plus delete | Wire `RoomLog.unansweredFor(agentSlug, after, limit?)` into `room/burst.ts` using the durable human-delivery cursor, never the reactions cursor. Also update `room/reactions.ts` `defaultTarget`'s pending exclusion |
| 2 | `journal` | Track C, batching |
| 1 | Reaction-brief cursor upsert in `owner_meta` | Make it an upsert that writes only on change, or derive it |

**Track A is done, uncommitted.** The combined tree measures the same 11 writes, now with 0 alarms and 0 KV writes. Reconnect recovery resumes unfinished work from the journal's durable tasks and submissions. A final clock-query change that suppresses offline recovery alarms after a reconnect landed after its last verification, so it needs the combined check. Report: `/home/keyur/.cache/kiko-takeover/journal-impl/socket-clock-report.md`.

**Track C is done, uncommitted.** Journal rows per one-call prompt went from 6 to 1. Batches flush on a committed assistant message (public `StorageWrite`), on submission settlement, before `write` or `external` tools, on close or continuation, on run idle, and above 1 MB. `journal_ids` reservations stay durable. The combined tree measures **10 writes per prompt**, with idle 0 and 0 and one persisted error row. A crash after a finished model turn gave exactly one reply. Evidence: `/home/keyur/.cache/kiko-takeover/journal-batch-20261020/`.

**Blocking gap, do not commit until it's fixed:** a crash before the first model turn finishes can lose the human's input. Burst delivery deletes `pending` after inbox admission, but the inbox entry isn't durable until the first flush. Track D's change fixes it, because pending becomes "messages after the agent's durable delivery cursor", so unflushed delivery counts as unanswered again. Before committing, confirm that owner recovery (socket reconnect and the alarm) also redelivers unanswered messages for every agent, not only the journal's persisted work. Prove it: kill the server after the ack but before the first turn completes (the fake model's slow-tool mode, or a delay), restart, reconnect, and expect exactly one reply.

**Round 4 started**, running in parallel with Track C:

| Track | Task id (`clientRequestId`) | Cuts | Files it owns |
|---|---|---|---|
| D: derive pending input; write the reaction cursor only on change | `ship-writes-v4-pending` | ~4 | `room/burst.ts`, `room/reactions.ts`, `room/room-do.ts`, `owner/owner-do.ts`, `owner/clock.ts` |
| E: message ids encode (room, seq); drop `messages_id` and `messages_run` | `ship-writes-v4-msgidx` | ~2–3 | `room/log.ts`, `room/search.ts`, `owner/schema.ts`, `room/bubbles.ts` |

Expected once C, D and E land: about 3 to 4 writes per prompt.

### Tracks in flight

All three edit the same worktree, uncommitted, in separate files. Read each result with `task_status`.

| Track | Task id (`clientRequestId`) | Files it owns |
|---|---|---|
| A (done): alarms, clock and run ticket | `ship-writes-v3-clock` | `owner/owner-do.ts`, `owner/clock.ts`, `owner/runs.ts`, `room/burst.ts`, `agent/agent-do.ts` |
| B (done): fold room rows, lazy search | `ship-writes-v3-log` | `room/log.ts`, `room/search.ts`, `room/memory.ts`, `owner/schema.ts` (append only) |
| C (done): one journal row per finished turn | `ship-writes-v3-journal` | `core/agent/src/journal.ts`, `core/agent/src/host.ts`, `agent/factory.ts` |

The full task ids start with `node:delegated-task:command%3Amcp%3A64e01d09-d867-4365-9b08-4f04a2a3d5fb%3Adelegate-task%3A`, followed by the client request id.

### What has to be proven before the design counts as confirmed

1. **The tab's reconnect resumes an evicted run.** Kill the server mid-run, restart it with the same state, reconnect, and confirm the reply arrives exactly once. Track C does this check for the journal; confirm it again after merging Track A.
2. **A crash loses only the model call that was still in flight.** No finished model turn and no outside action is ever repeated.
3. **Search still finds every message**, including messages from before the last search, and edited, deleted and archived ones.
4. **The e2e passes** with `ROW_GATE` lowered to the measured number. Both idle minutes write 0, and a failing prompt shows exactly 1 error row.

If any of these fails, keep that track's rows and record why. The fallback floor is about 5 writes per prompt.

## Next steps

1. When all three tracks report back, review `git diff` against the plan table above. Reject any change that adds an acknowledgement held only in RAM, drops a recovery point, or changes what a user sees.
2. Merge any changes a track asked for in files it doesn't own. Its report lists them.
3. Run the repo checks once, through `heavy.sh`: `bun run typecheck`, `bunx biome check apps/server core apps/cli scripts`, `bun scripts/check-imports.ts`, `bun scripts/check-rules.ts`, `bun scripts/check-exports.ts` (drop exports that end up unused), `bun run --cwd apps/web-solid build`, and `bun scripts/bundle-budget.ts`.
4. Run the e2e once on a fresh server, set `ROW_GATE` to the measured median, and do the three proofs above.
5. Next round: one search document per batch of messages. Then decide on the stretch to 2.
6. Commit with plain messages that say what changed and why, end each with the attribution line from the session's system reminder, and push to PR #27. Update the before/after table in the PR body and in this file, and update `strategy.html`'s measured bars.

## Owner decisions. Don't reopen these.

- **No unit tests, ever.** Verify with the one e2e, once at the end, as a before/after comparison.
- **No extra token cost to users and no UX change** from any write cut.
- Stay on the Free plan. pi-durable stays an npm dependency, extended only through public APIs. Keep search. Routines keep their exact times.
- **Durability:**
  - input is durable before the ack;
  - the reply is durable before "done";
  - a finished model turn and an outside action are never repeated after a crash;
  - no `setTimeout` scheduling in a Durable Object.
- **Subagent roles:** the coordinator makes every decision. Codex (GPT-6.1 Sol, medium) takes complex tasks. OpenCode (DeepSeek V4.1 Flash) takes medium tasks. Devin (Haiku 5.5) takes small tasks.
- **Heavy commands** (typecheck, builds) go through `/home/keyur/.cache/kiko-takeover/heavy.sh`, which has two slots. Start dev servers directly, one per agent, each on its own port. Never `pkill` or `killall` wrangler, workerd or vite; stop only your own PID. Don't use a port in a `pkill -f` pattern either, because it matches your own shell.
- `/tmp` is nearly full. Set `TMPDIR=/home/keyur/.cache/kiko-takeover/tmp`.

## Release

After merge, `deploy.yml` publishes `latest-owner.json`. Existing installs need the installer reset (`delete-existing-data`); the in-place updater refuses destructive plans. Tell owners plainly that the update wipes their data.

## Known risks

- **Parallel runs inside socket events haven't been tested on a deployed Free account.** If one fails with "Too many subrequests", remove the inline step in `OwnerDO.humanInput`; tickets still drain from the alarm.
- **A shared budget ends one event's runs together** at 40 calls.
- **`room/burst.ts` uses `scheduler.wait`** to hold a burst inside its socket event.
- **`mem_turns` and `ended_runs` grow for the life of the install**, unless Track B removes them.

## Where things are

| Item | Location |
|---|---|
| Worktree | `/home/keyur/.t3/worktrees/kiko/one-object-integrated` |
| Branch | `one-object/integrated`, based on `origin/main` 7802a45f (v0.4.16). Local `main` in `/home/keyur/kiko` is stale |
| The e2e | `apps/cli/src/verify/suites/journal-overhead.ts`; CI job `verify` |
| Run the e2e | `cd apps/server && NODE_ENV=development TMPDIR=/home/keyur/.cache/kiko-takeover/tmp bunx wrangler dev --port <n> --persist-to <fresh dir>`, then `bun kiko verify journal-overhead --url http://localhost:<n>` |
| Per-statement write counts | `/api/dev/stats` returns a `statements` list in dev builds |
| Baseline on `main` | `/home/keyur/.cache/kiko-pr2-baseline`, an older checkout whose CLI still speaks `main`'s two-socket protocol. Run it with `PR2_BASELINE=1` |
| Strategy charts | `docs/one-object/strategy.html` |
| Billing probe | `docs/one-object/evidence/row-billing/` |
