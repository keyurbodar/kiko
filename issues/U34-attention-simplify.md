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
