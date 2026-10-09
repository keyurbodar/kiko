# P6-02 Build the workspace tables and tools

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 8 |
| Depends on | P6-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p6-02-build-the-workspace-tables-and-tools` |

## Verification

`bun yuki verify workspace` passes with fake agents: task B depends on task A, B's owner is not woken while A is open, and marking A `done` delivers exactly one `task_unblocked` envelope to B's owner.

## Task

**Goal.** Give a team a task board, an activity log, and shared notes.

**Read first.** Architecture sections 4.3, 7.5, and 7.6.

**Files.** Create `apps/server/src/room/workspace.ts` and `apps/server/src/agent/extensions/workspace.ts`. Edit `room/schema.ts`.

**Build.**

- Tables `ws_tasks`, `ws_task_deps`, `ws_activity`, and `ws_notes`. Put them behind a `Workspace` interface.
- Tools `claim_task`, `update_task`, `post_update`, `write_note`, and for the lead `create_task`.
- Enforce the status set and reject a dependency cycle.
- On `done`, find tasks whose dependencies are all done and deliver `task_unblocked` with the id `unblocked:<taskId>`.
- Emit a room event for every board change, so the client stays live.

**Done when.** `claim_task` on a task another agent owns fails with a message that names the owner.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
