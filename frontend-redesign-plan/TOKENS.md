> Current implementation and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposals below are historical and do not override it.

# Tokens

## What main already does well

- `packages/theme/src/palette.ts` is the source: `PALETTES`, `ACCENTS`, `NEUTRALS`, `tokensFor()`.
- `packages/theme/scripts/gen-palette.ts` writes the `/* palette:start */` block in `apps/web-solid/src/index.css`, and `theme.test.ts` checks that it matches `tokensFor()`.
- Imported VS Code themes and the accent picker go through the same `tokensFor()`.

Keep all of that.

## What's wrong (measured on main `6167d2b1`)

1. Names describe where a token is used, not what it is. `--accent` is a 4% grey hover fill, and the real accent is `--ring`. `--muted` (3%), `--secondary` (4%), `--accent` (4%), `--sidebar-row-hover` (4%) and `--message-assistant` (5%) are all near-identical ink fills.
2. Components invent colours. `index.css` defines 256 custom properties, and component CSS adds about 250 ad-hoc `color-mix()` calls and about 100 hex literals.
3. The boot script in `index.html` hard-codes `#0a0a0a` / `#fcfcfc` / `#f5f5f5` / `#27272a` instead of reading the generated values.

The PR makes the first two worse: 274 properties, with new `--surface`, `--frame-*`, `--composer-edge`, `--composer-halo`, `--line-w`, `--press-edge` and `--reaction-bg`, and border rings inside every shadow token.

## Target

Three layers. Only layer 2 is written by `tokensFor()`.

1. **Palette (seeds)**: `palette.ts` as it is now.
2. **Roles**: a small, fixed set.
3. **Component tokens**: only where a component needs a named value (`--bubble-r`, `--composer-*`), always defined from roles.

### Roles

| New | From main | Dark / light |
|---|---|---|
| `--bg` | `--background` | `#0a0a0a` / `#fcfcfc` |
| `--bg-sidebar` | `--sidebar` | `#050505` / `#fafafa` |
| `--ink` / `--ink-2` / `--ink-3` | `--foreground` / `--muted-foreground` / `--secondary-label` | unchanged |
| `--fill-1` | `--muted` | ink 3% / 3.5% |
| `--fill-2` | `--secondary`, `--accent`, `--sidebar-row-hover`, `--message-assistant` | ink 4–5% (pick 5) |
| `--fill-3` | `--accent-strong`, `--sidebar-row-active`, `--control`, `--input` | ink 8% / 7% |
| `--fill-4` | `--control-strong` | ink 11% / 9% |
| `--raised` | `--popover` | unchanged |
| `--line` | `--border` | unchanged. Only for list dividers and light-mode popovers. |
| `--accent` | `--ring` | azure. This is the rename that matters. |
| `--accent-wash` / `--accent-fill` | `--ring-wash` / `--message-user` | unchanged |

Merging `--message-assistant` from 5% into `--fill-2` shifts it by 1% if `--fill-2` is set to 4. Set `--fill-2` to 5%. Then measure `--secondary`/`--accent` at 4→5 in screenshots. If any surface visibly changes, keep a `--fill-2` at 4 and a separate `--bubble-agent` component token at 5.

### Rules, enforced by a check

- In `scripts/check-rules` (or next to `theme.test.ts`), fail on `0 0 0 <n>px` inside any `--*-shadow` value. Borders don't live in shadows.
- Fail on new hex literals in `apps/web-solid/src/**/*.css` outside `index.css` (count-based ratchet: today's count is the ceiling, and it only goes down).
- Generate the boot defaults in `index.html` from `tokensFor()` through `gen-palette.ts`, with markers like the CSS block.

### Migration

- One codemod script, `scripts/rename-tokens.ts`, that rewrites the CSS variables and the Tailwind utilities (`bg-accent` → `bg-fill-2`, `ring-ring` → `ring-accent`, and so on) across `apps/web-solid/src` and `packages/ui/src`. Run it, commit, and prove there's no visual change with screenshots.
- Then a second PR moves the most common component `color-mix()` calls onto roles, folder by folder, ratcheting the count down.

### Later, not now

The PR's `color.ts` (OKLCH helpers) and `paletteFor` can become an opt-in Appearance toggle, "Tint the app with the accent", off by default. The extra `mikan` accent can join `ACCENTS`. `DEFAULT_ACCENT` stays `azure`.
