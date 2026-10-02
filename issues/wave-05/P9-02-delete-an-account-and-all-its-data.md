# P9-02 Delete an account and all its data

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 5 |
| Depends on | P1-05, P8-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p9-02-delete-an-account-and-all-its-data` |

## Verification

`bun kiko verify account-delete` passes: after deletion, the user's rooms, agents, files, credentials, and auth rows are gone, and a second run of the same job succeeds with nothing to do.

## Task

**Goal.** Remove everything a user owns, reliably.

**Read first.** Architecture section 7.9.

**Files.** Create `apps/server/src/jobs/delete-account.ts` and a route under `apps/server/src/auth/`.

**Build.**

- `UserDO` lists its rooms. Each room lists its agents and files.
- Enqueue one job per room. A job deletes the R2 objects, calls `deleteAll` on each agent and on the room, and reports back.
- Delete the user object's storage and the D1 rows last.
- Require a recent sign-in and a typed confirmation in the client.

**Done when.** A job that fails halfway completes on retry.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
