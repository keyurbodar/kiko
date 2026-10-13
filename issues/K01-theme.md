# K01 theme package and token collapse

GOAL: one pure-TS package `@kiko/theme` (`packages/theme`) owns palette, look record parse and format, display settings and the DOM apply. Semantic colors have one source. Radius, icon and type scales exist as tokens.

CONTEXT: `refs/reports/R1-design-system.md` (units U1, U2, section 3.2 token names, 3.3 border rule). Decisions in `issues/REDESIGN.md` item 2.

SCOPE: write `packages/theme/**`, `apps/web-solid/src/theme/**`, `packages/ui/src/styles/kat.css`, `packages/ui/src/styles/tokens.md`, `apps/web-solid/index.html` (inline pre-paint only), `apps/web-solid/src/styles/app.css`, `scripts/check-imports.ts` layer map, root workspaces. Not `packages/ui/src/v2/styles/theme.css`. Not `look.ts` avatar fields (K07 owns them).

ACCEPTANCE:
- `palette`, `look`, `display`, `apply` live in `packages/theme/src`, tests moved with them and green. No Solid import in palette or look.
- kat.css keeps font faces, type scale, radius tokens `--radius-xs|sm|md|lg|bubble|pill`, icon tokens `--icon-xs|sm|md|lg`, body rules, and one first-paint fallback block. The semantic color values that palette.ts sets at runtime are removed from kat.css.
- `MONO_SYSTEM` lists concrete font names before `ui-monospace`.
- Border rule rewritten in the kat.css header and tokens.md: hairlines are dividers and input outlines only.
- Pre-paint cache key and format unchanged in behavior (stored look paints the same).
- `bun scripts/bundle-budget.ts` shows tiers 1 and 2 not larger.
- Real browser check, light and dark, of sidebar, chat bubbles, composer and settings before and after (screenshots saved under `.verify-evidence/K01/`).

VERIFY: typecheck, theme tests, check-imports, budget script, browser check.
