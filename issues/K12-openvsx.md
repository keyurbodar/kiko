# K12 Open VSX theme import

GOAL: the user can search Open VSX, pick a VS Code theme, and Kiko applies it as its palette, the way t3code does, with no Effect.

CONTEXT: `issues/REDESIGN.md` item 2, `refs/t3code` (read how t3code imports VS Code themes and searches Open VSX), `refs/reports/R1-design-system.md`. `@kiko/theme` (`packages/theme`) owns the palette model and is on main.

SCOPE: `packages/theme/**` (importer, mapper from VS Code token colors to the two-input palette), the appearance settings page in `apps/web-solid/src/**` (search box, results list, apply, remove), a lazy chunk for the importer. Use `culori` and `crypto.subtle`; `culori` is allowed as the one new dependency, exact version at least 7 days old.

ACCEPTANCE:
- Search Open VSX by text, list themes, install one: fetch the vsix or theme JSON, map to the palette, store it locally, apply at once. Imported themes can be removed.
- The importer is a lazy chunk and does not grow tiers 1 to 3 (report `bun scripts/bundle-budget.ts`).
- Mapper has table tests over at least three real theme JSONs (one dark, one light, one with `include`), failing when a mapping breaks.
- Network goes through the Worker or a safe fetch, never from a model run; failures show an error with retry.
- Strings are sentence case: "Search themes", "Open VSX".

VERIFY: typecheck, theme and web-solid tests, check-imports, browser screenshots under `.verify-evidence/K12/` with one real theme applied in light and dark.

## Report

STATUS: done. The importer, the Open VSX search and install, the Worker route, and the settings group work end to end in a real browser against open-vsx.org.

The theme maps a VS Code theme onto Kiko's ten palette roles and one accent. Imported themes stay in this browser under `kiko:imported-themes`. The look record is unchanged.

Install is one step: search, install, and the theme applies at once. Its appearance also becomes the mode. A light and a dark theme are separate imports, and light and dark variant pairing is not built.

## Discoveries

- The server's theme slot accepts only `version: 1` (`apps/server/src/user/theme.ts`, `isStorableTheme`). `formatLook` writes `version: 2`, so `setTheme` returns false for every look. Read in code, not run on main. The look owner (K07 or K01) should confirm this before the look is relied on.
- Open VSX answers a package download with a 302 to `openvsx.eclipsecontent.org`, not to `open-vsx.org`. The first route version refused that host, and every install failed with "Open VSX is unavailable right now. Try again." The route now follows that CDN host and no other.
- `apps/web-solid/package.json` still lists `culori`. Nothing in web-solid imports it now. Removing it is a small follow-up.
- `tokensFor` (`palette.ts`) gained an optional imported palette argument. `apply.ts` gained the imported state and `saveImported`. K13 and K07 touch the same token and look files, so expect a small conflict there.

## Verification

- `bun test` in `packages/theme`: `Ran 44 tests across 5 files.` 44 pass, 0 fail.
- `bun test test/open-vsx-route.test.ts` in `apps/server`: 12 pass, 0 fail.
- `bun run --cwd packages/theme typecheck`, `apps/server typecheck`, `apps/web-solid typecheck`: all exit 0.
- `bun run --cwd apps/web-solid build` then `bun scripts/bundle-budget.ts`: `ok tier 1 shell js 2002 bytes gzip (limit 2092)`, `ok tier 2 first paint of /chat 184149 bytes gzip (limit 189595)`, `ok tier 3 lazy modules 130634 bytes gzip (limit 136266)`, `ok tier 4 route chunks 25803 bytes gzip (limit 28461)`. Exit 0. The importer is a lazy import.
- `bun scripts/check-rules.ts`: `check-rules ok in 110 ms`. Exit 0.
- `bun scripts/check-exports.ts`: `check-exports ok: 206 files, 185 baselined in 159 ms`. Exit 0.
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol, theme, avatar`. Exit 0.
- `bun test src/theme` in `apps/web-solid`: no test files there, so bun exits 1. The theme tests live in `packages/theme`.
- Browser, against my dev server on 5412 and client on 5312, signed in as `k12`:
  - Search "dracula" returned 16 real results.
  - Install "Dracula Theme": canvas `rgb(40, 42, 54)`, mode dark. Screenshot `.verify-evidence/K12/dark-dracula.png`.
  - Install "GitHub", apply "GitHub Light Default": canvas `rgb(255, 255, 255)`, accent `rgb(9, 105, 218)`, mode light. Screenshot `.verify-evidence/K12/light-github.png`.
  - Reload kept the light theme.
  - Search "zzzqqqxx" showed "No color themes match."
  - Remove worked.
  - Before the CDN fix, the install failed with "Open VSX is unavailable right now. Try again." That is the reproduction on the old code.

## Mutation checks

- Checksum check disabled: `refuses a package whose checksum does not match` fails. Output line: `3 pass`, `1 fail`.
- Host guard on the final URL set to accept any host: `refuses a redirect to another host` fails. Output line: `11 pass`, `1 fail`.
- Both files restored from git. `git status --short` is empty.

## Scope notes

- The brief said network goes through the Worker. That needed a new route, `apps/server/src/themes/open-vsx-route.ts`, wired in `apps/server/src/index.ts`. It is session-gated, accepts `open-vsx.org` only, and uses `safeFetch` with a 20 MB cap.
- `docs/architecture.md` now has a DEVIATION and an UNVERIFIED line for these choices.
- The zip reader uses `DecompressionStream`, and the JSONC reader is a small local parser. jszip and jsonc-parser are not used, so culori is the only new package. `@types/culori` is a dev dependency of `packages/theme`. It was already in the lockfile at the web-solid version.
- Known gap: the boot cache is written only when a look already exists. A user who imports a theme and never saved a look sees the default palette for a moment on reload, until the bundle loads.
