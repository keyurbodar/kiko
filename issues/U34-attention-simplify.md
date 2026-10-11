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

BRANCH: s/u34-attention-simplify

HEAD: 8e965fdf195592269d60c307dc29e41a4b50fc50 (before this report commit). Its source is the tree of ad089eb7858a75fe301067bc25b2c5c59b8b89fc. The merge into it changed issues files only.

This section replaces the earlier report. That report said the ranking change left the brief's top two unchanged in every pass. That was wrong. Its open-loop comparison put the new score against a variant identical to it, so the zeros were true by construction. The corrected numbers are below.

CHANGED:
- apps/server/src/initiative/attention/rhythm.ts: pooling and smoothing deleted. `activeSlots` and `ignoreDeadline` read the 168 raw weights. `rates` is gone.
- apps/server/src/initiative/attention/attend.ts: `score` is a noisy-or of due and promise only. `talked`, `stale`, and `age` are deleted. `rankOrder` is new: score, then oldest `lastSeen`.
- apps/server/src/initiative/engine.ts: Jev's top ten and `noticed()` sort with `rankOrder`.
- apps/server/test/attention.test.ts: four new behavior tests, and one fixture changed (see DEVIATIONS).
- docs/architecture.md: sections 26.5 and 26.6 describe the new model. The text was already in ad089eb7 when I checked it against the code, and I left it as is.
- issues/U34-attention-simplify.md: this report.

VERIFIED:
- `bun test test/attention.test.ts` in apps/server: `Ran 39 tests across 1 file.`, `39 pass`, `0 fail`.
- `bun run check` on the tree before the merge: `all 10 steps passed`, `EXIT 0`.
- `bun run check` on HEAD: `all 10 steps passed`, `EXIT 0`. Server tests came from cache (`pass  test apps/server  0.2s`). The uncached run took 88.9s. The advisory frontend lint shows `17 errors`, as on main, and is not gating.
- `HUMAN=aware ROOMS=3 bun analyze.ts rhythm`: regular-keen, shipped model: `base nudges 296 ... lands <=1h before a session: base 69.6%`. Main was 9.7% (`out-rhythm-r3-aware.txt`). The `168 raw (neither)` variant is identical to the shipped code: `regular-keen base nudges 296 | dropped 0.0% added 0.0% moved>1h 0.0% | welcome: base 170/296 (57.4%) variant 170/296 (57.4%) | lands <=1h before a session: base 69.6% variant 69.6%`.
- check-imports, check-rules, and check-exports pass inside `bun run check`.

Score, with the old score isolated. The comparison that matters is old score against new score on the same new rhythm. I built it in /tmp from ff26341c with only the new `rhythm.ts` swapped in, and ran `HUMAN=aware ROOMS=3 bun analyze.ts score`. No-Jev welcome rate:

| persona | old score, new rhythm | new score, new rhythm | main (old rhythm, old score) |
| --- | --- | --- | --- |
| regular-keen | 56.4% (168/298) | 57.4% (170/296) | 50.2% |
| regular-ignorer | 9.9% (28/284) | 9.9% (28/282) | 7.6% |
| irregular-keen | 42.4% (108/255) | 41.5% (108/260) | 42.2% |
| irregular-ignorer | 9.9% (23/232) | 10.4% (24/230) | 9.8% |
| kind-split | 41.1% (144/350) | 42.5% (142/334) | 37.6% |
| weekday-weekend | 40.5% (109/269) | 40.5% (109/269) | 35.9% |
| hoarder | 19.5% (147/754) | 18.7% (139/743) | 17.0% |

The score change moves welcome by at most 1.5 points, which is within noise. The shift from main, about +5 to +7 points on regular-keen, kind-split, and weekday-weekend, comes from the rhythm change. The committed rhythm evidence shows the same numbers for the `168 raw (neither)` variant on the old score: regular-keen 56.4%, kind-split 41.1%, weekday-weekend 40.5%.

The ranking change, from the same isolated run (old score against the new score that is now `simple`): brief top-two sets change in 26% to 54% of comparisons, depending on persona (regular-keen 51/152, regular-ignorer 79/199, irregular-keen 98/183, irregular-ignorer 54/140, kind-split 66/251, weekday-weekend 26/99, hoarder 468/1261). Jev's top-ten set changes in 2% to 57% (regular-keen 4.3%, kind-split 12.1%, hoarder 56.5%). So the ranking change does alter what the brief shows and what Jev reads. The simulation does not say whether that is better or worse.

FAILED-BEFORE (the new tests, against the pre-change source):
- `(fail) rhythm > a moment is the session's own hour, not the hour before it`: `Expected: 9`, `Received: 8`.
- `(fail) attend > nothing due or promised scores zero, however often it came up or how long ago`: `expect(received).toEqual(expected)`, with a diff in the scores.
- `(fail) attend > an agent's promise with no date scores half`: `Expected: 0.5`, `Received: 0.5905723664263907`.
- `attend > equal scores rank the oldest sighting first`: without the `rankOrder` export the whole file fails to load (`SyntaxError: Export named 'rankOrder' not found`). With a stub comparator the test fails: `(fail) attend > equal scores rank the oldest sighting first`. The first is a load error, not a behavior failure. The second is the behavior.

DEVIATIONS:
- One interruption per room: the weak candidate's due moved from +2.5 days to +1.5 days, and `mentions: 3` is removed. Without the removed `talked` term it scores 1/3, under the worth bar, so it reported `brief:worth` instead of `room_taken`. The asserted verdicts are unchanged, and the test passes.
- Acceptance "no-Jev welcome unchanged within noise" holds for the score change, as shown in the isolated table. It does not hold against main: the rhythm change moves welcome by 5 to 7 points on three personas. That shift is the rhythm change itself.
- `gen/` is not regenerated. `gen/rhythm-raw.ts` is behaviorally the new rhythm, with the pooling code left in at `POOL = 0`, which is the identity. Closed-loop diff of that variant against the shipped code is 0.0% on every persona.
- Not run: `bun yuki verify <suite>`. The change does alter nudge timing, which initiative suites cover. Those suites need real model keys and a dev server, and the simulation is this unit's acceptance.

FOLLOW-UPS:
- `analyze.ts` now compares the shipped score with a variant identical to it in its open-loop and no-Jev "simple" sections, so those print zero by construction. Add an `oldScore` variant, using the isolated run above as the recipe, so the harness shows the score effect every time.
- `Candidate.mentions` is unused by `attend`. It is still set in `engine.ts`, `types.ts`, and the simulation. Removing it touches `store.ts`, which U35 owns.
- The 17 frontend lint errors remain. They are advisory.

DISCOVERIES:
- My source edits were committed as ad089eb7 by something other than this session, while I was running the gate. The report commits deb87ab2 and 8e965fdf came from an earlier worker. I did not author those commits. I checked their content against the code and corrected the one wrong claim above.
