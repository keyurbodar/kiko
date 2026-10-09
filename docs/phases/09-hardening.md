# Phase 9. Hardening and launch

This phase enforces limits, keeps performance from regressing, measures the real cost, and prepares the production deploy. The deploy itself needs the owner's approval.

## Tasks

### P9-01 Enforce per-user limits

`deps: P4-02, P6-03` `difficulty: 3` `area: backend`

**Verify.** `bun yuki verify limits` passes: with the turn limit set to 2, the third burst gets a `limit` event and no run, and raising the limit record lets the next burst through.

**Goal.** Make plans a matter of changing one record.

**Read first.** Architecture section 17.7.

**Files.** Create `apps/server/src/user/limits.ts`. Edit `room/burst.ts` and `agent/host.ts`.

**Build.**

- One `limits` record with turns per day, autonomous runs per day, storage bytes, members per room, and a plan name.
- Return it from `turnContext`. Count turns in `UserDO` with a per-UTC-day counter.
- Enforce in the room before delivery. Show a `limit` event with the reset time.
- Add an admin-only CLI command that sets a user's limits.

**Done when.** No limit number appears outside `limits.ts` and the record.

### P9-02 Delete an account and all its data

`deps: P1-05, P8-03` `difficulty: 3` `area: backend`

**Verify.** `bun yuki verify account-delete` passes: after deletion, the user's rooms, agents, files, credentials, and auth rows are gone, and a second run of the same job succeeds with nothing to do.

**Goal.** Remove everything a user owns, reliably.

**Read first.** Architecture section 7.9.

**Files.** Create `apps/server/src/jobs/delete-account.ts` and a route under `apps/server/src/auth/`.

**Build.**

- `UserDO` lists its rooms. Each room lists its agents and files.
- Enqueue one job per room. A job deletes the R2 objects, calls `deleteAll` on each agent and on the room, and reports back.
- Delete the user object's storage and the D1 rows last.
- Require a recent sign-in and a typed confirmation in the client.

**Done when.** A job that fails halfway completes on retry.

### P9-03 Enforce bundle budgets in CI

`deps: P2-03, P0-12` `difficulty: 2` `area: infra`

**Verify.** A pull request that imports CodeMirror into the chat route fails CI with a message that names the tier and the size.

**Goal.** Keep the tiers from growing unnoticed.

**Files.** `.github/workflows/ci.yml`, `scripts/bundle-budget.ts`.

**Build.**

- Build the client in CI and run the budget script.
- Print the tier table in the job summary.
- Fail when the shell passes 20 KB or any tier grows more than 5 percent without a budget change in the same pull request.

**Done when.** The job runs in under 2 minutes.

### P9-04 Run the model-free suites in CI

`deps: P1-09, P0-12` `difficulty: 3` `area: infra`

**Verify.** CI starts `wrangler dev`, runs `bun yuki verify --no-model`, and fails when a suite fails. A manual workflow runs the model suites with `OPENCODE_API_KEY` from repository secrets.

**Goal.** Run real backend verification on every pull request, without spending tokens.

**Files.** `.github/workflows/ci.yml`. Create `.github/workflows/model-suites.yml`.

**Build.**

- Start the dev server in the job, wait for `/api/health`, and run the suites.
- Upload the last frames of a failing suite as an artifact.
- Add the manual workflow for model suites. Never print the key.

**Done when.** A pull request from a fork runs the model-free job and cannot read the secret.

### P9-05 Audit both verification skills

`deps: P6-09, P7-05, P8-08, P5-09` `difficulty: 3` `area: docs`

**Verify.** The `maintain-verification-skill` run drives every feature in both skills in one live session and ends with at most one pull request of proven corrections.

**Goal.** Make sure the verification skills still describe the app that exists.

**Files.** `.cursor/skills/verify-yuki/` and `.cursor/skills/verify-yuki-server/`.

**Build.**

- Run the `maintain-verification-skill` skill on both.
- Remove features that no longer exist and add the ones that later phases built without a map entry.
- Check that every `Verify` line in `docs/phases/` names a suite or a feature that exists.

**Done when.** `bun yuki verify --list` and the server skill's map name the same suites.

### P9-06 Measure the real cost and update the documents

`deps: P6-04, P7-04, P0-06` `difficulty: 2` `area: docs`

**Verify.** `docs/research/turn-cost-final.md` holds the output of `bun yuki measure turn` for a one-agent turn, a three-agent team turn, and a turn with one Executor call, and architecture section 17 cites it.

**Goal.** Replace every remaining estimate with a measurement.

**Read first.** Architecture section 17.

**Files.** `docs/architecture.md`, `docs/overview.md`. Create the result file.

**Build.**

- Measure the three turn shapes on a deployed preview.
- Update the Free and Paid tables and the cost per user.
- Remove ASSUMPTION and UNVERIFIED labels that the plan has settled, and list the ones that remain.

**Done when.** Section 17 contains no number labeled as an estimate.

### P9-07 Prepare the production deploy

`deps: P9-01, P9-02, P9-04` `difficulty: 3` `area: infra` `human: yes`

**Verify.** `bunx wrangler deploy --dry-run --env production` succeeds, `docs/deploy.md` lists every secret and binding, and `bun yuki verify --no-model --url <preview>` passes against a deployed preview.

**Goal.** Make production one approved command away.

**Files.** `apps/server/wrangler.jsonc`. Create `docs/deploy.md`.

**Build.**

- Add a `production` environment with its own D1, R2, KV, and queue.
- Document the secrets (`CREDENTIALS_KEK`, `BETTER_AUTH_SECRET`, the OAuth client secrets) and how to rotate `CREDENTIALS_KEK`.
- Document applying D1 migrations and the rollback steps.
- Deploy a preview and run the suites against it.
- Stop before the production deploy. The owner runs it or approves it in chat.

**Done when.** A person who has never seen the repository can deploy from `docs/deploy.md`.
