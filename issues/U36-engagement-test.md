# U36 The engagement test fails on main: find out whether it is the clock or the code

**Model** Haiku 5.5 medium. **Wave** 5. **Depends on** nothing. **Timebox** 75 min.

## Facts
- `apps/server/test/initiative-runs.test.ts`, "a human who chats about other things after a nudge did not engage with it; a reply quoting it did", fails on `main` (`c3b65b58`): the quoted reply records `{ engaged: 0, ignored: 1 }` instead of `{ engaged: 1, ignored: 0 }` at line 113.
- It passed when U35 landed (after U34 and U33). Nothing that touches initiative code has landed since.
- U34 removed smoothing from `apps/server/src/initiative/attention/rhythm.ts`, which changes the ignore deadline computed from the rhythm. Suspect: the test's reply time can fall after a deadline that now depends on the current wall-clock hour.

## Goal
Find the root cause. If the test depends on the real clock, make it deterministic (fixed now, fixed rhythm), keeping what it asserts. If the product logic is wrong (a quoted reply inside the real window is not counted because the deadline is computed wrongly), fix the product code and keep the test. Say which it was, with evidence: run the test with the clock pinned to several hours of the day and show the result per hour before the fix.

## Scope
`apps/server/test/initiative-runs.test.ts`, and only if the cause is in product code, the smallest change in `apps/server/src/initiative/`.

## Acceptance
The test passes at every hour of the day (show it), and fails if the quote no longer counts. `bun run check` passes with `--no-cache` for the server tests.

## Report

**Cause: product code, and the clock only chose which minutes showed it.** `ignoreDeadline` in `apps/server/src/initiative/attention/rhythm.ts` walks forward in 15-minute steps. It credits each step's full 15 minutes to the slot where the step starts. A step that starts at 13:59 gets 15 minutes of the 13:00 hour, but only 1 minute of that step is in that hour. From 13:14 the walk takes four steps, so it credits 60 minutes of an hour that has 46 minutes left. The window closes at 14:14, an hour out. From 13:15 the walk takes three steps (45 minutes), so the window runs to the next day. The quote in the test lands at +61 minutes, which is outside the first window and inside the second.

**Evidence, before the fix (test unchanged, `Date.now` pinned with a bun preload):**
- Hour of day does not matter. Every hour fails at :05 and passes at :30.
- The minute does. At 13:xx, minutes 00 to 14 fail and 15 to 59 pass.
- Deadline offsets before the fix: 13:00 +60 min, 13:14 +60 min, 13:15 +1440 min, 13:30 +1440 min.

**Fix.** Each step ends on the 15-minute grid, and it counts only the time it spends in its own slot. The deadline is the end of the step that reaches the need. Hour boundaries fall on the 15-minute grid for every zone whose offset is a multiple of 15 minutes.
- Deadline offsets after the fix: 13:00 +60 min, 13:14 +1441 min, 13:15 +1440 min, 13:30 +1440 min.

**Test.** `now` is fixed at `Date.UTC(2026, 9, 10, 13, 14)`, a minute the old code got wrong. It fails on the old code every time. The assertions are unchanged.

**Evidence, after the fix (a temporary copy of the test read the clock from an env var, then was deleted):**
- All 24 hours at :14, :15, and :59 pass.
- Minute sweep at 13:xx: 59 pass. The one failure is 13:00:00.000 exactly. See FOLLOW-UPS.
- Seconds: 13:00:00 fails, 13:00:01, 13:00:30, 13:00:59, and 13:01:00 pass.

**Fails if the quote stops counting.** I broke the quote branch in `engine.ts` for one run. The test failed at the quote assertion (`expect(await outcome(10))`, line 114): `Expected - 2 / Received + 2`. I restored `engine.ts` from `HEAD`, and the file passed again (5 pass).

## Discoveries

- The brief guessed the hour of day. The cause is the minute within the hour.
- `rhythm.ts` was U34's file, and I changed one function in it. The brief allowed that because the cause is product code.
- The U34 and U35 simulation outputs in `issues/evidence/u40b` were not rerun. The fix changes a deadline only when a nudge lands in the last 45 minutes of an active hour.
