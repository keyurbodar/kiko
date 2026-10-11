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

## Report

**Code commit** `016264e9` (guard change), merged with `main` at `13595f0e`. Branch `s/u29-dev-guard`.

### What changed

- `apps/server/src/lib/dev-guard.ts` is the only module that reads `NODE_ENV`. It exports `DEV`, `devRequest(url)` (route guard), `devOnly()` (method guard), `devResponse(request, env)` (the Worker's dev dispatch), and the two plugin helpers `devAuthPlugins()` and `devTrustedOrigins()`.
- `apps/server/src/lib/dev-routes.ts` holds the dev route list. `devResponse` loads it by dynamic import.
- Every other `NODE_ENV` site now calls the guard. Removed the local `LOCAL_HOSTS` copies and the local `devOnly` and `guard()` helpers. The `declare const process` lines in `index.ts` and `room/room-do.ts` were dead and are gone.
- `account-route.ts`: the dev branch moved out of `accountRoute` into `devAccountRoute`, which the dev dispatch calls.
- `scripts/check-rules.ts`: `dev-guard` now enforces, and skips only `lib/dev-guard.ts`.
- `scripts/check-rules.test.ts` (new): three tests on the rule.
- `docs/architecture.md` section on the dev `auth` plugin: names the guard module and why the routes load by dynamic import.

### Discoveries

1. **esbuild folds a `NODE_ENV` ternary only inside its own module.** A `DEV` const or an `isDev()` function from another module stays a runtime check. The first version of this change left `/api/dev` at 5 and put the dev-session plugin back into the production bundle. The fix is the ternary in `dev-guard.ts` plus the dynamic import.
2. **A static import of the dev routes from the guard breaks unit tests.** `auth.ts` → guard → `room-do` → `cloudflare:workers` made `naming.test.ts` fail under bun ("Cannot find package 'cloudflare:workers'"). The dynamic import removes that edge.
3. **`check-exports` counts any word in a comment as a use.** My comment "Method guard" matched the baseline entry `core/browser/src/cdp/session.ts:Method` and reported one stale entry. Reworded the comment.
4. **`deploy:dry` needs `apps/web-solid/dist`.** Built it locally with `bun run --cwd apps/web-solid build`. It is gitignored and not committed.
5. **Residual dev strings:** the `http://localhost:*` literal stays in the bundle as text inside a dead ternary in `devTrustedOrigins`. The count is 1 before and after. Other runtime `DEV` checks (`agent-do`, `user-do`, `dev-fixture-fetch`, `reminders-route`) keep their dev code in the bundle. None of it is a dev route or a dev plugin.
6. `apps/server/src/auth/dev-session.ts` keeps its own `LOCAL_HOSTS` copy. It is inside the plugin, so it is out of the rule's scope. Could use the guard's host list if the guard exported it.

### Production build (`NODE_ENV=production bun run --cwd apps/server deploy:dry --outdir …`, `index.js`)

| string | before | after |
|---|---|---|
| `/api/dev` | 5 | 0 |
| `seed-agent` | 0 | 0 |
| `dev/session` | 0 | 0 |
| `localhost:*` | 1 | 1 (see Discovery 5) |

The before build was made from the branch before my first edit, so it is the baseline. The after build is from the merged tree.
