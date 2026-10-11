# U26 Routines and UserDO edges

**Model** Sonnet 5.5 medium. **Wave** 3. **Depends on** U07, U11. **Port** 8826. **Timebox** 3 h.

## Findings (evidence in `issues/audit/user.json`)
1. `snooze` (`apps/server/src/user/reminders.ts:498-508`) applies to every trigger and unpauses paused routines. Time reminders only; leave status alone otherwise.
2. Deleting a chat only forgets loops (`user-do.ts` `apply`). Cancel its reminders and routines and drop their webhook rows in the same step.
3. Webhook routine creation swallows a failed D1 insert (`routines-wiring.ts:70-80`) and returns a token whose URL never works. Fail the create and roll back.
4. A refused routine delivery never counts toward auto-pause (`reminders.ts:402-428`). Make ledger and counter agree.
5. One-off reminders retry every 30 s forever on a persistent error (`reminders.ts:534-557`). Cap attempts, mark failed, tell the human once.
6. `#wiped` is memory-only (`user-do.ts:859,885`). Check a stored tombstone in `fetch()`.
7. `reminders-route.ts` and `soul-route.ts` skip `originAllowed`. Add it.
8. Signal kinds `reminder_fired` and `watch_change` are emitted (`reminders.ts:537,587`) and never consumed. Delete them and their schema entries (`room/signals.ts:16-17`).

## Dropped on purpose
The 20-run ledger window (redelivery past 20 runs is not a real case). Reset snapshot paging (unmeasured).

## Acceptance
One failing-first test per finding. `bun run --cwd apps/server test reminders routines user recurrence` green. `bun yuki verify reminders routines routine-triggers` green on port 8826.
