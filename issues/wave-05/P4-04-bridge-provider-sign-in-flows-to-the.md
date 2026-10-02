# P4-04 Bridge provider sign-in flows to the browser

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 5 |
| Depends on | P4-01, P0-08 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p4-04-bridge-provider-sign-in-flows-to-the` |

## Verification

`bun kiko verify provider-login --fake` passes with a fake provider that uses both `notify` and `prompt`. One real device-code flow is shown working by hand in the pull request.

## Task

**Goal.** Let a user sign in to a provider with the flow `pi-ai` offers, from the browser.

**Read first.** Architecture section 11.4. `docs/research/pi-packages.md`, section 1.

**Files.** Create `apps/server/src/user/provider-login.ts`. Edit the user socket.

**Build.**

- Run `Models.login(interaction)` inside `UserDO`. Send `notify` events to the client as `login.notify` frames and resolve `prompt` from a `login.answer` frame.
- Time out a login after 10 minutes and clean up.
- Enable only the flows that P0-08 showed can import on Workers.
- Put subscription sign-in behind the `PROVIDER_OAUTH` flag, off by default, as section 11.4 explains.

**Done when.** A login that the user abandons leaves no pending state in `UserDO`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
