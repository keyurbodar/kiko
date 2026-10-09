# P2-14 Audit the frontend verification skill

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 8 |
| Depends on | P2-08, P2-09, P2-04 |
| Difficulty | 3 of 5 |
| Area | docs |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-14-audit-the-frontend-verification-skill` |

## Verification

The `maintain-verification-skill` run ends with every feature in `.cursor/skills/verify-yuki/features/` either proven in a live session or corrected, and its report is in the pull request.

## Task

**Goal.** Bring the existing verify skill in line with the routed, live app.

**Read first.** `.cursor/skills/verify-yuki/SKILL.md`.

**Files.** `.cursor/skills/verify-yuki/`.

**Build.**

- Run the `maintain-verification-skill` skill.
- Add feature files for routes, the tab strip, the sidebar, live chat, and offline send.
- Remove steps that depend on the deleted fixture store.

**Done when.** The skill's map lists every feature this phase added.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
