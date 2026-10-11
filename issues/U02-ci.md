# U02 One fast check command, a parallel cached test runner, and a green baseline

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Port** 8802. **Timebox** 2 h.

## Goal
Make "is this tree good" one command that runs in parallel and never repeats work on an unchanged tree, so workers and the coordinator stop rerunning slow checks.

## Context
- `apps/server/scripts/test-each.ts` runs server test files serially, one `bun test` process each, because many files in one process collided on Miniflare ports. Read its header comment.
- The machine has 4 CPUs. Many agents share it.
- The only red test is `apps/server/test/routines.test.ts:90`, which asserts locale-formatted text ("oct 6 at 08:30" vs "oct 6, 08:30" from ICU). Make it assert the behavior without depending on the host ICU, or make the formatter deterministic, whichever is the real fix. Read the formatter first.
- `.github/workflows/ci.yml` exists. There is no git remote today, but keep CI correct.

## Build
1. Prototype first: run 3 server test files concurrently as separate processes and check whether they collide. Record the result in your report. Choose the default concurrency from that evidence.
2. `test-each.ts` gains a concurrency limit (default from the prototype, override `--jobs N`) and a result cache. The cache key for a test file is a hash of the file plus every tracked source file under `apps/server`, `core`, `packages`, and `bun.lock` (a coarse key is fine; correctness beats cleverness). A passing file with an unchanged key is skipped and printed as `cached`. Store the cache under `node_modules/.cache/yuki-tests/` so git never sees it. `--no-cache` forces a run.
3. `scripts/check.ts` runs typecheck, lint, `scripts/check-imports.ts`, `scripts/check-rules.ts` and `scripts/check-exports.ts` when those files exist, and all package tests, as parallel processes. It prints one line per step with pass or fail and time, then the failing output. Add `"check": "bun scripts/check.ts"` to the root package.json.
4. Update `ci.yml` to run `bun run check`.
5. Fix the locale test.

## Acceptance
- `bun run check` on a clean tree passes, and a second run is mostly cached and visibly faster. Paste both timings.
- Breaking one assertion in a server test makes `bun run check` fail on that file, then restore it.
- No new dependency.

## Verify
The commands above, run in your worktree.
