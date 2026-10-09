# P2-12 Mount toasts and i18n, and lowercase every string

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-02 |
| Difficulty | 1 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-12-mount-toasts-and-i18n-and-lowercase-every` |

## Verification

Copy a message in the app and see the toast. `bun test apps/web-solid/src/copy.test.ts` passes, which fails on any interface string with an uppercase letter.

## Task

**Goal.** Fix two mounting bugs and apply the lowercase voice.

**Read first.** `docs/research/frontend-current.md`, section 9.

**Files.** `apps/web-solid/src/app/shell.tsx`, the i18n dictionaries in `packages/ui/src/i18n/`.

**Build.**

- Mount `ToastV2.Region` and `I18nProvider` in the shell.
- Move every interface string into the dictionary and make each one lowercase. Proper nouns that a user typed stay as typed.
- Add the test that scans the dictionary.

**Done when.** The copy toast appears and the test passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
