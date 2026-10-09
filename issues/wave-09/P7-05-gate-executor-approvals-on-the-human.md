# P7-05 Gate Executor approvals on the human

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 9 |
| Depends on | P7-04, P7-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p7-05-gate-executor-approvals-on-the-human` |

## Verification

`bun yuki verify executor-approval` passes against a real account with one tool under a "require approval" policy: the run pauses, a model call to `executor_resume` is rejected, a human accept completes the action, and no answer for 4 minutes expires the card.

## Task

**Goal.** Make sure a model can never approve its own paused execution.

**Read first.** Architecture section 12.3.

**Files.** Create `apps/server/src/integrations/executor/approval.ts`.

**Build.**

- Detect a paused result by its `executionId` and create an approval through P7-02.
- Reject every model call to the resume tool in `beforeTool`.
- On a human decision, call `resume` from the host and steer the result into the run.
- Expire the card after 4 minutes and tell the agent to ask again.

**Done when.** The suite's rejection case passes with the model explicitly told to call resume.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
