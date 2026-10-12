# U40b attention simulation

A deterministic simulation of seven user personas over 8 weeks that runs the real `appetite.ts`, `attend.ts`, `rhythm.ts`, and `score` from `apps/server/src/initiative/attention/`. It measures whether each layer of the attention model changes nudge decisions. Jev is a rule-based stand-in (ASSUMPTION), and two human models are used (uniform and aware).

Run from this directory: `bun analyze.ts appetite` (also `rhythm`, `score`), `bun kindsplit.ts`, `bun signal.ts`, `bun timing.ts`. Environment: `HUMAN=aware`, `ROOMS=1|3|8`. `gen/` holds sed-made variants of `rhythm.ts` without pooling or smoothing; regenerate them if `rhythm.ts` changes. The `out-*.txt` files are the outputs behind the U40b decision (see `issues/decisions.tsv`).

U35 changed the engagement rule: a nudge is engaged only when the human answers it. `sim.ts` models that by default, with `RECALL` (default 1) as the share of meant replies the server recognises (ASSUMPTION) and a passing mention of the item counting too. `SIGNAL=room` brings back the rule before U35 and reproduces `out-*.txt` exactly. The `out-u35-*.txt` files are the outputs behind the U35 decision: `signal-room` and `signal-r1|r08|r06|r03` for `signal.ts`, `kindsplit-room|r08|r08-aware|r06` for `kindsplit.ts`, and `appetite-r3-r08` for `analyze.ts appetite`.
