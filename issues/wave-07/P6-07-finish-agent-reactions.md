# P6-07 Finish agent reactions

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
| Branch | `yuki/p6-07-finish-agent-reactions` |

## Verification

`bun yuki verify reactions` passes: a reply of `[react:👍]` produces a reaction and no bubble, a second reaction by the same agent on the same message replaces the first, a tag with an emoji outside the allowlist is dropped, and no reaction starts a run.

## Task

**Goal.** Complete the cheap reaction path from the spec.

**Read first.** Architecture section 6.5.

**Files.** Create `apps/server/src/room/reactions.ts`. Edit `agent/outbox.ts` and `agent/prompt.ts`.

**Build.**

- Route reactions from the splitter to `room.react(slug, emoji, messageId?)`. Default the target to the last human message of the burst.
- Validate against an emoji allowlist and keep one reaction per agent per message.
- Add reactions on an agent's messages to that agent's next brief. Never deliver them on their own.
- Keep the one-line tag description in the system prompt.

**Done when.** Two fake agents that react to every message produce no runs.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
