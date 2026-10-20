# One object: Kiko on a single Durable Object

Status: shipped in one pull request on 2026-10-20. Written against `main` at 6167d2b1. The current state is in `HANDOFF.md`.

This file is the design brief. Read `HANDOFF.md` first for the current state and what is left.

Companion files:

- `HANDOFF.md`: the current state, the measurements and what is left.
- `strategy.html`: the plan to cut writes per prompt to 3, as charts.
- `evidence/row-billing/`: what each SQLite operation bills, measured.
- `evidence/measurements.md`: the production measurements behind the outage, and how to rerun them.
- `evidence/e2e-before.log`, `evidence/e2e-after.log`: the one e2e on `main` and on this design. `evidence/e2e-after.json` holds the raw counters.
- `evidence/cloudflare-quota/`: the deployed Free-plan probe of the per-invocation call budget.
- `references.md`: Cloudflare limits, doc links, and every code area this design touches.

## Why

Kiko has one human per Worker, but the server is built as if it served many. There is one Durable Object per room, per agent, for the user and for files. Every boundary between them needs a billed call, a stored queue, an alarm to drain it and a retry when it fails.

On 2026-10-19, two idle agents looped on a failing alarm. They wrote about 115k rows and took the owner's install down at the free plan's cap of 100k rows a day. Seven loops in the code retry forever; `evidence/measurements.md` lists them. Adding guards to each loop would leave the boundaries that create them, so this plan removes the boundaries.

## Goals

1. An idle install writes 0 rows and sets 0 alarms.
2. A failure costs 1 row, a visible error. Nothing retries on its own except Cloudflare's capped alarm retry.
3. A prompt makes 0 calls between objects and writes as few rows as durability allows. It costs 33 today; the target is 3, with 2 as a stretch goal (see `HANDOFF.md`).
4. A day of 20 agents, 35 hourly routines and 2,000 prompts fits the free plan with room to spare.
5. Nothing the human sees gets worse.

## Before and after

Measured with the one e2e, `bun kiko verify journal-overhead`, with a fake model. Billed writes are SQL rows plus KV keys plus `setAlarm` calls.

| | `main` v0.4.16 | This design |
|---|---|---|
| Durable Object classes | 4, one instance per room and per agent | 1 |
| Billed writes per prompt | 136 SQL rows, plus KV and alarms | 33 (30 SQL + 3 `setAlarm`) |
| Writes in the idle minute after a prompt, then after an error | 9, then 5 | 0, then 0 |
| A failing prompt | 248 rows + 6 alarms | 42 writes, 1 visible error row, then nothing |
| Calls between objects per prompt | ~18 | 0 |
| Rows a day from one broken agent | ~58,000, forever | 1 error row |
| Retry loops with no end | 7 | 0 |
| Sockets per tab | 2 | 1 |

### The target day: 20 agents, 35 hourly routines, 2,000 prompts

That's 2,840 runs. At 136 rows each, `main` would write about 386k rows, nearly 4× the Free cap of 100k. At 33 writes each, this design writes about 94k, just under the cap. At the target of 2 writes plus 1 per model turn, a day of 3-turn runs costs about 14k, 14% of the cap. `HANDOFF.md` has the plan.

Awake time is the other tight quota. One object awake all day uses 11,059 of the 13,000 GB-s, and runs happening at the same time share that time.

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

The fallback is not used. Replay proved safe, so the journal replaces pi-durable's SQLite tables outright.

**Dependency contract.** `@earendil-works/pi-durable`, `@earendil-works/pi-ai` and `@earendil-works/chord` are pinned exactly to 1.3.0. Bump all three together. Every bump must pass the unchanged upstream `registerStorageConformance` suite against real JournalStorage, including reopened reads. All 48 cases pass: 24 live and 24 with reopened reads. The suite is permanent upgrade coverage, alongside the real eviction/resume test.

### 3. A run without a heartbeat

An agent with pending input runs to its final answer in one invocation, then stops. There's no 30 s heartbeat and no backoff.

**Pending input.** `runs.ts` treats an agent as having pending input when it has messages it hasn't answered yet, so queuing a run writes nothing.

**After an eviction.** A recovery wakeup is derived from unfinished pi tasks. Blocked tasks are ignored. A task waiting for an application-defined future deadline uses that deadline; other unfinished tasks use now plus 60 seconds. The earliest deadline wins. Task settlement recalculates the wakeup, and no recovery wakeup remains when tasks finish or fail. This is recovery for durable work, not an idle heartbeat. Unchanged alarm times are not written again. `MAX_RESUMES` stays at 3, so repeated object crashes still drop the run and show an error.

pi-durable 1.3.0 does not expose a generic sleep timestamp in `TaskInspection`. The host's `scheduledDeadline` callback reads application-defined durable task data, like the reference's schedule helper. Agent work uses the 60-second recovery fallback; scheduled routines supply their future deadlines.

A failed `harness.closed` result aborts the Durable Object, matching [Earendil's Cloudflare reference](https://github.com/earendil-works/pi-durable-cloudflare/blob/main/src/session.ts), so a broken harness is never retained for another event.

**Long runs.** A run can reach 40 outgoing calls or come close to the alarm's 15-minute limit. When it does, it saves and continues from the next alarm. A run started by a human message runs inside that socket event, and every run one event starts shares one budget.

### 4. Failure is a message, not a timer

An error becomes a bubble the human can see and retry, using the existing run-error bubbles in `agent/run-error.ts`. No code path schedules work after an error. Cloudflare's own alarm retry, capped at 6 attempts, is the only automatic retry left.

Model retries in `agent/retry.ts` keep their limit of 3. They also honor a wait the provider asks for: `Retry-After` in seconds or as an HTTP date, and `Retry-After-Ms` in milliseconds, which wins over the other two. A wait of 60 s or less delays the next request, and the run keeps its retry status, including for a stream that breaks halfway. A wait longer than 60 s ends the run with the rate-limit bubble and no further request.

The Google Generative AI and Google Vertex adapters in `pi-ai` take no custom `fetch`, and their `ApiError` carries no response headers. A header delay from those two providers cannot be honored through the supported extension points. Kiko overrides neither the provider nor the dependency, and those providers keep the bounded outer retry of 3. The owner accepted this verified upstream limitation.

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
    archive.ts    old history to R2
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

## Measuring

```bash
cd apps/server && NODE_ENV=development bunx wrangler dev --port <free port> --persist-to <fresh dir>
bun kiko verify journal-overhead --url http://localhost:<port>
```

The suite counts billed writes across five warm prompts, a quiet minute, an always-failing prompt and another quiet minute, plus calls between objects and error rows. Its gate is the measured cost, so a regression fails. Production numbers come from the queries in `evidence/`.

## Risks

| Risk | Answer |
|---|---|
| One object is a single thread | Runs wait on the network. The heaviest `AgentDO` call in the week measured used 766 ms of CPU. |
| 128 MB of memory for 20 agents | An agent's harness and sandbox load when it runs. The least recently used ones unload when more than 8 are loaded. |
| A bug in one agent affects all of them | Already true: they share one account's quota. Now a failure costs 1 row instead of the day. |
| A run longer than 15 minutes, or past 40 calls | It saves to the journal and continues from the next alarm. |
| Parallel runs rely on each socket message getting its own 50-call budget | That's Cloudflare's per-invocation model, but no deployed probe has run it yet. If it fails, remove the inline step in `OwnerDO.humanInput`; tickets still drain from the alarm. |

## Open questions

1. **Why did the alarms of agents `2ac9f4ed…` and `5e779543…` fail on 2026-10-19?** Logs were unavailable after the cap. The loop is gone either way.
