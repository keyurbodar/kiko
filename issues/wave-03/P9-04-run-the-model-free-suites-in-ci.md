# P9-04 Run the model-free suites in CI

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 3 |
| Depends on | P1-09, P0-12 |
| Difficulty | 3 of 5 |
| Area | infra |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p9-04-run-the-model-free-suites-in-ci` |

## Verification

CI starts `wrangler dev`, runs `bun yuki verify --no-model`, and fails when a suite fails. A manual workflow runs the model suites with `OPENCODE_API_KEY` from repository secrets.

## Task

**Goal.** Run real backend verification on every pull request, without spending tokens.

**Files.** `.github/workflows/ci.yml`. Create `.github/workflows/model-suites.yml`.

**Build.**

- Start the dev server in the job, wait for `/api/health`, and run the suites.
- Upload the last frames of a failing suite as an artifact.
- Add the manual workflow for model suites. Never print the key.

**Done when.** A pull request from a fork runs the model-free job and cannot read the secret.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
