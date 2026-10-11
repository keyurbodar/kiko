# U40b attention simulation

A deterministic simulation of seven user personas over 8 weeks that runs the real `appetite.ts`, `attend.ts`, `rhythm.ts`, and `score` from `apps/server/src/initiative/attention/`. It measures whether each layer of the attention model changes nudge decisions. Jev is a rule-based stand-in (ASSUMPTION), and two human models are used (uniform and aware).

Run from this directory: `bun analyze.ts appetite` (also `rhythm`, `score`), `bun kindsplit.ts`, `bun signal.ts`, `bun timing.ts`, `bun score-grid.ts`. Environment: `HUMAN=aware`, `ROOMS=1|3|8`. `gen/` holds sed-made variants of `rhythm.ts` without pooling or smoothing; regenerate them if `rhythm.ts` changes. The `out-*.txt` files are the outputs behind the U40b decision (see `issues/decisions.tsv`).
