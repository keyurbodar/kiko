# P6-05 Add the subagent tool

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 7 |
| Depends on | P1-12 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p6-05-add-the-subagent-tool` |

## Verification

`bun kiko verify subagent` passes with the test model: the agent delegates a task, the answer returns as a tool result, and restarting the server mid-child yields one child conversation, not two.

## Task

**Goal.** Let any agent delegate a bounded task to a private child conversation.

**Read first.** Architecture section 8. `refs/pi/packages/durable/README.md`, "Abort and Subagents", and `test/examples/22-subagent-foreground.ts`.

**Files.** Create `apps/server/src/agent/extensions/subagent.ts`.

**Build.**

- Write `spawn_subagent(task)` from the README pattern, with `replay: "safe"` and `requestId: "subagent:<taskId>"`.
- Remove the `Subagent` and messaging extensions from the child, so depth is 1.
- Publish the child conversation id with `api.details`, so P3-15 can show it as activity.

**Done when.** The extension file is under 60 lines.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
