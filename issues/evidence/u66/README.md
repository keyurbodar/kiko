# U66 initiative measurements

The same deterministic simulation as U40b (`../u40b`), run on the attention code after U66. Seven personas over 8 weeks, with the spread over seeds. It runs the real `appetite.ts`, `attend.ts`, `rhythm.ts`, and `score` from `apps/server/src/initiative/attention/`. Jev is the rule-based stand-in (ASSUMPTION) in every run.

Run from this directory:

- `SEEDS=10 WEEKS=8 ROOMS=3 bun quality.ts`: nudges per week and welcome share per persona. `JUDGE=1` adds Jev.
- `bun analyze.ts appetite`, `rhythm`, or `score`: one comparison each. No argument runs all three.
- `bun kindsplit.ts`, `bun signal.ts`, `bun timing.ts`, `bun smoke.ts`.

Environment: `SEEDS`, `WEEKS`, and `ROOMS` (1, 3, or 8). `HUMAN=aware` uses the aware human model. `SIGNAL=room` brings back the rule before U35. `RECALL` (default 1) is the share of meant replies the server recognises (ASSUMPTION). `GAP=0` turns off the 20-hour gap between passes in `sim.ts`.

Files:

- `before-*` and `after-*`: the same runs before and after the U66 change (quality for r1, r3, r3-aware, r3-jev, and r8; appetite and timing).
- `final-*`: the runs on the landed state.
- `ablation-gap-r3.txt`: a quality run at r3 with Jev off.
- `out-*.txt`: copies of the U40b outputs. All 22 are byte for byte the same as in `../u40b`.
- `gen/`: sed-made variants of `rhythm.ts`, as in U40b. Regenerate them if `rhythm.ts` changes.

The decisions are in `issues/decisions.tsv` (2026-10-12T06:53 and 07:06). U66 landed D2 (the rest has no kind factor), D3 (Jev decides when present), and D6 (one engagement rule). It removed the unused `Candidate.mentions`. D4 (drop the 20-hour gap) was declined: dropping it raised nudges 25 to 70 percent for the keen and hoarder personas.
