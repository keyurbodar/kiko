# PR 1: final gate and scope

PR 1 is done, not pushed. The owner's corrected AgentDO gate passes.
PR 2 has not started. All four Durable Object classes remain.

## Before and after

Baseline: untouched `origin/main` at `7802a45f` (0.4.16), measured on 2026-10-20. Final source is
`318f0e0b`, pinned by `pr1-code.sha256`. Bun 1.3.14, Wrangler 4.146.0,
local fake model `faux/faux-1`. These are SQL write counts, not production latency claims.

| Warm prompt, median of five | Before | After |
|---|---:|---:|
| AgentDO SQL rows | 87 | 30 |
| RoomDO SQL rows (reported only) | 45 | 45 |
| UserDO SQL rows (reported only) | 4 | 4 |
| Whole prompt SQL rows (reported only) | 136 | 79 |
| AgentDO setAlarm calls per prompt | 2 | 2 |

Final AgentDO samples: 30, 30, 30, 30, 30 (range 30 to 30).
Final whole-prompt samples: 79, 81, 79, 79, 79 (range 79 to 81).
Baseline AgentDO samples: 87, 87, 87, 87, 87. Baseline whole-prompt samples: 136, 138, 136, 136, 136. `pr1-before.json` records this fresh five-prompt measurement on origin/main itself, including raw counters for both quiet minutes and the failing model. The isolated baseline checkout had no tracked modifications.

The accepted pre-recovery run on the original 6167d2b1 base is retained in `pr1-before-recovery.json`: 27 AgentDO rows in all five samples. Recovery adds exactly 3 SQL rows and one setAlarm call per warm prompt. The focused lifecycle test records one recovery wakeup insert and one delete, with no updates during the run. The existing wakeups primary-key index remains unchanged. SQL rows and setAlarm calls are separate counters.

This measures the local write path for completed faux-model replies, not provider latency or production throughput. Baseline and final use the same serial workload and five warm samples. No schema tuning or instrumentation was applied to either server. The baseline and final servers used separate state and counters; scoped unit checks ran in separate processes.

## Final runs on frozen code

An untouched detached checkout at 7802a45f served the baseline on port 8812. Both sides used fresh, separate persistence and the same gate workload. The baseline started in recording mode; the rebased branch ran with the gate enforced. Each side used five warm prompts and both full quiet minutes.

```
PR1_BASELINE=1 PR1_EVIDENCE=docs/one-object/evidence/pr1-before.json bun kiko verify journal-overhead --url http://localhost:8812
PR1_EVIDENCE=docs/one-object/evidence/pr1-after.json bun kiko verify journal-overhead --url http://localhost:8811
```

The server used fresh local state. No other benchmark populated it. Each prompt
waited for the expected answer and idle, then 300 ms before reading `/api/dev/stats`,
matching the baseline workload. Each quiet interval lasted a full 60 seconds.
Raw counters, all five warm samples, medians and errors are in `pr1-after.json`.
Its JSON is compacted for storage without changing any data.

| Phase | SQL rows: total / agent / room / user | New agent alarms | Armed agent alarm |
|---|---|---:|---|
| warm prompt 5 | 79 / 30 / 45 / 4 | 2 | none |
| quiet minute after the prompt (60 s) | 9 / 0 / 8 / 1 | 0 | none |
| always-failing prompt | 92 / 43 / 43 / 6 | 2 | none |
| quiet minute after the error (60 s) | 5 / 0 / 4 / 1 | 0 | none |

The always-failing model produced exactly one live error bubble and one persisted
bubble read on a fresh socket. Both quiet minutes recorded zero AgentDO writes,
zero new agent alarms and no armed agent alarm. The corrected threshold is at
most 30 AgentDO rows per warm prompt, median of five. RoomDO and UserDO background
work remains visible in the raw counters and is not excluded from reported totals.
KV puts/deletes and alarms are counted separately from SQL rows.

The baseline always-failing prompt wrote 248 total SQL rows (199 AgentDO, 43 RoomDO, 6 UserDO) and produced one live and persisted error. Its quiet intervals each recorded zero AgentDO writes and setAlarm calls.

The baseline server exposes no `alarmAt` in its dev status, so its armed-alarm state is reported as unknown rather than inferred from setAlarm counts. No instrumentation or source patch was added to origin/main. The final server exposes and checks the actual alarm state.

## Scope correction and reversions

The original 40-row whole-prompt gate was incorrect for PR 1. The owner replaced it
with the AgentDO gate above and reserved a whole-prompt limit of 15 for PR 2.
All exploratory schema rebuilds and index tuning were removed from the branch.

Unchanged from the rebased `origin/main`:

- Room source: `burst.ts`, `chat-touch.ts`, `log.ts`, `members.ts`, `memory.ts`,
  `reactions.ts`, `room-do.ts`, `schema.ts`, `status.ts`, `team.ts`.
- `core/agent/src/inbox.ts`.
- Room tests: `agent-status`, `room-pending-window`, `room-schema-bill`,
  `room-send-cost`, `schema-upgrade`.

Agent schema adds only JOURNAL_STEPS. Outbox retains fail(), with save() restored.
The schema fixture was regenerated from the final real objects. Tests for the
reverted work and the prerequisite-only MemoryStorage/Google checks were deleted.
Temporary instrumentation is absent. The discarded optimization commits, including
84f725ab, are absent from the rewritten branch history.

The branch was fetched and rebased onto 7802a45f before the final measurements. Upstream #22 (1cb408fe) and #24 (cab73812) were read and reviewed. The host retains memory refresh versus forget, worker invalidation only on forget, stale worker-envelope filtering and forced memory rebuilding. Routine, chief and presence extensions, workers.ts and the root package remain identical to upstream. Agent erasure now closes the Harness before wiping its journal, preserving upstream deletion cleanup under the new memory-backed adapter. The focused regression failed without shutdown and passes with it.

## What remains and how it is proved

JournalStorage replays committed writes into MemoryStorage. Root and workers share
one Harness, ID allocator and journal namespace per agent. Streaming updates to
current-only documents stay in memory until a durable boundary. Memory replay worked;
the fallback was not used. The prerequisite check preceded host changes and was
replaced by the kept real-adapter eviction test.

Focused behavioral coverage includes:

- Literal eviction during a tool: committed IDs, tasks, submissions, snapshot and
  receipt survive; completed work runs once and the interrupted tool resumes.
- Host lifecycle: a failure after Stop consumes its marker; an always-failing model leaves one error and no alarm. A literal mid-tool eviction resumes from the real 60-second recovery alarm without an intervening request, then clears the alarm. A storage failure aborts the object. Agent erasure closes the retained Harness so it cannot recreate journal rows or recovery after deletion.
- Journal cleanup: exceeding either 500 rows or 4 MB while a tool runs keeps the journal until idle, carries real Harness usage through beforeCompact, clears once, increments the epoch and accepts the next run.
- The unchanged upstream registerStorageConformance suite passes 24 cases against live JournalStorage and the same 24 against reopened reads in a real SQLite Durable Object. No cases are skipped or weakened.
- Retry-After: a 3-second delay waits before another request; a 61-second delay ends
  the run as a rate-limit error without another request.

The heartbeat, backoff, reset/requeue path and old storage adapters are deleted.
MAX_RESUMES stays three. Active work uses waitUntil. Unfinished, nonblocked pi tasks derive a recovery wakeup, with a 60-second fallback or the application task deadline. Settlement removes it when no eligible task remains. Unchanged alarm times are not written again; wake() also retains its resume path. Harness.closed aborts the object on failed storage. Cleanup uses actual journal rows and stored bytes rather than a run counter.
Deleted six files (839 lines): sqlite.ts, coalescing-storage.ts and their four old
server test/worker files. The existing worker/interrupt fixtures only lose heartbeat
configuration. The replay test compares raw task records before Harness.open,
which intentionally recovers a running tool as pending.

After the rebase and erasure fix, all 15 steps of `bun run check` passed with its server runner scoped to journal-storage, journal-conformance, host-lifecycle, retry-after, schema-columns, interrupt, workers, memory-context, memory-refresh, memory-summary-invalidation and erase. The server runner used --no-cache, so every selected case ran on the final code. The upstream suite runs all 48 cases unchanged; host lifecycle includes 9 cases and the real 60-second recovery alarm. The root command has no file filter, so a temporary Bun preload supplied these existing runner arguments without changing repository configuration. Only journal-overhead was run as a verify suite. Production and dependency hashes stayed unchanged through the final benchmark. Private temporary storage on the regular disk avoids the unrelated full shared /tmp filesystem.

Google Generative AI and Vertex reject custom fetch and discard retry headers in
the installed pi-ai adapters. Their header delays cannot be honored through supported
extension points. The owner accepted documenting that upstream limitation in PR 1;
no provider override or dependency patch was added. Other supported transports honor
Retry-After seconds, dates and millisecond headers, with a 60-second maximum.

All pi-durable, pi-ai and chord package specs are pinned exactly to 1.3.0. Bump all three together and rerun the permanent conformance suite.

No PR was opened and nothing was pushed. Own dev servers were stopped by PID.
The branch contains three clean commits: journal/host, Retry-After, documentation.
