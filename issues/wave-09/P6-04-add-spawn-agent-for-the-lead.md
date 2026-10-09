# P6-04 Add spawn_agent for the lead

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 9 |
| Depends on | P6-02, P6-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p6-04-add-spawn-agent-for-the-lead` |

## Verification

`bun yuki verify spawn-agent` passes with the test model: asked to "get a researcher to list three sources", the lead adds a member, the member posts a result, and the task ends `done`.

## Task

**Goal.** Let the lead grow the team.

**Read first.** Architecture section 7.5.

**Files.** Edit `apps/server/src/agent/extensions/messaging.ts` and `apps/server/src/agent/factory.ts`.

**Build.**

- `spawn_agent(slug, role, task)` adds a member, creates its first task, and delivers the task as an agent message.
- Only the lead's agent selects this tool. The factory decides that from the member row.
- A spawned agent starts with the lead's model unless the lead names another connected one.
- Fail with a clear error at the member limit or on a duplicate slug.

**Done when.** A non-lead agent has no `spawn_agent` in its tool list.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
