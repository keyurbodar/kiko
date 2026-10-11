# U30 Platform edges: body size, queues, deploy env

**Model** Haiku 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 60 min.

## Findings (evidence in `issues/audit/platform.json`)
1. `apps/server/src/router.ts:35-37` clones and reads every JSON body before checking the 1 MB cap. Check `content-length` first and refuse early; still enforce the cap when the header is missing.
2. `apps/server/wrangler.jsonc` sets no `max_batch_size` on `kiko-jobs`; each deletion job makes about 9 plus agents subrequests and the consumer runs a batch in one invocation. Set `max_batch_size: 1` (confirm the key name in Cloudflare's queue docs).
3. `kiko-jobs-dead` has no dead-letter queue of its own, so a deletion that keeps failing is dropped after its retries, against the comment that deletion never gives up. Check the docs for what is allowed, then do the smallest correct thing and keep the comment true.
4. `apps/server/package.json` `deploy:dry` and any deploy script take `NODE_ENV` from the shell; wrangler bakes it into the bundle. Make deploy scripts set `NODE_ENV=production`.

## Scope
`apps/server/src/router.ts`, `apps/server/wrangler.jsonc`, `apps/server/package.json`, a router test in `apps/server/test`.

## Acceptance
A test that a 2 MB body with a content-length header is refused without being read. `bun run --cwd apps/server typecheck` green. `bun run --cwd apps/server deploy:dry` succeeds.

## Report

STATUS: done

BRANCH: s/u30-platform
HEAD: 77b71c72ff8bb823424ff8e10cab544124f25355

CHANGED:
- `apps/server/src/router.ts`: `carriesUserId` returns `"too_large"` and `route` answers 413. New `readCapped` reads a clone in bounded chunks and checks `content-length` first.
- `apps/server/wrangler.jsonc`: `max_batch_size: 1` on `kiko-jobs`; `dead_letter_queue: "kiko-jobs"` on `kiko-jobs-dead`; comment updated to match.
- `apps/server/package.json`: `deploy:dry` runs `NODE_ENV=production wrangler deploy --dry-run`.
- `apps/server/test/router.test.ts`: new test file.

VERIFIED:
- `bun run --cwd apps/server test -- router.test`: `ok router.test.ts 3 pass`.
- `bun run --cwd apps/server typecheck`: `$ tsc --noEmit` (green).
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bunx biome check apps/server core apps/cli scripts`: no errors, 2 pre-existing warnings in `scripts/check-imports.ts` and `scripts/check-rules.ts`.
- `bun run --cwd apps/server deploy:dry`: succeeds (needed `bun run --cwd apps/web-solid build` first, because `apps/web-solid/dist` is a missing build artifact in a fresh worktree).
- `bun run --cwd apps/server test -- naming.test`: `ok naming.test.ts 22 pass`.
- A script that calls `route` with a hanging session lookup and a 100 ms deadline returns 504 in 106 ms, so the upgrade timeout is intact.

FAILED-BEFORE:
- `apps/server/test/router.test.ts:38:30` `Expected: 413, Received: 401` and `:46:30` `Expected: 413, Received: 401`. Seen with the router change stashed.

DOCS:
- `https://developers.cloudflare.com/queues/configuration/configure-queues/` for `max_batch_size` (default 10, max 100) and `dead_letter_queue`.
- `https://developers.cloudflare.com/queues/configuration/dead-letter-queues/` says a dead-letter queue "is like any other queue", so a queue may be another queue's dead-letter queue. Without one, messages are deleted at the retry limit.
- `https://developers.cloudflare.com/queues/platform/limits/` sets Message retries to 100, so the comment's "100 is the Queues limit" is correct.

DEVIATIONS:
- DEVIATION: the 1 mb cap now refuses a request with 413 instead of skipping the scan. `carriesUserId` runs before route matching, so this is a cap on every `/api` JSON body, not only the socket paths. The brief says "refuse early", the acceptance says "is refused", and `hooks-route.ts:13-15` already uses this exact 413 pattern, so I followed it.
- There is no `deploy` script in `apps/server/package.json`, only `deploy:dry`, so finding 4 changes only `deploy:dry`.
- ASSUMPTION: a deletion that keeps failing belongs in `kiko-jobs`, so `kiko-jobs-dead` points at `kiko-jobs`. Only delete jobs reach the dead queue, because the main consumer acks any other body, so the two-queue cycle carries only deletions.

FOLLOW-UPS:
- `apps/server/test/hardening.test.ts` is flaky on this machine: Miniflare fails with "Unable to connect", and it failed the same way with this change stashed (8 failures on base). It is unrelated to this unit. Run the router route test standalone instead.

## Discoveries
- `deploy:dry` fails on a fresh worktree because `apps/web-solid/dist` does not exist. The missing assets directory, not the config, is the cause.
- `hooks-route.ts` already has a private `readCapped` that this change duplicates inside `router.ts`. Scope was one file for the router, so I did not extract a shared helper. A later unit could lift it to a lib.
