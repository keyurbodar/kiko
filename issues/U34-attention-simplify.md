# U34 Attention: drop rhythm pooling and smoothing, two-part score

**Model** Haiku 5.5 medium. **Wave** 4. **Depends on** U40b (done). **Timebox** 90 min.

## Evidence
`issues/evidence/u40b/` (simulation of 7 personas over 8 weeks, real code). Read its README and `out-rhythm-*.txt`, `out-score-*.txt`. The U40b report is summarized in `issues/decisions.tsv`.

## Build
1. `apps/server/src/initiative/attention/rhythm.ts`: delete pooling (`POOL` and its use) and smoothing (the neighbor spill in `rates`). `rates(r)` becomes the raw weights, or goes and its two callers read them directly. Keep the 168 weekly slots: the simulation showed a 24-slot model sends weekend nudges hours early.
2. `apps/server/src/initiative/attention/attend.ts`: `score` becomes a noisy-or of two parts, due `[1, due]` and agent promise `[0.5, promise]`. Delete the `talked` and `stale` parts and the `age` term. Where the score ranks items (Jev's top ten, `noticed()` in `apps/server/src/initiative/engine.ts`), sort by score, then by oldest `lastSeen`.
3. Update `apps/server/test/attention.test.ts` and any test that pinned the old weights. Keep tests that assert behavior; rewrite ones that only pinned constants.

## Not in scope
Per-kind appetite and the engagement signal (U35 owns `appetite.ts`, `store.ts`, and how engagement is recorded).

## Acceptance
- Rerun the simulation from `issues/evidence/u40b` after regenerating `gen/` if needed: `bun analyze.ts rhythm` shows regular-keen nudges landing within an hour of a session near 68% (was about 10%), and `bun analyze.ts score` shows no-Jev welcome rate unchanged within noise. Paste the lines.
- `bun run check` passes.

## Report

STATUS: done

Commits on `s/u34-attention-simplify`: `ad089eb7` (the change), a merge of `main` (`5282addc`), and this report commit.

The uncommitted work from the cancelled worker matched the brief. I kept it and made three fixes: I renamed one test whose name still said "mentioned", I updated `docs/architecture.md` section 26.6 (the score, the moment, and the ranking), and I checked the fixture change below.

Acceptance, from `issues/evidence/u40b` with `HUMAN=aware ROOMS=3` (defaults: 10 seeds x 8 weeks). `gen/` was not regenerated: `gen/rhythm-raw.ts` already equals the new `rhythm.ts` except for the removed pooling and smoothing lines, and the other `gen/` files are standalone copies of the old code.

Regular-keen nudges that land within an hour of a session, shipped model (was 9.7% on main, `out-rhythm-r3-aware.txt`):
- `regular-keen       activeNow differs in 10.4% of week slots; at shipped passes 11.0% | next moment differs >1h 25.0%`
- `regular-keen       base nudges  296 | ... | welcome: base 170/296 (57.4%) ... | lands <=1h before a session: base 69.6% variant 10.4%` (variant = 168 no pooling)
- `regular-keen       base nudges  296 | ... | welcome: base 170/296 (57.4%) variant 170/296 (57.4%) | lands <=1h before a session: base 69.6% variant 69.6%` (variant = 168 raw, identical to the shipped code)

No-Jev welcome rate, `bun analyze.ts score`, "score, no Jev" base column. Main's values are from `out-score-r3-aware.txt`; these are the same base, with the rhythm change included:

| persona | main | U34 |
| --- | --- | --- |
| regular-keen | 50.2% | 57.4% |
| regular-ignorer | 7.6% | 9.9% |
| irregular-keen | 42.2% | 41.5% |
| irregular-ignorer | 9.8% | 10.4% |
| kind-split | 37.6% | 42.5% |
| weekday-weekend | 35.9% | 40.5% |
| hoarder | 17.0% | 18.7% |

The no-Jev score-only top-2 and top-10 sets changed 0.0% of passes in the open loop for every persona. The no-Jev welcome shift is not "within noise" for kind-split and weekday-weekend (about +4.5 points). I could not isolate score from rhythm in this run, because the baseline combines both changes. See FOLLOW-UPS.

Brief top-2 changes after the score change: 0 of 1,122 comparisons changed in the "score, no Jev" section, so the ranking change left the brief's top two unchanged in every simulated pass.

FAILED-BEFORE (new tests, run against main's files swapped into the worktree, then restored):
- `rhythm > a moment is the session's own hour, not the hour before it` fails on main's `rhythm.ts`: `38 pass, 1 fail`.
- `attend > nothing due or promised scores zero, however often it came up or how long ago` fails on main's `attend.ts`: `(fail) attend > nothing due or promised scores zero ...`.
- `attend > an agent's promise with no date scores half` fails on main's `attend.ts`: `(fail) attend > an agent's promise with no date scores half`. This one is a behavior check: the promise weight is unchanged, but the old score also added `talked` and `stale` on top, which made it fail.
- `attend > equal scores rank the oldest sighting first` fails on main's `attend.ts` (with `rankOrder` added): `(fail) attend > equal scores rank the oldest sighting first`. Main had no `rankOrder` at all.

DEVIATIONS:
- Fixture change in `one interruption per room`: the weak candidate's due moved from +2.5 days to +1.5 days. Without `mentions`, +2.5 days gives urgency 1/3, under the worth threshold, so the test would stop reaching the room-taken branch. The asserted behavior is unchanged.
- `docs/architecture.md` section 26.6 is updated in the same change, as AGENTS.md asks.
- `gen/` was not regenerated, as described above.

VERIFIED:
- `bun run --cwd apps/server test -- attention`: `39 pass, 0 fail` (before the test rename; the rename changes no assertion).
- `bun run --cwd apps/server typecheck`: `tsc --noEmit`, exit 0.
- `bunx biome check apps/server/src/initiative apps/server/test/attention.test.ts`: `Checked 8 files ... No fixes applied.`
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun run check` (after merging main): `all 10 steps passed (1 flaky)`, exit 0. The one flaky step was `test apps/web-solid`, which passed on rerun. The advisory frontend lint reported 17 errors, as on main, and is not gating.
- Simulation outputs are in `/tmp/u34-sim-rhythm.txt` and `/tmp/u34-sim-score.txt`, not in the repo.

FOLLOW-UPS:
- `Candidate.mentions` is now unused by `attend`. It is still set in `engine.ts`, `types.ts`, and the simulation, so removing it touches `store.ts`, which U35 owns. Leave it to U35 or a later unit.
- The kind-split and weekday-weekend no-Jev shifts (about +4.5 points) need an isolating run: a `gen/` variant of main's `attend.ts` on the new rhythm, compared with the new score. Until that exists, the score's share of this change is unknown.
- The frontend lint has 17 pre-existing errors. It is not gating, but it stays visible.
