# U37 initiative-loops asserts the loop, not the model's wording

**Model** DeepSeek V4.1 Flash high. **Wave** 5. **Timebox** 30 min.

`apps/cli/src/verify/suites/initiative-loops.ts` near line 85 waits for a tentative loop by matching the model's free text with `/start running/i`. On the final run the engine was right (`L3 open goal/tentative owner=human via nap: considers resuming running someday`) but the wording missed, so the suite failed once and passed on rerun (`issues/U40c-final.md`). Match on the loop's structure: open, `certainty` tentative, `owner` human, and a loose topic match on `running`. Keep the suite's meaning. Do not touch product code.

Acceptance: `bun run --cwd apps/cli typecheck`, `bun run check` pass. If you can, run `bun yuki verify initiative-loops --url http://localhost:8837` twice on your own server with the dev keys and paste both results.

## Report

STATUS: done

BRANCH: s/u37-loops-assert

HEAD: 844d8fa17eeca5bf94ef8dc00f21cf40b8cd366e (change commit; the report commit follows it)

CHANGED:
- `apps/cli/src/verify/suites/initiative-loops.ts`: the running-loop poll now matches the loop's structure (`status === "open"`, `certainty === "tentative"`, `owner === "human"`) plus a loose `/running/i` topic instead of the model's `/start running/i` wording, and the certainty throw the poll now enforces is removed.

VERIFIED:
- `bun run --cwd apps/cli typecheck`: `tsc --noEmit`, no errors.
- `bun run check`: `all 10 steps passed` (the frontend lint step is labeled `not gating`).
- `bun yuki verify initiative-loops --url http://localhost:8837` (my server, dev keys, port 8837):
  - run 1: `pass initiative-loops (67804ms)`; both arms matched structurally, `maybe -> L3 open goal/tentative owner=human via jev: Maybe I'll start running again at some point.` and no-judge `maybe -> L3 open intention/tentative owner=human via nap: restart running at some point`.
  - run 2: `pass initiative-loops (119154ms)`; no-judge `maybe -> L4 open goal/tentative owner=human via nap: start running again at some point`, jev `maybe -> L3 open intention/tentative owner=human via jev: Maybe I'll start running again at some point.`
- Predicate check on the exact recorded wording: `bun -e '...'` printed `old predicate matches: false` / `new predicate matches: true` for `considers resuming running someday`.

FAILED-BEFORE: not reproduced live, since the failure is a wording-dependent flake. The recorded failure is `issues/U40c-final.md`: loops showed `L3 open goal/tentative owner=human via nap: considers resuming running someday` and the suite ended with `timed out after 30s waiting for a tentative loop about running`. On that same wording the old predicate `/start running/i` returns `false` and the new one returns `true` (output above). The structure the new poll requires (open, tentative, human) was already satisfied by that loop.

DEVIATIONS: none.

FOLLOW-UPS: none.

## Discoveries

- The old `/start running/i` regex also matched the no-judge arm's `restart running` wording, so the flake only surfaced on phrasings without `start` immediately before `running`. The structural match removes the dependence on wording entirely.
- Both arms (no judge and Jev) open the "maybe running" loop as `tentative` owned by `human`, so matching on structure is stable across both.
