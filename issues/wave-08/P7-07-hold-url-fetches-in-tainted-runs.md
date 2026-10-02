# P7-07 Hold URL fetches in tainted runs

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 8 |
| Depends on | P7-01, P8-02 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p7-07-hold-url-fetches-in-tainted-runs` |

## Verification

`bun kiko verify injection --no-model` passes the new case: a tainted run posts a bubble with a URL that no human message contained, and the room requests no preview for it.

## Task

**Goal.** Close the path where an injected instruction sends data out inside a URL.

**Read first.** Architecture section 16.4.

**Files.** Edit `apps/server/src/room/deliver.ts` and the preview trigger in `room/log.ts`.

**Build.**

- Record on each agent message whether its run was tainted.
- Before requesting a preview or an image for a URL in a tainted message, check that the same URL appears in a human message in the room.
- Send the client a flag so the link renders with no automatic preview.

**Done when.** An untainted run's links still get previews.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
