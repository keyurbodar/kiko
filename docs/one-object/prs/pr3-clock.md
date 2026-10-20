# PR 3: One clock, and background work after runs

Branch `one-object/pr3-clock` from `one-object/pr5-runs`.

## Draft description

**Wake only for work the human started**

An idle install still woke about 148 times a day. The triggers were a 10-minute model catalog sync, a provider sign-in poll, room memory summaries retried every 10 minutes, and memory capture requeued every 60 s forever. Routines kept their own wakeup table, separate from pi's scheduler.

This PR keeps one alarm, set to the earliest of:
- the deadline of every loaded agent's pi tasks
- the stored next deadline of each unloaded agent
- a browser lease end
- the hello deadline

It follows `#refreshAlarm` in Earendil's reference. Routines become scheduled pi tasks that sleep until their time, so a routine and a run share one mechanism. Memory capture, room summaries and initiative run once, after a run the human started. The model catalog refreshes when the app opens, if it's older than a day.

| | Before | After |
|---|---:|---:|
| Alarms on an idle day | ~148 | 0 |
| Rows on an idle day | ~600 | 0 |

## Steps

1. **`owner/clock.ts`.** Compute the alarm the same way as the reference's `#refreshAlarm` (`src/session.ts`):
   - skip blocked tasks
   - a task waiting on a future deadline counts at that deadline
   - a runnable task counts at `now + 60 s`, as recovery
   - take the earliest, or clear the alarm when there's none

   Serialize alarm updates. Skip `setAlarm` when the time hasn't changed. Delete `core/durable/src/alarm.ts` and its wakeups table.
2. **Routines as pi tasks,** as in the reference's `src/schedule.ts`. A routine is a durable task that sleeps until its time, then submits its instruction to the agent with a stable `requestId`. Each routine keeps its exact time. Routines due in the same minute fire from one alarm. Replace most of `user/reminders.ts` and the routine wiring. Keep the routine UI and protocol unchanged.
3. **`owner/after-run.ts`.** After a human run's reply is sent, in the same invocation, run memory capture, room summaries and initiative once. A failure waits for the next run. Delete the capture requeue loop and the nap timers.
4. **Model catalog.** Delete the 10-minute catalog timer in `models/sync.ts`; refresh when the app opens if it's older than a day. Delete `user/provider-watch.ts`; sign-in problems show when a run fails and when settings open.
5. **`AGENTS.md`.** "Use `alarm.ts`" becomes "use `owner/clock.ts`". Add: "No code schedules work after an error. Every alarm traces back to a pi task, a routine, a lease or the hello deadline."

## Gate

- 24 h of simulated idle time: 0 alarms, 0 rows.
- 35 routines due in the same minute: 1 alarm, 35 runs.
- A routine fires at its exact minute while the browser is closed.
- The routine and reminder verify suites pass.

## Out of scope

The schema (PR 4) and the archive (PR 6).
