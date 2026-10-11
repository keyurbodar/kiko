# P2-18 Let users theme everything with JSON

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 6 |
| Depends on | P2-01, P4-05, P1-05 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-18-let-users-theme-everything-with-json` |

## Verification

`bun test apps/web-solid/src/theme` passes, including a table of bad themes that each name the wrong key. With `agent-browser`: paste a theme that sets the accent, bubble radius, message spacing, and font, see it apply live, save it, reload with no flash of the old theme, see it on a second browser profile signed in as the same user, then reset to kat.

## Task

**Goal.** Let a user change any visual token by pasting a JSON theme, with radius, spacing, type, and colors all in reach.

**Read first.** `packages/ui/src/styles/tokens.md` and `kat.css`. t3code's approach, which yuki extends: `refs/t3code/apps/web/src/themePalette.ts` (`ThemeFile` at line 47, `parseThemeFile` at line 1352, `applyThemePalette` at line 1516) and `components/settings/ThemeImportDialog.tsx`. t3code themes colors only; yuki themes every token.

**Files.** Create `apps/web-solid/src/theme/` (`schema.ts`, `apply.ts`, `presets/`, `editor.tsx`, tests) and `docs/theming.md`. Edit `apps/server/src/user/` for one theme record, `core/protocol` for one user event, and the HTML shell for the pre-paint script.

**Build.**

- A versioned format: `{ "version": 1, "name", "extends": "kat-dark" | "kat-light" | <id>, "appearance": "dark" | "light", "colors": {...}, "radius": {...}, "spacing": {...}, "type": {...}, "size": {...}, "variants": { "light": {...} } }`. Every key maps to one existing CSS variable from `tokens.md`. Missing keys inherit from `extends`, so a two-line theme works.
- Groups. `colors`: every surface, text, accent, bubble, border, and status token. `radius`: bubble, panel, menu, button, input, tile, chip, and a `scale` multiplier. `spacing`: a `scale` multiplier plus bubble padding, row gap, run gap, rail and sidebar padding. `type`: UI and mono font families, base size, line height, weights. `size`: rail width, sidebar default width, row heights, composer height, avatar sizes.
- A `tokens` escape hatch: `{ "--any-token-from-tokens.md": value }`. Unknown variable names are refused. There is no raw CSS field.
- Validate by hand, as t3code does, so the theme code stays out of Effect and tiers 1 to 2. Check colors and lengths with `CSS.supports`, clamp numbers to ranges, and report each problem as `radius.bubble: expected a length, got "big"`. A theme with errors is never applied.
- Apply by setting CSS variables on `document.documentElement`, the way `applyThemePalette` does. Preview a draft live and revert on cancel.
- Persist in `UserDO` (one record, synced to every device by a user event) and cache the applied variables in `localStorage`. A tiny inline script in the HTML shell applies the cache before first paint, so a reload never flashes.
- Settings, appearance: presets (kat dark, kat light, and two more), a JSON editor with inline errors (CodeMirror, lazy), paste, import a `.json` file, export, and reset.
- Navigation, menus, and the composer keep 0 ms animation. Themes cannot change that, and the format has no motion keys.
- Document every key with its default in `docs/theming.md`, generated from `schema.ts` by a script so the two never drift.

**Done when.** Every variable in `tokens.md` is reachable from the format, and a theme can never break the app: the worst a bad value does is fail validation.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
