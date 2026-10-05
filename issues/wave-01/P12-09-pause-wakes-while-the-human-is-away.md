# P12-09 Pause wakes while the human is away

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 1 |
| Depends on | P12-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-09-pause-wakes-while-the-human-is-away` |

## Verification

`bun kiko verify away` passes: with `last_seen` 8 days old, a due routine and a stall nudge start no run and are recorded `held`; the kiko chat gets one line; a socket hello resumes the next wake.

## Task

**Goal.** A user who stopped using kiko stops spending on it, as Grok pauses routines after a long absence.

**Read first.** Architecture section 25.5.

**Files.** `apps/server/src/user/user-do.ts`, `user/kiko-chat.ts`, `room/deliver.ts`.

**Build.**

- Stamp `last_seen` on each user socket hello, at most once an hour.
- `UserDO.takeRun` refuses while away. The line posts once per away period.

**Done when.** The suite passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
