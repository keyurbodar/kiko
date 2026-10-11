# Standing orders

Every worker reads this file in full before any work. AGENTS.md at the repo root overrides anything here.

You can ask the coordinator. If you reach a real design fork that you cannot settle by reading code or running something cheap, stop, commit any safe partial work, and end with `STATUS: blocked` and a `QUESTION` section that states the fork, the options, and your recommendation. The coordinator answers and starts your next round with your branch intact. Do not guess on a fork that changes behavior a user sees.

1. Read `AGENTS.md` first. Its non-negotiables and "ways to hurt yourself" are hard rules.
2. Work only inside the worktree path named in your brief. Run every command there (`cd <worktree> && ...`) and use absolute paths. Never edit files under `/home/keyur/kiko` itself, which is the coordinator's checkout of `main`.
3. Never run `pkill` or `killall`. If you start `wrangler dev`, pick a free port (`--port <n>` from your brief), record its PID, and stop only that PID before you finish.
4. Never rebase, merge, reset another branch, push, or force anything. Commit on your own branch only. The coordinator lands branches on `main`.
5. Write only the paths in your brief's SCOPE, plus your own issue file `issues/<ID>.md`, where you append a `## Report` section and, if you found anything the plan should know, a `## Discoveries` section. Never edit `issues/PLAN.md`, `issues/ledger.tsv`, `issues/decisions.tsv`, `issues/STANDING.md`, or another unit's issue file.
6. Reproduce before you fix. Every behavior change ships with a test that fails on the old code and passes on the new code. Say in your report that you saw it fail, with the output line.
7. Make the smallest change that fully solves the problem. Add an abstraction only when it deletes more than it adds. No speculative guards, options, or flags. Delete what your change makes dead.
8. Follow the surrounding code's idiom. The repo uses Effect v4 where it already uses Effect. Do not introduce Effect into plain code, and do not strip it from code that uses it.
9. Verify in proportion to risk. Lint only backend paths: `bunx biome check apps/server core apps/cli scripts` (the frontend has known lint errors outside this program). Always: `bun run typecheck` for the packages you touched, the test files that cover your change, and `bun scripts/check-imports.ts`. Run a `bun yuki verify <suite>` only when your change alters behavior that suite covers. Once `scripts/check.ts` exists on `main`, prefer it.
10. Server tests: `bun run --cwd apps/server test -- <file-substring>` runs selected files, one workerd per file. Do not run the whole server suite unless your brief asks; the machine has 4 CPUs shared by many workers.
11. Comments only for a non-obvious why. Interface strings are sentence case. No long dashes in docs or comments.
12. Never print, log, or commit a key. Dev keys live in `apps/server/.dev.vars` (a symlink); load them with `set -a; . apps/server/.dev.vars; set +a` when a model suite needs them.
13. No new dependency unless the brief allows it.
14. Commit message: plain sentences that say what changed and why. End with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One unit may be several commits; leave the branch clean (`git status --short` empty).
15. Timebox. When your brief's timebox expires, commit what works, mark what does not in your report, and stop.
16. Final message is your report, in this shape: `STATUS` (done, partial, blocked), `QUESTION` (only when blocked), `BRANCH`, `HEAD` (full SHA), `CHANGED` (files, one line each), `VERIFIED` (each command you ran and its result line), `FAILED-BEFORE` (the test that failed on old code), `DEVIATIONS`, `FOLLOW-UPS`.
