# P9-01 Enforce per-user limits

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 9 |
| Depends on | P4-02, P6-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p9-01-enforce-per-user-limits` |

## Verification

`bun yuki verify limits` passes: with the turn limit set to 2, the third burst gets a `limit` event and no run, and raising the limit record lets the next burst through.

## Task

**Goal.** Make plans a matter of changing one record.

**Read first.** Architecture section 17.7.

**Files.** Create `apps/server/src/user/limits.ts`. Edit `room/burst.ts` and `agent/host.ts`.

**Build.**

- One `limits` record with turns per day, autonomous runs per day, storage bytes, members per room, and a plan name.
- Return it from `turnContext`. Count turns in `UserDO` with a per-UTC-day counter.
- Enforce in the room before delivery. Show a `limit` event with the reset time.
- Add an admin-only CLI command that sets a user's limits.

**Done when.** No limit number appears outside `limits.ts` and the record.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
