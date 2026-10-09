# P9-07 Prepare the production deploy

| Field | Value |
| --- | --- |
| Phase | 9 (`docs/phases/09-hardening.md`) |
| Wave | 10 |
| Depends on | P9-01, P9-02, P9-04 |
| Difficulty | 3 of 5 |
| Area | infra |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | yes |
| Branch | `yuki/p9-07-prepare-the-production-deploy` |

## Verification

`bunx wrangler deploy --dry-run --env production` succeeds, `docs/deploy.md` lists every secret and binding, and `bun yuki verify --no-model --url <preview>` passes against a deployed preview.

## Task

**Goal.** Make production one approved command away.

**Files.** `apps/server/wrangler.jsonc`. Create `docs/deploy.md`.

**Build.**

- Add a `production` environment with its own D1, R2, KV, and queue.
- Document the secrets (`CREDENTIALS_KEK`, `BETTER_AUTH_SECRET`, the OAuth client secrets) and how to rotate `CREDENTIALS_KEK`.
- Document applying D1 migrations and the rollback steps.
- Deploy a preview and run the suites against it.
- Stop before the production deploy. The owner runs it or approves it in chat.

**Done when.** A person who has never seen the repository can deploy from `docs/deploy.md`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/09-hardening.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
