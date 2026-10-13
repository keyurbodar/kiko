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
