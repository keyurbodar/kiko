# P0-08 Check bundle size, the model catalog, and provider imports

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p0-08-check-bundle-size-the-model-catalog-and` |

## Verification

`docs/research/experiment-5-bundle-and-catalog.md` lists the Worker bundle size from `wrangler deploy --dry-run --outdir`, the startup time, the catalog location, the test model id, and one line per provider sign-in module with "imports" or "fails".

## Task

**Goal.** Settle experiments 5, 6, and 7.

**Read first.** Architecture sections 11.4, 11.5, and 11.6. `docs/research/pi-packages.md`, section 1.

**Files.** Create `apps/server/src/experiments/imports.ts` and the result file. Edit architecture section 11.

**Build.**

- Build the Worker with `pi-ai`, `pi-durable`, and TypeBox imported and record the size and startup time.
- Inspect the published `pi-ai` package for the generated model catalog. If it is missing, record how pi's `generate-models.ts` can run at build time.
- Find the catalog id for "deepseek v4.1 flash" under the `opencode-go` provider.
- Import each provider's OAuth module under `wrangler dev` and record whether it loads.

**Done when.** Architecture section 11 has no UNVERIFIED label left for these three items.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
