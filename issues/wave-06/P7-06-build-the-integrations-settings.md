# P7-06 Build the integrations settings

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 6 |
| Depends on | P7-03, P4-05 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p7-06-build-the-integrations-settings` |

## Verification

The `verify-kiko` integrations feature against a fake user socket: connect shows the sign-in step, the connected state shows the organization name and the tool count, and disconnect returns to the empty state.

## Task

**Goal.** Let a user connect and disconnect Executor.

**Files.** Create `apps/web-solid/src/settings/integrations.tsx`.

**Build.**

- An empty state that explains Executor in two lines and links to it.
- Connect with OAuth, with a paste-key fallback.
- A connected state with the tool list as returned by the server, and the mode option from architecture section 12.2.
- Disconnect, with a confirm.

**Done when.** The screen contains no hardcoded tool or integration name.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
