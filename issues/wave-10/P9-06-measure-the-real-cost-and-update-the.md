# P9-06 Measure the real cost and update the documents

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 10 |
| Depends on | P6-04, P7-04, P0-06 |
| Difficulty | 2 of 5 |
| Area | docs |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p9-06-measure-the-real-cost-and-update-the` |

## Verification

`docs/research/turn-cost-final.md` holds the output of `bun kiko measure turn` for a one-agent turn, a three-agent team turn, and a turn with one Executor call, and architecture section 17 cites it.

## Task

**Goal.** Replace every remaining estimate with a measurement.

**Read first.** Architecture section 17.

**Files.** `docs/architecture.md`, `docs/overview.md`. Create the result file.

**Build.**

- Measure the three turn shapes on a deployed preview.
- Update the Free and Paid tables and the cost per user.
- Remove ASSUMPTION and UNVERIFIED labels that the plan has settled, and list the ones that remain.

**Done when.** Section 17 contains no number labeled as an estimate.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
