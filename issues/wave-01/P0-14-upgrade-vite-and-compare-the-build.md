# P0-14 Upgrade Vite and compare the build

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-02 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-14-upgrade-vite-and-compare-the-build` |

## Verification

`bun run build` in `apps/web-solid` succeeds on Vite 8, tests pass, and the pull request description states the JS and CSS sizes before and after.

## Task

**Goal.** Move the client to the Rolldown-based Vite if the output is no larger.

**Read first.** Architecture section 19.3.

**Files.** `apps/web-solid/package.json`, `apps/web-solid/vite.config.ts`, `packages/ui/package.json`.

**Build.**

- Upgrade `vite`, `vite-plugin-solid`, and `@tailwindcss/vite` to versions that support Vite 8.
- Build before and after and record the sizes.
- If the build or the tests break in a way that takes more than this session, revert and record the reason in architecture section 19.3.

**Done when.** The client builds on one Vite version and section 19.3 has no ASSUMPTION label for it.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
