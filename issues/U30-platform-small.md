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
