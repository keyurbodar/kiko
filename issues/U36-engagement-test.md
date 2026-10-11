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
