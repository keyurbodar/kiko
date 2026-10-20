# One object: Kiko on a single Durable Object

Status: approved direction, PR 1 done, not pushed. Written 2026-10-20 against the original local `main` at 6167d2b1. PR 1 is rebased onto `origin/main` at 7802a45f (0.4.16).

This file is the build brief. A new session should be able to read it and build the whole redesign without the conversation that produced it. Read "Start here" first, then work through the PRs in order.

Companion files:

- `plan.html`: the same plan as diagrams. Open it in a browser.
- `evidence/measurements.md`: the measurements behind every "before" number, and how to rerun them.
- `evidence/pr1.md`: PR 1's baseline numbers, its replay evidence, and how the gate gets measured.
- `references.md`: Cloudflare limits, doc links, and every code area this plan touches.

## Start here

1. Read `AGENTS.md` at the repo root. Its rules still apply, except where "Rules this redesign changes" below says otherwise.
2. Read this whole file once. The design section explains why; the PR sections say exactly what to do.
3. Find the next unfinished PR in the progress table below. Do only that PR in a session. One change is one PR.
4. Before you write code, run the overhead suite on `main` to get your baseline. Measuring describes how.
5. When the PR meets its gate, send it to the owner for approval. Open the PR only after the owner says so, then update the progress table in this file in the same PR.

### Progress

| PR | Title | Status | Link |
|---|---|---|---|
| 1 | Journal storage, and runs without a heartbeat | done, not pushed: AgentDO 30 rows (87 before), quiet writes/alarms 0, one error | |
| 2 | OwnerDO: one object, one socket | not started | |
| 3 | Background work rides on runs; one clock | not started | |
| 4 | One schema | not started | |
| 5 | Each run gets its own invocation | not started | |
| 6 | R2 archive for old history | not started | |

PR 1 stays within journal storage, run lifetime, error termination and Retry-After. No pull request is open; nothing is pushed. PR 2 owns the object merge and the remaining whole-prompt writes.

### Decisions already made

Don't reopen these:

- **Wipe the data.** Existing installs don't need to be kept. PR 2 deletes the four old classes and starts a fresh namespace. No data migration.
- **Stay on the free plan.** Every design choice is judged against the free quotas in `references.md`.
- **Keep the UX.** Nothing in "What the human sees" may get worse. If a step would hurt the UX, stop and ask the owner.
- **Keep pi-durable.** It stays an npm dependency, extended only through its `Storage` interface.
- **Keep search.** FTS5 stays, written once per reply.
- **Routines keep their exact times.** Routines due in the same minute share one alarm. Don't round them to other times.

## Why

Kiko has one human per Worker, but the server is built as if it served many. There is one Durable Object per room, per agent, for the user and for files. Every boundary between them needs a billed call, a stored queue, an alarm to drain it and a retry when it fails.

On 2026-10-19, two idle agents looped on a failing alarm. They wrote about 115k rows and took the owner's install down at the free plan's cap of 100k rows a day. Seven loops in the code retry forever; `evidence/measurements.md` lists them. Adding guards to each loop would leave the boundaries that create them, so this plan removes the boundaries.

## Goals

1. An idle install writes 0 rows and sets 0 alarms.
2. A failure costs 1 row, a visible error. Nothing retries on its own except Cloudflare's capped alarm retry.
3. A prompt costs about 6 rows and makes 0 calls between objects.
4. A day of 20 agents, 35 hourly routines and 2,000 prompts fits the free plan with room to spare.
5. Nothing the human sees gets worse.

## Before and after

| | Before (measured) | After (target) |
|---|---|---|
| Durable Object classes | 4, one instance per room and per agent | 1 |
| Rows written per prompt | ~140 | ~6 |
| Calls between objects per prompt | ~18 | 0 |
| Alarms on an idle day | ~148 | 0 |
| Rows a day from one broken agent | ~58,000, forever | 1 |
| Tables | ~73, plus pi-durable's 9 with 17 indexes | ~15 |
| Sites that call another object | 122 | 0 |
| Sites that schedule a wakeup | 47 | ~3 |
| Retry loops with no end | 7 | 0 |
| Sockets per tab | 2 | 1 |
| Runs a day on the free plan | ~700, or 0 once a loop starts | ~12,000 |
| Awake time | each object bills on its own | one object; awake all 24 hours is 11,059 of 13,000 GB-s |

### The target day: 20 agents, 35 hourly routines, 2,000 prompts

That's 2,840 runs, with about 3 model calls each.

| Free quota | Now | New |
|---|---|---|
| Rows written (100k) | ~398k, 4× over | ~23k |
| Durable Object requests (100k) | ~71k+ | ~5k |
| Awake time (13,000 GB-s) | over | 7.3k to 11k |
| Worker requests (100k) | ~9k | ~1k |
| Rows read (5M) | ~0.4M | under 0.1M |

Awake time is the tightest quota after the redesign, but it can't go over. One object awake all day uses 85% of the quota, and runs happening at the same time share that time.

### Lines of code

Counted on `main`, excluding tests and generated files.

| Area | Today | Removed | Share |
|---|---|---|---|
| Server source (`apps/server/src`) | 21,569 | ~4,500 | ~21% |
| Core (`core/agent`, `core/durable`) | 2,265 | ~300 | ~13% |
| Server tests (`apps/server/test`) | 14,467 | ~1,000 to 1,500 | ~7 to 10% |
| Client (`apps/web-solid/src`) | 34,465 | ~150 | <1% |
| Whole repo | ~91,000 | ~6,000 to 6,500 | ~7% |

## The design

### 1. One owner, one object

`OwnerDO`, named `owner` through `lib/names.ts`, is the only Durable Object. `Room`, `Agent` and the user's settings become plain classes inside it, and share its SQLite database.

Delivering a message to an agent is a method call inside the same transaction. That means there are no queues, no wake delivery and nothing to retry.

The Worker checks auth, upgrades the socket, serves uploads and downloads, and forwards everything else to `OwnerDO`.

### 2. The journal is the database

pi-durable writes only through `Storage.commit(writes)`. `journal.ts` implements `Storage` by wrapping pi-durable's `MemoryStorage` (`@earendil-works/pi-durable/storage/memory`):

- **commit:** call `memory.prepareCommit(writes)`. Append `{ seq, writes }` as one row to `journal(agent TEXT, seq INTEGER, part INTEGER, parts INTEGER, bytes INTEGER, data BLOB, PRIMARY KEY (agent, seq, part))`. A commit over 1.5 MB spills into numbered part rows, because a row holds at most 2 MB. Then call `prepared.apply()`.
- **reads:** delegate to `memory`.
- **open:** read the journal for that namespace in `seq` order and replay each commit with `memory.prepareCommit(writes, seq).apply()`. `MemoryStorage` raises `nextId` past every id it sees in the writes, which is what `mintId` needs after a reopen.
- **cleanup:** when that agent's journal exceeds 500 rows or 4 MB of stored data, clean it up once its Harness is idle. `beforeCompact` carries usage over, the journal is cleared, and the epoch increments. Each fresh run already calls `root.reset()` and rebuilds context from room memory, so this cleanup loses no conversational memory. There is no run counter or separate snapshot format.

One `MemoryStorage` and one journal namespace serve one agent's `Harness`. The root conversation and every worker conversation inside it share that one storage, so they share an id space, a sequence and a commit. A commit that touches the root and a worker lands as one write. A worker conversation gets no storage of its own, and no later PR commits to giving it one. pi-durable's 17 indexes no longer cost writes, and streaming tokens are never stored.

The `agent` column is the Harness namespace key, and the row key is `(agent, seq, part)`. One Harness per agent remains the decision inside the single OwnerDO. Models, credentials and session headers are per agent: `userModels()` sets `x-opencode-session` at the Harness level. Tools are per agent through `setup.registry`. Idle agents can unload to keep the 128 MB object small, and cleanup stays per agent. The reference's one-Harness session has one agent identity, so its boundary fits that example. Root and worker conversations still share their agent's Harness, allocator and journal namespace.

The fallback is not used. PR 1 found replay safe, so the journal replaces pi-durable's SQLite tables outright.

**Dependency contract.** `@earendil-works/pi-durable`, `@earendil-works/pi-ai` and `@earendil-works/chord` are pinned exactly to 1.3.0. Bump all three together. Every bump must pass the unchanged upstream `registerStorageConformance` suite against real JournalStorage, including reopened reads. All 48 cases pass: 24 live and 24 with reopened reads. The suite is permanent upgrade coverage, alongside the real eviction/resume test.

### 3. A run without a heartbeat

An agent with pending input runs to its final answer in one invocation, then stops. There's no 30 s heartbeat and no backoff.

**Pending input.** `runs.ts` treats an agent as having pending input when it has messages it hasn't answered yet, so queuing a run writes nothing.

**After an eviction.** A recovery wakeup is derived from unfinished pi tasks. Blocked tasks are ignored. A task waiting for an application-defined future deadline uses that deadline; other unfinished tasks use now plus 60 seconds. The earliest deadline wins. Task settlement recalculates the wakeup, and no recovery wakeup remains when tasks finish or fail. This is recovery for durable work, not an idle heartbeat. Unchanged alarm times are not written again. `MAX_RESUMES` stays at 3, so repeated object crashes still drop the run and show an error.

pi-durable 1.3.0 does not expose a generic sleep timestamp in `TaskInspection`. The host's `scheduledDeadline` callback reads application-defined durable task data, like the reference's schedule helper. Today's agent work uses the 60-second recovery fallback; scheduled routines in PR 3 supply their future deadlines.

A failed `harness.closed` result aborts the Durable Object, matching [Earendil's Cloudflare reference](https://github.com/earendil-works/pi-durable-cloudflare/blob/main/src/session.ts), so a broken harness is never retained for another event.

**Long runs.** A run can reach 40 outgoing calls or come close to the alarm's 15-minute limit. When it does, it saves and continues in a new invocation. PR 5 builds this.

### 4. Failure is a message, not a timer

An error becomes a bubble the human can see and retry, using the existing run-error bubbles in `agent/run-error.ts`. No code path schedules work after an error. Cloudflare's own alarm retry, capped at 6 attempts, is the only automatic retry left.

Model retries in `agent/retry.ts` keep their limit of 3. They also honor a wait the provider asks for: `Retry-After` in seconds or as an HTTP date, and `Retry-After-Ms` in milliseconds, which wins over the other two. A wait of 60 s or less delays the next request, and the run keeps its retry status, including for a stream that breaks halfway. A wait longer than 60 s ends the run with the rate-limit bubble and no further request.

The Google Generative AI and Google Vertex adapters in `pi-ai` take no custom `fetch`, and their `ApiError` carries no response headers. A header delay from those two providers cannot be honored through the supported extension points. Kiko overrides neither the provider nor the dependency, and those providers keep the bounded outer retry of 3. The owner accepted this verified upstream limitation for PR 1.

### 5. Background work rides on the human

`after-run.ts` runs these once at the end of a run the human started, in the same invocation, after the reply is sent:

- memory capture
- room summaries ("naps")
- initiative

A failure waits for the next run.

The model catalog refreshes when the app opens, if it's older than a day. Provider sign-in problems show up when a run fails and when the settings page opens.

### 6. One clock

`clock.ts` projects the earliest pi task deadline across loaded Harnesses, plus the stored next deadline for each unloaded agent, onto the object's one alarm, following the reference's `#refreshAlarm`. Routines become scheduled pi tasks as in [schedule.ts](https://github.com/earendil-works/pi-durable-cloudflare/blob/main/src/schedule.ts), replacing most of `user/reminders.ts`. It also accounts for the earliest application deadline:

- a queued run
- the next routine
- the end of a browser lease
- a hello deadline

Every one of these traces back to something the human did. Routines due in the same minute fire from one alarm. `clock.ts` replaces the wakeups table in `core/durable/src/alarm.ts`. Setting the alarm again to the same time is skipped, because each `setAlarm` costs a row.

### 7. One socket

One socket per tab carries everything the two sockets carry today:

- `UserToClient` frames, as they are today
- `RoomToClient` frames, wrapped with their `roomId`

The client subscribes to the rooms it has open. Socket pings use `setWebSocketAutoResponse`, so they never wake the object. Reconnect backoff resets only after a socket has stayed open for 10 s, not on `onopen`.

### 8. Hot history in the object, cold history in R2

A free-plan object holds 1 GB. History older than 30 days moves to R2 (10 GB free) as compressed daily files. It loads back when the human scrolls up, or when search reaches past the hot range. Installs without R2 keep everything in the object and get a warning in settings at 800 MB.

## What gets deleted

### Moving data between objects

| Code | Lines | Fate | Why |
|---|---|---|---|
| `room/mail-drain.ts`, `room/mail.ts` | 412 | delete | Agent-to-agent mail becomes a call into the other agent's inbox |
| `room/wake-delivery.ts`, `room/wake.ts` | 154 | delete | Task wakes with a 2 s retry forever |
| `room/burst-flush.ts` | 130 | delete | Redelivers bursts after a failed call. There's no call left to fail |
| `room/signals.ts`, `room/chat-touch.ts`, `room/open-tasks.ts` | 231 | delete | Push room activity to `UserDO` for the chat list |
| `user/chats.ts`, `user/overview.ts`, `user/sockets.ts` | 261 | delete | `UserDO`'s second copy of every room. Becomes a query over rooms |
| `agent/step-batch.ts` | 30 | delete | Batches step reports into calls to the room |
| `agent/outbox.ts` | 430 | shrink to ~120 | Drafts, typing and step calls go. Bubble splitting stays |
| `room/receive.ts` refusal path | 67 | shrink to ~20 | Back-pressure between objects |
| `lib/names.ts` stubs | ~40 | shrink to 1 stub | One name: `owner` |

### Timers and retry loops

| Code | Lines | Fate | Why |
|---|---|---|---|
| `core/agent/src/host.ts` heartbeat, backoff, `RESET_AFTER` | ~120 | delete | The loop behind the 2026-10-19 outage |
| `models/sync.ts` | 128 | shrink to ~30 | The 10-minute sync becomes a refresh on app open |
| `user/provider-watch.ts` | 64 | delete | Polls providers |
| `room/memory-naps.ts` | 94 | becomes an after-run step | Was a timed loop |
| `user/memory-capture.ts` queue and requeue | ~80 | becomes an after-run step | Was a 60 s requeue loop |
| `core/durable/src/alarm.ts` wakeups | 84 | replaced by `clock.ts` | Many wakeups become one alarm |

### Storage

| Code | Lines | Fate | Why |
|---|---|---|---|
| `core/agent/src/sqlite.ts`, `coalescing-storage.ts` | 235 | replaced by the journal | pi-durable's indexed SQLite store, and its wrapper |
| `files/file-do.ts` | 191 | delete | A blob table in `OwnerDO` covers installs without R2 |
| Tables used only to pass data between objects | ~25 tables | drop | `deliveries`, `mail_queue`, `mail_refused`, `held_wakes`, `signal_window`, `signal_more`, `signal_results`, `chats`, `chat_tasks`, `clients`, `clients_next`, `events_next`, `capture_queue`, `nap_applied`, `pending_next` and others with the same job |

### The object shells

`room-do.ts`, `user-do.ts` and `agent-do.ts` total 3,099 lines today. They become one `OwnerDO` of about 900 lines, plus plain `Room` and `Agent` classes. What gets dropped is RPC methods, socket routing between objects, and alarm dispatch.

### Client

`sync/user-channel.ts` and the second socket merge into one socket.

## New layout

```
apps/server/src/
  owner/
    owner-do.ts   the one Durable Object: fetch, socket events, alarm
    socket.ts     one socket, hibernation, room subscriptions
    clock.ts      the single alarm
    runs.ts       which agents have pending input; runs and continuations
    journal.ts    pi-durable Storage: MemoryStorage plus 1 row per commit
    archive.ts    old history to R2 (PR 6)
    after-run.ts  memory capture, summaries, initiative
    schema.ts     ~15 tables, append-only steps
  room/           Room class: burst, members, log, search, files
  agent/          Agent class: factory, prompt, pacing, bubbles
  user/           settings, keys, routines, recipes, integrations
```

## What the human sees

All of this keeps working exactly as it does today:

- painting from IndexedDB first, and optimistic sends
- token streaming, the steps panel and typing
- bursts: the agent reads several messages, then answers once
- several agents answering in parallel
- agents asking each other and handing off work
- background workers
- routines while the browser is closed
- full-text search
- extensions, Composio tools and the browser tool
- resuming after a deploy

Two things change:

- A failed run shows an error bubble with a retry button.
- History older than about a month loads from R2 the first time you scroll back to it.

## The PRs

Each PR has a gate. Measure it as described under "Measuring" before you open the PR. Run the tests and verify suites the change touches, and let CI run the rest.

### PR 1: journal storage, and runs without a heartbeat

**Scope:** inside today's `AgentDO`. No class merging yet. This PR alone ends the loop behind the outage.

1. Add `core/agent/src/journal.ts`, which implements `Storage` as described in design section 2. Unit-test the replay: commit, reopen from the rows, check every read matches, and check that `mintId` returns an id greater than any stored id. Run the unchanged upstream `registerStorageConformance` suite against real Durable Object storage, live and with reopened reads. Keep the real eviction/resume proof in `apps/server/test/journal-storage.test.ts`.
2. In `core/agent/src/host.ts` `openHarness`, replace `createCoalescingStorage(await SqliteStorage.open(...))` with the journal.
3. Delete `HEARTBEAT_MS`, `RETRY_MS`, `RESET_AFTER`, the backoff in the alarm's catch block, and `pulse()`'s heartbeat. Keep `MAX_RESUMES`. Derive a 60-second recovery wakeup from unfinished pi tasks, refresh it when tasks settle, and clear it when work ends. Abort the object when `harness.closed` reports a storage failure.
4. An alarm that fails posts the run-error bubble once and schedules nothing.
5. Delete `sqlite.ts` and `coalescing-storage.ts` once nothing imports them.
6. In `agent/retry.ts`, honor `Retry-After`. The Google Generative AI and Google Vertex adapters take no custom `fetch` and expose no response headers on their errors, so a header delay from those two providers stays unhonored. Kiko overrides neither the provider nor the dependency, and those providers keep the bounded outer retry of 3. The owner accepted this verified upstream limitation for PR 1.

**Gate:**
- AgentDO rows per warm prompt, median of five: at most 30 (before: 87)
- in the quiet minute after a run: 0 AgentDO writes, 0 new agent alarms, no armed agent alarm
- an always-failing model produces exactly 1 error bubble, then 0 agent alarms and 0 AgentDO writes in the following minute
- report RoomDO and UserDO rows, but do not gate on them; PR 2 removes those writes

**Correction:** the original whole-prompt limit of 40 rows was wrong for PR 1. RoomDO and UserDO keep their existing bookkeeping until PR 2 merges the four objects. The schema rebuilds and index tuning explored while chasing that limit were reverted. AgentDO's journal is the only schema addition in PR 1.

**Gate passed:** AgentDO warm-prompt median is 30 rows across five samples, down from 87 (limit 30). RoomDO is 45, UserDO is 4, and the whole prompt is 79; these are reported, not gated. Both quiet minutes have 0 AgentDO writes, 0 new agent alarms and no armed agent alarm. The always-failing model leaves exactly 1 persisted error bubble. Recovery adds exactly 3 SQL rows and one `setAlarm` call per warm run over the accepted pre-recovery version. All 48 upstream conformance cases and the focused eviction, failure and size-cleanup tests pass. `evidence/pr1.md` records the run and `evidence/pr1-after.json` holds its raw counters.

**Replay is safe:** the journal replaces pi-durable's SQLite tables, and the fallback in design section 2 is not used.

**Deleted:** both storage adapters and the four SQL and coalescing test files that covered them, 839 lines. The journal tests replace them.

### PR 2: OwnerDO, one object and one socket

**Scope:** the big merge. It can't be split, because half-merged objects still need the plumbing it deletes.

1. Keep one Harness per agent inside OwnerDO. Model/key/session headers, tool registries and cleanup are per agent. Unload idle agents to stay small within 128 MB. The clock takes the earliest deadline across loaded Harnesses and each unloaded agent's stored next deadline. The reference uses one Harness because its session has a single agent identity.
2. Add `owner/owner-do.ts`. Turn `RoomDO`, `AgentDO` and `UserDO` into plain classes, `Room`, `Agent` and `User`, that receive the shared `ctx`, `sql` and a `broadcast` function.
3. Replace every stub call between objects with a direct method call. `grep -rn "Stub(" apps/server/src` must return only the `owner` stub.
4. Delete the files in "Moving data between objects", and `files/file-do.ts`.
5. Change `wrangler.jsonc`:
   - bindings: one `OWNER` binding for `OwnerDO`
   - migrations: add a new tag with `deleted_classes: ["UserDO", "RoomDO", "AgentDO", "FileDO"]` and `new_sqlite_classes: ["OwnerDO"]`
6. Add one socket route, `/api/ws`. In the client, merge `user-channel.ts` into `socket.ts` and subscribe to open rooms. Fix the backoff reset.
7. Update the verify suites that call the old routes or RPCs. Delete the suites that only tested delivery between objects.
8. Delete `core/agent/src/inbox.ts` and deliver directly with `conversation.submit({ whenBusy })`; pi's inbox is already durable. Check whether task-owned conversations (`ownership: { kind: "task" }`) can replace most of `core/agent/src/workers.ts`, as in the reference's durable subagent.

**Gate:**
- 0 calls between objects
- whole prompt at most 15 rows
- every model-free verify suite passes
- the client checked in a real browser with the `verify-kiko` skill

### PR 3: background work rides on runs; one clock

1. Add `owner/clock.ts`. Set the one alarm to the earliest pi task deadline, as in the reference's `#refreshAlarm`, and route remaining application deadlines through it. Delete `core/durable/src/alarm.ts`.
2. Add `owner/after-run.ts`. Move memory capture, naps and initiative there, and delete their timers and requeue paths.
3. Turn routines into scheduled pi tasks as in the reference's `src/schedule.ts`, replacing most of `user/reminders.ts`. Keep stable schedule request IDs so repeated alarm delivery cannot duplicate a routine.
4. Make `models/sync.ts` refresh on app open when the catalog is older than a day. Delete `user/provider-watch.ts`.

**Gate:**
- an idle object over 24 h of simulated time: 0 alarms, 0 rows
- 35 routines due in the same minute: 1 alarm

### PR 4: one schema

1. Merge `room/schema.ts`, `user/schema.ts` and `agent/schema.ts` into `owner/schema.ts`, with about 15 tables.
2. Use composite primary keys such as `(room_id, seq)` with `WITHOUT ROWID`, and add no secondary index unless a measured query needs one. Every index costs a row on every write.
3. Write a reply's FTS5 row once, when the reply is final.

**Gate:**
- at most 8 rows written per prompt
- the search suites pass

### PR 5: each run gets its own invocation

1. `runs.ts` starts each run by calling the object's own stub (`this.env.OWNER.get(this.ctx.id)`), so each run gets its own limits: 50 outgoing calls, 6 connections and 30 s of CPU.
2. A run checkpoints and continues in a new invocation after 40 outgoing calls or 12 minutes.

**Gate:**
- 20 parallel fake runs, each with 60 tool calls, finish without a limit error
- If a self-call doesn't get fresh limits, continue through the alarm instead, and record that here.

### PR 6: R2 archive

1. Add `owner/archive.ts`. It moves messages older than 30 days to R2 as gzip JSONL, one file per room per day, after a run.
2. The room log loads archived days on scroll-back. Search falls back to the archive past the hot range.

**Gate:**
- object storage stays flat across 90 simulated days
- scroll-back and search work across the boundary

## Measuring

The overhead suite counts rows read, rows written and calls between objects per prompt, using the dev stats counters (`lib/dev-stats.ts`, `/api/dev/stats`).

```bash
bun run --cwd apps/server dev --port <free port>   # your own port; stop only your own PID
bun kiko verify overhead --url http://localhost:<port>
bun kiko verify journal-overhead --url http://localhost:<port>   # PR 1's gate
```

The `journal-overhead` suite measures PR 1's gate: the median AgentDO rows across five warm prompts, a quiet minute after a run, and a quiet minute after a failing run. Whole-prompt, RoomDO and UserDO rows are reported without gating them. `PR1_BASELINE=1` records the same numbers on `main` and asserts nothing. `evidence/pr1-after.json` holds the raw counters from the PR 1 run of that suite.

To count alarms and idle writes, read `/api/dev/stats` before and after a quiet minute. Production numbers come from the queries in `evidence/`.

Record each PR's before and after numbers in its PR description.

## Rules this redesign changes

These `AGENTS.md` lines change when the PR named here lands. Update `AGENTS.md` in that PR.

- "Do not wait on another Durable Object inside `receive()`" no longer applies after PR 2, because there is no other object. Keep the spirit: `receive()` stores and returns, and the run happens later.
- "Use `alarm.ts`" becomes "use `owner/clock.ts`" in PR 3.
- "Only the Worker builds a Durable Object name" stays. There's just one name.
- Add in PR 3: no code may schedule work after an error, and every alarm must trace back to a run, a routine or a lease.

## Risks

| Risk | Answer |
|---|---|
| One object is a single thread | Runs wait on the network. The heaviest `AgentDO` call last week used 766 ms of CPU. One object handles about 1,000 requests a second. |
| 128 MB of memory for 20 agents | An agent's harness and sandbox load when it runs. The least recently used ones unload when more than 8 are loaded. |
| A bug in one agent affects all of them | Already true: they share one account's quota. Now a failure costs 1 row instead of the day. |
| A run longer than 15 minutes | It continues in a new invocation from the journal (PR 5). |
| `MemoryStorage` replay is unsafe | PR 1 decided: replay is safe, so the journal replaces pi-durable's SQLite tables. |
| A self-call doesn't get fresh limits | Continue through the alarm instead. PR 5 decides. |
| FTS5 costs more than 2 rows per reply | Batch the run's replies into one insert. PR 4 measures. |

## Open questions

1. **Why did the alarms of agents `2ac9f4ed…` and `5e779543…` fail on 2026-10-19?** Logs were unavailable after the cap. PR 1 removes the loop either way. If the error shows up in `wrangler tail kiko`, note it here.
2. **Does replaying `MemoryStorage` preserve everything `Harness.open` needs to resume a task mid-run?** Answered. The prerequisite checks ran before any change to `host.ts`. They were replaced by the production JournalStorage test, which kills a real Durable Object during a tool call, reopens the journal, preserves committed IDs and completed tool effects, and resumes unfinished work.

   The real-adapter replay test covers a literal Durable Object eviction during a tool call, preserves completed tool effects and resumes unfinished work from JournalStorage. Workers share their agent's Harness, allocator and journal namespace. The prerequisite-only MemoryStorage tests were removed once this test covered the production path.

   The fallback in design section 2 is not used. PR 1 uses the corrected AgentDO-only gate above; whole-prompt writes are PR 2’s responsibility.
