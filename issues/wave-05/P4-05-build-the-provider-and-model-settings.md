# P4-05 Build the provider and model settings

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 5 |
| Depends on | P4-03, P4-01, P2-07 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p4-05-build-the-provider-and-model-settings` |

## Verification

The `verify-yuki` providers feature: connect the test provider by pasting a key, see the last four characters, pick a model for a chat, and disconnect.

## Task

**Goal.** Let a user manage providers and choose models.

**Read first.** Product document, "Models and providers".

**Files.** Create `apps/web-solid/src/settings/providers.tsx`, `settings/model-picker.tsx`, and the settings route shell.

**Build.**

- A provider list generated from the catalog asset, with a connect dialog per provider and the methods the catalog lists for it.
- A model picker with search, context size, and price, usable from settings and from the chat top bar.
- Clear the key field on submit and never write the key to a store, to IndexedDB, or to the URL.
- Render the settings lists with `content-visibility: auto`.

**Done when.** The saved key is not in any store, log, or IndexedDB record after connecting.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
