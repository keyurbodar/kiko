# Theme tokens

Source: `kat.css` in this folder. Values come from the kat-replica dark tokens and the kat screenshots. The screenshots win. Where kat.css and a screenshot disagree, the entry says DEVIATION.

## Colors, borders and scales

Semantic colors come from `packages/theme/src/palette.ts`. kat.css keeps one first-paint copy of them, in the block between `palette:start` and `palette:end`. `bun packages/theme/scripts/gen-palette.ts` rewrites that block, and a test keeps it equal to the palette. No other file declares a palette color.

Hairlines are for dividers and input outlines only. Every other edge is a fill or a shadow, so a component never draws a border of its own.

| Scale | Tokens |
| --- | --- |
| Radius | `--radius-xs` 4px, `--radius-sm` 6px, `--radius-md` 10px, `--radius-lg` 14px, `--radius-bubble` 16px, `--radius-pill` 999px |
| Type | `--font-xs` 11px, `--font-sm` 12px, `--font-md` 13px, `--font-base` 14px (the interface setting), `--font-lg` 16px |
| Icon | `--icon-xs` 12px, `--icon-sm` 14px, `--icon-md` 16px, `--icon-lg` 20px |

There is no density setting. Spacing stays on Tailwind's scale.

## Controls

| Token | Value | Use |
| --- | --- | --- |
| `--hue` | 340 | Hue of the accent and the brand. kat.css defines no preset. |
| `--h-brand` | 340 | Hue of the user bubble. |
| `--tinge` | 0 | How much the greys take `--hue`, from 0 to 1. At 0 the greys are neutral. |
| `--cm` | 1 | The one chroma multiplier. Raise it for a more saturated theme. Every chroma passes through it. |

The user bubble has its own hue, `--h-brand`. The screenshot pixel `#66422f` is hue 48.4. DEVIATION: kat.css sets `--h-brand` to 340, which renders `#613f56`. Hue 48.4 reproduces `#66422f` exactly.

## Measured colors

The oklch column is the kat.css token at `--tinge: 0`. The pixel column is from the screenshots. The last column converts the token to sRGB.

| Role | Token | oklch | Pixel | Renders as |
| --- | --- | --- | --- | --- |
| sidebar | `--bg-sidebar` | .175 0 | `#0b0a09` | `#101010` |
| panel | `--bg` | .205 0 | `#131211` | `#171717` |
| assistant bubble | `--assistant-bubble` | .255 0 | `#221f1e` | `#232323` |
| user bubble | `--user-bubble` | .4156 .0585 340 | `#66422f` (hue 48.4) | `#613f56` |

The sidebar is darker than the panel. The screenshot greys are slightly warm, and at `--tinge: 0` kat.css renders them neutral. The `--tinge` value that matches them is not measured yet.

## Sizes

| Token | Value |
| --- | --- |
| `--sidebar-nav-w` | 60px (rail) |
| `--sidebar-content-w` | 280px |
| `--content-max-w` | 736px (column) |
| `--topbar-h` | 50px |
| `--bubble-pad-y`, `--bubble-pad-x` | 8px, 12px |
| `--radius-bubble` | 16px (one line is a pill, see `apps/web-solid/src/chat/ui/bubble.css`) |
| `--bubble-gap` | 2px (inside a stack) |
| `--row-gap`, `--run-gap` | 1px between messages in a run, 16px before a new run |
| `--font-base`, `--line-height` | 14px, 1.45 |

The text font is Instrument Sans, and the code font is Fantasque Sans Mono. kat.css loads both with `@font-face`. The system stack is the fallback (`--font-family-sans`, `--font-family-mono`).

Light is `:root[data-appearance="light"]` (section 4c of kat.css). It swaps the lightness tokens and keeps every hue and chroma. There are no `--light-*` tokens.

## Surface tokens

| Surface | Tokens |
| --- | --- |
| tab strip | `--tab-h`, `--tab-max-w`, `--tab-bg`, `--tab-bg-hover`, `--tab-bg-active`, `--tab-text`, `--tab-text-active`, `--tab-shadow` |
| date pill | `--date-pill-bg`, `--date-pill-text` |
| calendar | `--calendar-bg`, `--calendar-day-hover`, `--calendar-day-selected`, `--calendar-day-selected-text`, `--calendar-day-today`, `--calendar-day-outside` |
| palette | `--palette-bg`, `--palette-row-hover`, `--palette-row-active`, `--palette-kbd-bg`, `--palette-kbd-text`, `--palette-max-w` |
| editor gutter | `--editor-bg`, `--editor-gutter-bg`, `--editor-gutter-text`, `--editor-line-active`, `--editor-selection`, `--tree-row-h`, `--tree-indent` |
| clamp fade | `--clamp-fade-h`, `--clamp-fade-assistant`, `--clamp-fade-user`, `--clamp-fade-panel` |
| reply bar | `--reply-bar-bg`, `--reply-bar-accent`, `--reply-bar-name`, `--reply-bar-text` |
| board | `--board-bg`, `--board-column-bg`, `--board-card-bg`, `--board-card-hover`, `--board-column-gap`, `--board-card-gap` |
| shared mixes | `--accent-wash`, `--accent-wash-strong`, `--accent-wash-faint`, `--text-wash`, `--danger-wash`, `--scrim` |

Color tokens have Tailwind utilities (`--color-*`) in section 5 of `kat.css`, for example `bg-tab-active`, `bg-reply-bar`, `bg-accent-wash`. A component uses the utility and never writes a color.

## Choices

- **Neutral default.** The kat palette stays. Its greys are neutral (`--tinge: 0`) and the sidebar is one step darker than the panel. DEVIATION from the brief's "choose a better neutral": no palette change in this unit. A new palette needs its own screenshot review, and it belongs in `packages/theme`. UNVERIFIED: that kat's light surface reads softer than t3code's; this is a judgment from the before and after screenshots, not a measurement.
- **UI font.** Instrument Sans, self-hosted in two subsets, so the first paint never waits on a network font. The system stack is the fallback.
- **Mono font.** Fantasque Sans Mono, self-hosted, with the system mono stack as fallback.
- **Font smoothing.** `--font-smoothing` is unset by default, so the browser's own smoothing applies. Set it only where a screenshot needs it.
- **Control heights.** Desktop sizes from t3code: `--control-h-sm` 28px (buttons), `--control-h` 32px (selects, the sidebar search and settings rows), `--field-h` 30px (text fields), `--control-h-xs` 24px (segment items).
- **Corners.** Controls (buttons, selects, fields, segment track, sidebar rows) use `--radius-sm`. A segment item uses `--radius-xs`, one step smaller than its track, because the track pads it by 2px. Cards use `--radius-lg`. t3code uses 8px for controls, which falls between the 6px and 10px steps. DEVIATION: Kiko takes 6px to stay on the named scale.
- **Type sizes.** Literal font sizes map to the scale: 11, 12, 13, and 14 (13.5 and 14 both become `--font-base`), and 16. t3code's 12.5px segment label becomes 12px.
- **Motion.** Menus, buttons, navigation and the composer do not animate. Motion stays on the message and attachment surfaces in `styles/motion.css` (architecture 19.5).

## Icons

Target: one sprite, `packages/ui/src/icons/sprite.svg`, one `<Icon name>` component, 20 px grid, `currentColor` stroke. Neither is built yet. ASSUMPTION: a later task builds the sprite from the lists below.

Today there are three icon sources:

1. `packages/ui/src/icons.gen.ts`: 76 Hugeicons glyphs copied as data. `scripts/gen-icons.ts` writes it. Add a row there and run the script. `HugeIcon` in `packages/ui/src/components/huge-icon.tsx` draws them.
2. `packages/ui/src/components/icon.tsx`: `Icon` maps five older names (`arrow-up`, `stop`, `arrow-undo-down`, `link`, `magnifying-glass`) to glyphs from `icons.gen.ts`.
3. The sprites `packages/ui/src/components/file-icons/sprite.svg` (1089 symbols) and `packages/ui/src/components/provider-icons/sprite.svg` (99 symbols).

The one sprite holds the glyphs in `icons.gen.ts` and the five names in `icon.tsx`. File-type and provider icons stay out of the sprite. They are data, chosen by name at run time.

## Known gaps

- Literal `rgb()` values in four web-solid CSS files: `chat/rich/rich.css`, `composer/snowball.css`, `settings/kit.css`, `mascot/hoarfrost.css`. Use the wash and scrim tokens where one fits.
- `lib/fixtures.ts` holds four hex avatar colors. They are fixture data.

Done on main: no component file uses `oklch(from var(--accent) ...)` any more. The washes live in kat.css. `chat/media/mediaViewer.css` and `sidebar/icons.tsx` are gone. `lucide-solid` is no longer imported.
