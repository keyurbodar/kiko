# P4-03 Serve the model catalog as a static asset

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 2 |
| Depends on | P0-08 |
| Difficulty | 2 of 5 |
| Area | infra |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p4-03-serve-the-model-catalog-as-a-static` |

## Verification

`bun run build` in `apps/web-solid` emits `models-<hash>.json`, and `bun test scripts/build-catalog.test.ts` checks that every entry has provider, id, context window, and pricing.

## Task

**Goal.** Give the settings screen the `pi-ai` catalog without shipping it in the app bundle.

**Read first.** Architecture section 11.5. `docs/research/experiment-5-bundle-and-catalog.md`.

**Files.** Create `scripts/build-catalog.ts` and a Vite plugin entry in `apps/web-solid/vite.config.ts`.

**Build.**

- Read providers and models from `pi-ai` at build time and write one hashed JSON file with the fields the interface needs.
- Include for each provider which connect methods `pi-ai` offers (API key, device code, paste code).
- Add nothing by hand. A provider that `pi-ai` adds appears after a version bump and a rebuild.

**Done when.** The file is immutable-cached and loaded only by the settings route.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
