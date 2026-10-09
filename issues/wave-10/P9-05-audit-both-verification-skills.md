# P9-05 Audit both verification skills

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 10 |
| Depends on | P6-09, P7-05, P8-08, P5-09 |
| Difficulty | 3 of 5 |
| Area | docs |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p9-05-audit-both-verification-skills` |

## Verification

The `maintain-verification-skill` run drives every feature in both skills in one live session and ends with at most one pull request of proven corrections.

## Task

**Goal.** Make sure the verification skills still describe the app that exists.

**Files.** `.cursor/skills/verify-yuki/` and `.cursor/skills/verify-yuki-server/`.

**Build.**

- Run the `maintain-verification-skill` skill on both.
- Remove features that no longer exist and add the ones that later phases built without a map entry.
- Check that every `Verify` line in `docs/phases/` names a suite or a feature that exists.

**Done when.** `bun yuki verify --list` and the server skill's map name the same suites.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
