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

## Report

**STATUS:** done

**BRANCH:** s/u26-userdo (main merged in, fast-forward to f2a9ef27)

**HEAD:** 816d583b (code commit). A report commit sits on top and changes only this file.

**CHANGED**
- `apps/server/src/user/reminders.ts`: snooze refuses non-time triggers and keeps a paused routine paused; `cancelRoom` and `remove` added; a refused routine run goes through `finishRun`; a one-off that throws three times becomes `failed` with one notice; `reminder_fired` and `watch_change` emission and the `signal` port removed.
- `apps/server/src/user/routines-wiring.ts`: a failed webhook row throws; `createRoutine` removes the routine when the wiring fails; `cancelRoom` drops webhook rows.
- `apps/server/src/user/user-do.ts`: chat delete cancels reminders and routines (sync SQL, D1 hook drops through `waitUntil`); `#wiped` memory flag replaced by a stored `WIPED` tombstone; `signal` port removed.
- `apps/server/src/user/reminders-route.ts`, `soul-route.ts`: `originAllowed` before the session lookup.
- `apps/server/src/room/signals.ts`: `reminder_fired` and `watch_change` schema entries deleted.
- `docs/architecture.md`: signal list corrected; `failed` one-off state and snooze rule stated.
- Tests: `reminder-rules.test.ts` (3 added), `reminders.test.ts` (chat delete), `routines.test.ts` (signal schema), new `routines-hooks.test.ts`, `user-routes-origin.test.ts`, `user-tombstone.test.ts`.

**VERIFIED**
- `bun run check` → `all 10 steps passed`, exit 0 (the frontend lint 17 errors line is the known non-gating advisory step).
- `bun run typecheck` → every package `Exited with code 0`.
- `bun run --cwd apps/server test -- reminders routines user recurrence --no-cache` → `75 pass, 0 fail across 8 files`.
- `bun run --cwd apps/server test -- reminder-rules --no-cache` → `7 pass, 0 fail`.
- `bun yuki verify reminders routines routine-triggers --url http://localhost:8826` → `pass reminders`, `pass routine-triggers`, `pass routines`.
- `bun scripts/check-imports.ts`, `check-rules.ts`, `check-exports.ts` → pass (inside `check`).
- `bunx biome check apps/server core apps/cli scripts` → no errors; the 5 warnings are in untouched files.
- Mutation check: removing the one-off cap call makes `reminder-rules` fail with `Expected: "failed" / Received: "active"`.

**FAILED-BEFORE** (each new test failed on the code before the fix)
- `snooze moves only time reminders, and a paused time routine stays paused`: the message routine snooze did not reject, and the paused time routine went active.
- `a refused routine run counts toward auto-pause`: `expect(received).toBe(expected)`, status `active` vs `paused`.
- `a one-off reminder that keeps failing ... marked failed`: `Expected: "failed"`, `Received: "active"`.
- `a webhook routine is not created when its lookup row cannot be stored`: `out.ok` was true.
- `deleting a chat cancels its reminders and routines`: statuses were not all `cancelled`.
- `the signal schema has no kind that nothing reads`: decoding `reminder_fired` did not throw.
- `reminders and souls refuse a request from another origin`: `Expected: 403 / Received: 401` at the reminders route.
- `a wiped user object refuses new rows after it is evicted and restarted`: `user-tombstone.test.ts:36`, `Expected: false / Received: true`.

**DEVIATIONS**
- Snooze on a paused time routine keeps it paused. The brief said "leave status alone otherwise"; I read that as: a pause is the human's choice, so snooze does not undo it. A done time routine or a failed one-off does become active again, and its fail count resets.
- A one-off that fails three times gets a new status, `failed`. The brief said "mark failed", so I added it to `ReminderStatus`. The protocol and client do not carry reminder status, so nothing else changes.
- A refused routine run is counted through `finishRun` (the same counter a room-reported failure uses), not logged as a non-failure. This keeps the ledger and the counter in agreement.
- A failed webhook insert rolls back by deleting the DO row (`Reminders.remove`), not by cancelling it, so no cancelled row lingers.
- The wipe tombstone replaces the `#wiped` flag entirely. Every `#wiped` check is now an async storage read.
- `docs/architecture.md` changed in this unit: the signal list (its removed kinds) and one line on the one-off `failed` state.
- Commit trailer: the brief names Opus 5.5, so I used that.
- Local setup only, not tracked: `apps/web-solid/dist` is an empty directory I created so `wrangler dev` could start. Git does not track it.

**DISCOVERIES**
- `wrangler dev` will not start in a fresh worktree until `apps/web-solid/dist` exists (the assets binding). The brief's `bun run --cwd apps/server dev` path needs that directory.
- `deleteAll` reads `CREDENTIALS_KEK` (the Composio disconnect reads the keyring). A miniflare test of the wipe needs that binding; `credentials.test.ts` and `extension-store.test.ts` already set one.
- `AgentDO` (`agent-do.ts:675`) and `RoomDO` (`room-do.ts:894`) have the same memory-only wipe flag this unit fixed in `UserDO`.

**FOLLOW-UPS**
- Updating a routine to a webhook, or rotating its token, still has no rollback. `routineChanged` now throws on a failed D1 insert, so the update returns an error after the DO row already holds the new token hash. Rotation also leaves the old `hooks` row in D1 (harmless, since the DO hash no longer matches, but it accumulates).
- The webhook lookup-row drop on chat delete has no workerd test. The D1 binding is not in the reminders worker. The CLI suite does not cover chat delete either.
- The room's own event-routine list (`setRoutines`) is not cleared when its chat is deleted. Harmless today, because `fireEvent` refuses cancelled rows.
- Nothing in the client shows the `failed` one-off status. I did not check whether the client renders reminders at all.
- `AgentDO` and `RoomDO` wipe flags (see Discoveries).
- Dropped per the brief: the 20-run ledger window and the reset snapshot paging.
