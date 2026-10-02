# P2-03 Build the HTML shell and split the bundle by tier

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-02 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-03-build-the-html-shell-and-split-the` |

## Verification

`bun scripts/bundle-budget.ts` passes: `index.html` is at most 20 KB, and the JS loaded before first paint of `/chat` is under the budget the task records in the script.

## Task

**Goal.** Paint something in the first response and load the rest in tiers.

**Read first.** Architecture section 19.3. `docs/research/frontend-refs.md`, the t3code shell notes.

**Files.** `apps/web-solid/index.html`, `apps/web-solid/vite.config.ts`. Create `apps/web-solid/src/bootstrap.ts` and `scripts/bundle-budget.ts`.

**Build.**

- Inline the critical CSS, the theme variables, and the app icon in `index.html`. Hold the shell until the first route's chunks have loaded, then swap.
- Load tier 2 from `bootstrap.ts` with a dynamic import. Mark tier 3 and tier 4 modules with `lazy()` and list them in the budget script.
- Reload once on `vite:preloadError`.
- Write `bundle-budget.ts` to read the build manifest and fail when a tier grows past its recorded size plus 5 percent.

**Done when.** The budget script prints one line per tier with its gzip size.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
