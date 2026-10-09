# P6-01 Build members, recipients, and the workspace brief

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 7 |
| Depends on | P1-12 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p6-01-build-members-recipients-and-the-workspace-brief` |

## Verification

`bun yuki verify team-routing` passes with fake agents: an untagged message reaches only the lead, `@ada` reaches only ada, `@all` reaches everyone, and ada's next delivery carries the messages she missed.

## Task

**Goal.** Make a room hold several agents and decide who receives each human message.

**Read first.** Architecture sections 7.1, 7.2, and 7.4.

**Files.** Create `apps/server/src/room/members.ts`, `room/recipients.ts`, `room/brief.ts`, and `apps/server/test/fake-agent.ts`. Edit `room/deliver.ts`.

**Build.**

- A `members(slug, role, model, lead, status, current_task, last_delivered_seq)` table. A room has exactly one lead.
- `resolveRecipients(message, members)` as a pure function over the table in section 7.2, with tests.
- `buildBrief(member)` returns the goal, the member list with status, the member's tasks, and room messages and reactions since `last_delivered_seq`, capped at 30.
- Add `addMember`, `removeMember`, and `renameMember` to the room socket, with the member limit of 8.
- Agents report status changes to the room. The room stores the latest status only.

**Done when.** An agent that was not addressed runs no model call.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
