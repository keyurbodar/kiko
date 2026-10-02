# P9-03 Enforce bundle budgets in CI

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 4 |
| Depends on | P2-03, P0-12 |
| Difficulty | 2 of 5 |
| Area | infra |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p9-03-enforce-bundle-budgets-in-ci` |

## Verification

A pull request that imports CodeMirror into the chat route fails CI with a message that names the tier and the size.

## Task

**Goal.** Keep the tiers from growing unnoticed.

**Files.** `.github/workflows/ci.yml`, `scripts/bundle-budget.ts`.

**Build.**

- Build the client in CI and run the budget script.
- Print the tier table in the job summary.
- Fail when the shell passes 20 KB or any tier grows more than 5 percent without a budget change in the same pull request.

**Done when.** The job runs in under 2 minutes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
