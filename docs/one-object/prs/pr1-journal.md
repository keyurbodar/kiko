# PR 1: Journal storage, and runs without a heartbeat

Branch `one-object/pr1-journal`, rebased onto `origin/main`. Thread: "One object: PR 1 journal storage".

Status: done, not pushed. Rebased onto origin/main 7802a45f (0.4.16). Final gate: AgentDO 87 to 30 rows, median of five; both quiet minutes 0 writes and 0 alarms; one persisted error. All 48 conformance cases and the scoped check pass. Recovery adds 3 SQL rows per warm run.

## Draft description

**Store each agent's pi-durable commits in a journal, and end failed runs without retry loops**

On 2026-10-19, two idle agents set off an alarm loop that wrote about 115k rows and took the install down at the free plan's daily cap. The loop came from the heartbeat in `core/agent/src/host.ts`. When an alarm failed, it backed off from 1 s to 16 s, and the in-memory failure count reset every time the object was evicted, so the backoff never ended.

This PR:
- **Adds `core/agent/src/journal.ts`.** It's a pi-durable `Storage` that keeps state in `MemoryStorage` and writes one row per commit. Streaming deltas are held in memory and folded into the next real commit. On open, it replays the journal.
- **Deletes the heartbeat, the backoff and `RESET_AFTER`.** A failed run posts one error bubble and schedules nothing.
- **Adds a recovery alarm derived from pi's unfinished tasks,** as in Earendil's reference. An evicted run resumes within 60 s. The alarm disappears once the task settles.
- **Resets the object** with `ctx.abort()` when the Harness closes with a failure.
- **Cleans up an agent's journal when it passes 500 rows or 4 MB and the agent is idle,** instead of every 50 runs. Each fresh run already rebuilds its context from room memory, so cleanup loses nothing.
- **Honors `Retry-After` up to 60 s.** A longer wait ends the run with the rate-limit bubble.
- **Runs pi-durable's storage conformance suite** on the journal.
- **Deletes `sqlite.ts` and `coalescing-storage.ts`.**

Measured warm prompt, median of 5, on the old base:

| | Before | After |
|---|---:|---:|
| AgentDO rows | 87 | 27 |
| Quiet minute after a run | — | 0 writes, 0 alarms |
| Always-failing model | 253 rows | 1 error bubble, then 0 alarms |

RoomDO and UserDO rows (45 and 4) don't change here. PR 2 removes them.

Known limitation: pi-ai's Google and Vertex adapters accept no custom `fetch` and don't expose retry headers, so `Retry-After` can't be honored for them.

## Gate

- AgentDO at most 30 rows per warm prompt, plus at most about 2 rows for the recovery alarm.
- 0 AgentDO writes and no armed alarm in the quiet minute.
- A failure gives exactly 1 error bubble.
- The conformance suite passes.
- An evicted run resumes from the recovery alarm, with no human event.

## Out of scope

Anything in RoomDO or UserDO, schema tuning, and Kiko's inbox. Those are PR 2 and PR 4.
