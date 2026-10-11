# U37 initiative-loops asserts the loop, not the model's wording

**Model** DeepSeek V4.1 Flash high. **Wave** 5. **Timebox** 30 min.

`apps/cli/src/verify/suites/initiative-loops.ts` near line 85 waits for a tentative loop by matching the model's free text with `/start running/i`. On the final run the engine was right (`L3 open goal/tentative owner=human via nap: considers resuming running someday`) but the wording missed, so the suite failed once and passed on rerun (`issues/U40c-final.md`). Match on the loop's structure: open, `certainty` tentative, `owner` human, and a loose topic match on `running`. Keep the suite's meaning. Do not touch product code.

Acceptance: `bun run --cwd apps/cli typecheck`, `bun run check` pass. If you can, run `bun yuki verify initiative-loops --url http://localhost:8837` twice on your own server with the dev keys and paste both results.
