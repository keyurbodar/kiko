# P1-02 Add accounts with Better Auth and D1

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-02-add-accounts-with-better-auth-and-d1` |

## Verification

`bun kiko login --dev` stores a session and `bun kiko whoami` prints the user id. A request to `/api/me` without a cookie returns 401.

## Task

**Goal.** Give kiko user accounts and sessions.

**Read first.** Architecture section 10. `docs/research/cloudflare.md`, the Better Auth section.

**Files.** Create `apps/server/src/auth/auth.ts`, `apps/server/src/auth/dev-session.ts`, `apps/server/migrations/`, `apps/cli/src/commands/login.ts`.

**Build.**

- Run `bunx auth init` in a scratch directory for the reference config, then write the Workers version by hand with `betterAuth({ database: env.AUTH_DB })`, created per request.
- Configure Google and GitHub sign-in and turn on the session cookie cache.
- Generate the schema as SQL and apply it with `wrangler d1 migrations apply`.
- Add a dev-only route that mints a session for a named test user. Compile it out of production with a build-time flag and return 404 if the flag is off.
- Add `login --dev` and `whoami` to the CLI.

**Done when.** The dev route does not exist in a production build, and a test proves it.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
