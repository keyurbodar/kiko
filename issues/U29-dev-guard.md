# U29 One dev guard

**Model** Sonnet 5.5 medium. **Wave** 2. **Depends on** U01, U03. **Timebox** 90 min.

## Goal
Dev-only code is reachable only through one guard, so a missed check is impossible and `check-rules` enforces it.

## Context
31 `process.env.NODE_ENV` sites in `apps/server/src`, each with its own throw or return. Dev routes in `apps/server/src/auth/account-route.ts:90-121`, `agent/dev-route.ts`, `user/dev-browser-route.ts` build Durable Object names from the URL. `user/dev.ts` already has a `devOnly`.

## Build
One module exports the guard (method guard and route guard). Every site uses it. Dev routes build names only through `lib/names.ts`. Flip the `dev-guard` rule in `scripts/check-rules.ts` to enforce. Confirm with a production build (`bun run --cwd apps/server deploy:dry` with NODE_ENV=production) that dev strings are absent.

## Acceptance
`check-rules` enforces `dev-guard` with zero violations. Dev verify suites still pass on port 8829.
