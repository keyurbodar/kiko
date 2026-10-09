# P0-12 Add CI for typecheck, tests, and the plan check

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 2 of 5 |
| Area | infra |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p0-12-add-ci-for-typecheck-tests-and-the` |

## Verification

A pull request that breaks typecheck fails the workflow. `bun scripts/plan.ts --check` runs in the workflow and passes.

## Task

**Goal.** Catch broken types, broken tests, and a stale plan on every pull request.

**Files.** Create `.github/workflows/ci.yml`. Wire `ultracite-agents.md` standards to a real lint config (`biome.json`).

**Build.**

- Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, the lint check, and `bun scripts/plan.ts --check`.
- Cache the Bun install directory.
- Do not add a job that needs a model key.

**Done when.** The workflow passes on `main` and fails on a deliberately broken branch.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
