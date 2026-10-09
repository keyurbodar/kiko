# P5-03 Build the daily tidy job

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 9 |
| Depends on | P5-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-03-build-the-daily-tidy-job` |

## Verification

`bun yuki verify memory-tidy` passes with the test model: seed two duplicate records and one wrong fact with a correction, run `yuki memory tidy --now`, and see one merged record, a dated correction, and the old bodies in history.

## Task

**Goal.** Keep memory small and correct without the main agent doing the work.

**Read first.** Architecture section 13.3.

**Files.** Create `apps/server/src/user/tidy.ts` and `apps/cli/src/commands/memory.ts`.

**Build.**

- Set a daily wakeup in the user's timezone. Skip the run when nothing changed since the last one or when the user has no provider.
- Run the job in a dedicated `AgentDO` named `agent:<userId>:system:tidy`, so `UserDO` holds no harness. Use the user's default model and limit its tools to memory. `system` is a reserved room id that no client can create.
- Merge duplicates, shorten, generalize repeated examples, and replace wrong facts with dated corrections. Update the profile with communication-style traits.
- Archive records that are not pinned and unused for 90 days.
- Never promote a fact whose provenance is tainted into the profile.

**Done when.** The job is idempotent: a second run right after the first changes nothing.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
