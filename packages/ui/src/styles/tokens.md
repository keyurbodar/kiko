# Theme tokens

Source: `kat.css`. Values come from the kat-replica dark tokens and the kat screenshots. The screenshots win.

## Controls

| Token | Value | Use |
| --- | --- | --- |
| `--hue` | 55 | Hue of every neutral and accent. |
| `--cm` | 1 | The one chroma multiplier. Raise it for a brighter orange. Every chroma passes through it. |

The user bubble has its own hue, `--h-brand` (48.4). The screenshot pixel `#66422f` is hue 48.4, not 55. DEVIATION from the replica token (`.4196 / .07 / 55`), which does not reproduce the pixel.

## Measured colors

| Role | Token | oklch | Pixel |
| --- | --- | --- | --- |
| sidebar | `--bg-sidebar` | .1442 .003 | `#0b0a09` |
| panel | `--bg` | .1837 .003 | `#131211` |
| assistant bubble | `--assistant-bubble` | .2423 .005 | `#221f1e` |
| user bubble | `--user-bubble` | .4156 .0585 48.4 | `#66422f` |

The sidebar is darker than the panel.

## Sizes

| Token | Value |
| --- | --- |
| `--sidebar-nav-w` | 60px (rail) |
| `--sidebar-content-w` | 280px |
| `--content-max-w` | 768px (column) |
| `--topbar-h` | 50px |
| `--bubble-pad-y`, `--bubble-pad-x` | 7px, 12px |
| `--radius-bubble` | 18px |
| `--radius-bubble-tight` | 8px (stacked corners) |
| `--bubble-gap` | 2px (inside a stack) |
| `--row-gap`, `--run-gap` | 1px between messages in a run, 8px before a new run |
| `--font-base`, `--line-height` | 14px, 1.45 |

The font stack is the system stack. The light tokens are `--light-*`. They are defined and nothing reads them.

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
| approval card | `--approval-bg`, `--approval-edge`, `--approval-title`, `--approval-allow`, `--approval-deny` |
| board | `--board-bg`, `--board-column-bg`, `--board-card-bg`, `--board-card-hover`, `--board-column-gap`, `--board-card-gap` |
| shared mixes | `--accent-wash`, `--accent-wash-strong`, `--accent-wash-faint`, `--text-wash`, `--danger-wash`, `--scrim` |

Each color token has a Tailwind utility in section 5 of `kat.css`, for example `bg-tab-active`, `bg-reply-bar`, `bg-accent-wash`. A component uses the utility and never writes a color.

## Icons

Target: one sprite, `packages/ui/src/icons/sprite.svg`, one `<Icon name>` component, 20 px grid, `currentColor` stroke. The sprite and the component are not built here, because this task owns only the two style files. ASSUMPTION: a later task builds them from this list.

Today there are four systems:

1. `lucide-solid` named imports in `apps/web-solid/src/chat` and `composer`.
2. The inline path map in `packages/ui/src/components/icon.tsx`.
3. The `sidebar/icons.tsx` rail glyphs.
4. The sprites `file-icons/sprite.svg` (1089 symbols) and `provider-icons/sprite.svg` (99 symbols).

Icons the app uses today, which the one sprite must contain:

| Group | Names |
| --- | --- |
| rail | chats, terminal, code, browser, settings |
| chat | plus, copy, reply, pencil, pin, trash, play, file-text, link |
| navigation | chevron-down, chevron-left, chevron-right, close, minus, scan |
| composer | plus, mic, send |
| top bar | search, more |

File-type and provider icons stay out of the sprite. They are data, chosen by name at run time.

## Known gaps

- Component files still carry `oklch(from var(--accent) ...)` mixes: `sidebar/sidebar.tsx`, `sidebar/chat-panel.tsx`, `sidebar/sidebar.css`, `composer/composer.css`, `chat/ui/DateChip.tsx`, `chat/ui/MessageMenu.tsx`, `chat/ui/EmojiPicker.tsx`, `chat/ui/WebPageCard.tsx`, `chat/ui/Quote.tsx`. Use `--accent-wash`, `--accent-wash-strong`, `--accent-wash-faint`, `--text-wash`, `--danger-wash` instead.
- `chat/media/mediaViewer.css` holds literal `rgb()` values for the viewer overlay. Use `--scrim` and the wash tokens.
- `lib/fixtures.ts` holds four hex avatar colors.
