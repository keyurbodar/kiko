# P0-02 Clean the frontend baseline

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-02-clean-the-frontend-baseline` |

## Verification

`bun run typecheck` and `bun test` pass in `apps/web-solid` and `packages/ui`. `bun run build` output contains no `chat-harness` file.

## Task

**Goal.** Remove dead weight from the client before anyone builds on it.

**Read first.** `docs/research/frontend-current.md`, sections 1, 7, 8, and 9.

**Files.** `apps/web-solid/package.json`, `apps/web-solid/vite.config.ts`, `apps/web-solid/OWNERSHIP.md`, `packages/ui/package.json`, `apps/web-solid/dist/`.

**Build.**

- Remove unused dependencies: `class-variance-authority` and the `blobatar` core in the app, `@tanstack/solid-query`, `@thisbeyond/solid-dnd`, `culori`, `@solid-primitives/bounds`, and `@solid-primitives/media` in `packages/ui`. Keep `@solidjs/router` and `@solidjs/meta`, which P2-02 uses.
- Keep `src/chat/harness.html` for development and drop it from the production build inputs.
- Delete the stale `dist/` directory. Git already ignores it.
- Delete `OWNERSHIP.md`. Fix `src/composer/ATTRIBUTION.md` so it names only files that exist.
- Remove one of the two scroll-to-latest controls.

**Done when.** The checks pass and `git grep` finds no import of a removed package.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
