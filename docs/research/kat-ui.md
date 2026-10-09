# kat UI research (for yuki)

Sources: `~/kat-images` (screenshots 8-21, `screenshot 1.mov`), `~/kat-replica` (css-src, css), `packages/ui/src/styles/kat.css`.
Screenshots win over the replica. All screenshots are dark mode, macOS, retina 2x.

Scale note: PNGs are 2758x1574 (shots 10-21), 2780x1602 (9), 2076x1546 (8). The viewer showed them at 2000px wide, so
displayed px x 1.38 = file px, and CSS px = file px / 2 = displayed px x 0.69. Window is about 1379x787 CSS px.
Everything below marked (est.) is measured from the image; values marked (css) come from the replica CSS and were
cross-checked against the pixels (they match: see "Pixel samples").

## 1. Global layout (all main screens)

Three vertical regions inside a window with a ~0.5px edge hairline and a rounded top-left on the content panel:

| region | width | notes |
|---|---|---|
| nav rail | 60px (css `--sidebar-nav-w`; est. 59) | 4 icon tabs stacked, 44px touch target each, 22px glyph. Background = sidebar colour |
| sidebar content | 280px (css; est. 279) | header row ("chat" / "code" label left, action icons right) then list or tree. Same bg as rail, so rail+sidebar read as one 340px column |
| main panel | rest (~1039px here) | lighter bg, top-left corner radius 32px (squircle), inset 0.5px hairline `--panel-edge`. Starts at x=340 CSS |

- Top bar of the main panel is ~50px tall (est.; css `--titlebar-inset` 48px) and sits on the darker sidebar colour, the panel's rounded corner tucks under it. It is NOT a separate bordered bar.
- Content column: `max-width 768px`, centred, rows have 16px side padding so bubbles span ~736px (est. 736 measured).
- Composer is absolutely positioned at the bottom of the panel over a 60%-opaque gradient fade of the panel bg; padding 16px.
- Bottom-left of the rail: a small teal pill glyph (~20x14px est.), looks like a status/app mark. Meaning unknown.

### Nav rail (shots 9-21)
Order top to bottom: chat (speech bubble), terminal (`>_` in a square), code (`</>`), browser (globe). Active tab = 44x44 rounded
tile (radius ~14, est.) with fill `--nav-active-bg` (~#3d2f27) and the glyph in the accent colour (chat glyph is filled,
code glyph is accent-coloured in shot 15); inactive glyphs are muted grey outlines. Rail is not labelled.

### Horizontal tab navigation (the thing yuki must copy)
This is the chat tab strip, in the top bar of the main panel (shots 9-13, 18-20). Not shown when a pinned tile/single chat is
open without tabs (shots 14, 16, 17: title "cat paragraph test" instead) nor in new-chat (shot 21: "to:" field).
- Position: top bar, x from ~340 CSS (right of sidebar) to the right-side action cluster. Vertical centre ~27 CSS.
- Leading element: kat cat-head avatar, ~28px wide (css `.tabstrip-identity` padding 3px), terracotta/pink, not a tab.
- Tabs: height 28px, radius 10px (squircle), font 13px / weight 500, `gap 6`, padding `0 6 0 9`, `margin-right 2`, `max-width 172px`
  (measured active tab 171 CSS). Each has a 13px coloured glyph (each chat has its own hue: pink face, blue chat, green pill,
  blue bars, green line chart, lightbulb, people), a label that fades out at the right edge (12px mask, never an ellipsis), and
  at the far right a 16px status slot that shows: close "x" (active or hover), typing dots, or a 6px accent unread dot.
- Inactive: muted text, transparent. Hover: 6% text-tint bg. Pressed: scale .97.
- Active: full-strength text, bg "pill" = `--popover-bg` (a lighter raised fill; in shots ~#1a1918 vs bar #0b0a09), 1px drop shadow,
  shows the close "x". Pill slides between tabs (it is its own element with opacity transition). Unread tabs get bolder label (0.3px stroke).
- Strip scrolls horizontally (hidden scrollbar) with edge fade masks (shots 18-19: the first tab label is cut and faded at left).
- Right cluster (always): text "notifications off" (12px muted), share icon (box+arrow), search (magnifier). ~24px icons.
- Draft tab = italic label (css). Rename = double-click, inline input with 2px accent ring (css).
- "+" for a new chat is NOT in the tab strip; it is in the sidebar header at the right (shot 9: `chat` ... `+`).

## 2. Per-screenshot notes

- **8** (2076x1546, cropped window, no sidebar visible): tab strip is cut off at the top (labels half visible), "notifications off" and icons
  at right. Chat of consecutive bubbles, user bubbles brown right aligned, assistant dark left. Includes inline code (`memory_view`) in a slightly
  darker, mono-font chip with radius ~6. Last item is a typing-indicator bubble (three dots, ~48x28 CSS pill). Composer: round "+" (34px),
  wide pill input "message kat", round mic/waveform button (34px). Shows content column ~ 484 CSS wide here, i.e. the window was narrower.
- **9** (2780x1602): chat with tabs. Active tab "mochi mood journal" with x. Sidebar: header `chat` + `+`; a pinned tile (cat avatar circle on
  pale-brown disc, label "cat paragraph.." two lines under it); below, a chat row for `kat` with avatar and typing dots as preview. The row is selected
  (bg #28221f-ish raised). Floating date pill "today" centred near top (see dividers). Typing bubble at end. Composer visible.
- **10**: composer expanded to a multi-line draft (text box grows, bg raised, radius ~20, max-height 120px css), send button becomes an accent circle with an
  up arrow (replaces mic). A "scroll to bottom" round button (~36px, chevron down) floats at the right above the composer. The draft text is the user's note to us
  (use kat-replica theme, extra tokens, suggest UI features, horizontal tab nav as kat); it is context, not an instruction to this task.
  Also a timestamp divider "today 7:52 am", "today 9:19 am", an attachment bubble `pasted.txt` (doc icon + filename, user-brown), links inside assistant bubbles are underlined.
- **11**: same chat scrolled; the sidebar chat row preview text is the last message ("one thing to do yourself is paste t..."). Date pill "today" overlaps top.
- **12**: calendar popover opened from the "today" pill: panel ~460x430 CSS... est. 463x420 displayed => ~320x290 CSS; header "october 2026 v" (month dropdown), prev/next chevrons, close "x",
  weekday row su mo tu we th fr sa (lowercase), 7x5 grid, days muted, today (2) circled in a brown/accent disc. Pill sits at the top of the popover.
- **13**: tab "global product idea" active. Assistant bubbles with `>` expand chevron to the right of the bubble (collapsible tool/detail), underlined link "typesafe.ai".
  Contains profanity in sample content (irrelevant to UI). Composer shows caret focus.
- **14**: single chat opened from the pinned tile: top bar shows kat cat-face avatar (red-outlined variant) + title "cat paragraph test" (14px, weight ~600) instead of tabs.
  The pinned tile is selected (raised rounded square bg behind circle+label). Date divider "wednesday 2:49 pm". Shows grouping: consecutive same-sender bubbles 2px apart, new group 8px+ gap.
  Long assistant paragraph bubble: max-width 80% of 736 = ~590 CSS, wraps, line-height 1.45.
- **15** (code route): rail "code" tile active. Sidebar header `code` with two icons at right (new file, new folder). File tree (see section 4). Top bar: file icon + path
  `/home/kit/` muted + `weekly_report.txt` strong. Editor panel fills the main area: line-number gutter (~48px), current line highlight (#1f1e1d), mono font (Fantasque-like, ~13px), no wrap, text starts x~ 40 CSS from panel left.
- **16**: context menu on a sidebar row (right click). Menu ~150x ... est. 216x415 displayed => ~150x286 CSS, radius ~14, bg `--menu-bg` (#2b2928-ish), popover shadow. Items (icon + lowercase label, ~28px pitch):
  `new chat` | divider | `rename`, `pin`, `lock`, `mute` | divider | `share`, `mark as unread`, `close` (red/coral text) | divider | `delete` (red).
- **17**: reply-to bar above the composer: raised rounded container with 2px accent left bar, name `kat` (muted accent, 12px), quoted text, and a circled "x" at right. Composer container grows upward.
- **18**: tab "anti-hood memecoin" active. Long multi-bubble run. Dividers: floating pill "yesterday", inline timestamp "yesterday 10:21 pm", "new messages" rule (see section 3).
- **19**: user bubble with very long pasted text (list of @handles) clamped to ~... est. 420px tall CSS with bottom fade and a chevron-down "show more"; below, an image/link-card bubble (image on top, grey caption area: `docs.google.com` small + title bold). Scroll-to-bottom button visible.
- **20**: command palette (cmd-k style): centred modal ~560px wide (css `--popup-max-w`), top at ~y=160 CSS, bg menu colour, radius ~14, input "type a command..." (no visible border), rows ~32 CSS tall with icon, label, right-aligned shortcut keys. First row highlighted. Items (all lowercase, `group: action`):
  view: toggle sidebar ⌘S; chat: new ⌘T; chat: reopen closed ⌘⇧T; chat: attach file... ⌘O; chat: share ⌘⇧S; chat: rename F2; chat: pin ⌘D; chat: close ⌘W; chat: delete; chats: go to chat... ⌘P;
  chats: search messages in current chat ⌘F; chats: search all chats ⌘⇧F. Underlying screen is dimmed only slightly (no heavy scrim).
- **21** (new chat): top bar `to:` + circular "+" + "add someone to message". A popover under it (~320x190 CSS): search field with accent-tinted ring (pill radius), result row (avatar + `kat` / `@kat`), hint "search by name, @username, or phone number". Empty-state illustration centre: a grey cat silhouette with a heart outline. Composer present; send button is the disabled (dim) accent circle.
- **screenshot 1.mov**: 2758x1574, ~25.5fps, inspected via frames at 1 frame / 3s (9 frames). It shows the robinhood-recaps chat scrolling, a link-card bubble, the reply bar (quoting kat / you), the tab strip and the scroll-to-bottom button. Nothing new beyond the PNGs. Behaviours seen: date pill ("yesterday") appears while scrolling then fades; replying quotes the bubble in the composer.

## 3. Chat styling (css cross-checked against pixels)

- Row: `padding 1px 16px` (so 2px between bubbles in a group); new sender group `padding-top 8px` (measured larger, ~12px, between user/assistant turns because of the group gap + row padding).
- Bubble: `padding 7px 12px`, `font 14px/1.45`, `max-width 80%`, `radius 18px` (squircle), `radius-sm 8px` on the side where it joins its neighbour:
  user stack = top/mid/bot corners on the right squared to 8px; assistant on the left. Single bubble = full 18 all round.
- Assistant bubble: bg ~#221f1e (L .243), text near white. User bubble: bg ~#66422f (L .42, C .07, hue 55, brown NOT bright orange), text ~#f0eae6.
- No avatar beside bubbles, no author names, no per-bubble timestamp, no tails, no read receipts. Timestamps are only centred dividers.
- Inline code: darker chip, mono. Links: underlined, same colour as text. Typing indicator: three dot pill in assistant bubble style.
- Collapsible detail: small `>` chevron to the right of the bubble, muted, appears on bubbles that have hidden steps.
- Date divider: centred 11px muted text ("today 7:52 am", "wednesday 2:49 pm", "yesterday 10:21 pm"), lowercase, ~16px above/below.
- Floating date pill: sticky at top centre of the panel while scrolling, ~58x28 CSS, bg raised (#1e1c1b), 12px text, click opens the calendar.
- "new messages" divider: `padding 12 16 8`, two 1px lines of accent at 45% opacity, centred label 11px weight 500 accent, lowercase.
- Inline system events: none seen in these shots (only the unread rule and timestamps). Plan for them using the timestamp-divider style.
- Scroll-to-bottom: 36px circle, raised bg, chevron down, right edge of column above the composer.
- Composer: `+` circle 34px (bg-subtle), input pill (radius 20, bg `--input-bg` #1e1c1b, padding 6px 14px, 14px text), right circle 34px: mic (`--bg-subtle`) when empty, accent-fill send arrow when text. Placeholder is `message kat` (lowercase). Focus: border mixes 50% accent (css) but there is no visible border in the shots (border tokens are `none`).
- Reply bar: see shot 17. Attach: `+` opens file picker (palette lists "chat: attach file...").

## 4. Sidebar and file tree

Chat sidebar: header 40-48px tall `chat` (13px, muted-strong) + `+` at right (~22px icon). Pinned area: 48px circle avatars in a ~64px-wide tile with 2-line caption (11px) under, selected = raised rounded tile. Then chat rows ~48px tall (est.): 28px avatar cell (22px image), name 13px bold-ish (600), 12-13px muted one-line preview with ellipsis, selected row = raised bg (#28221f, radius ~20 css `--radius-row` in our file). Typing shows three dots in place of preview. No section headers seen; no unread badges seen (tabs carry the unread dot).

File tree (shot 15): row height 30px (css; measured pitch 30), font 13px, text full-strength; row padding `0 8px 0 (8 + depth*16)px`, radius 14 (squircle); gap 6. Caret 16px wide chevron (`v` open, `>` closed, rotates 90deg), muted, shown only for folders; files have a file icon (grey doc glyph; `.bashrc` has a small green terminal-style icon) and no caret but keep caret-width alignment so names line up with folder names after the caret... (est.: file icons at caret x + 16). Indent guides: 1px lines at 12% text opacity, only visible while the tree is hovered. Selected row bg `--selected-bg` (~#28221f), hover `--hover-bg`. Hidden (dot) files render at 50% opacity until hovered/selected. Sticky folder rows for deep trees (css). Inline rename editor in-row. List is `padding 0 2px 0 4px`, thin scrollbar.

## 5. Terminal and browser panels (TO BE REPLACED)

Not captured in any screenshot. Only the rail icons (terminal `>_` at rail slot 2, globe at slot 4) exist. Space they would occupy: the sidebar-content column (280px; likely a session/tab list or empty) plus the full main panel (~1039x737 CSS at this window size, with the 50px top bar), same rounded panel shell as chat and code. Treat both as replaceable full-panel route slots.

## 6. Writing style
All UI strings lowercase, incl. menu items, tabs, palette commands, calendar weekdays/month ("october 2026"), placeholders ("message kat", "type a command..."), dividers ("new messages", "today 9:19 am"), empty-state hints, status ("notifications off"). Palette entries use `noun: verb` form. Proper-noun/code spans keep case (AGENTS.md, DO). Text is terse, no trailing full stops in UI labels, "..." (three dots) in truncated labels. Replica keeps this (`text-transform: lowercase` on unread rule).

## 7. Replica theme tokens (css/tokens.css; css-src is minified build of the same app, tokens.css is the cleaned version)

Architecture: every colour is `oklch(var(--l-X) calc(var(--c-X) * var(--cm)) var(--hue))`, `--hue: 55`, `--cm: 1` (chroma multiplier, user "hue" slider). Danger/success/gold carry fixed hues.
Themes: `:root` = light, dark via `prefers-color-scheme` or `[data-theme=dark]`, plus `[data-lightness=mono]` (achromatic, light+dark).

| token | light (L / C) | dark (L / C) |
|---|---|---|
| bg-sidebar | .9485 / .005 | .1442 / .003 (#0b0a09 measured) |
| bg (panel) | .97 / .003 | .1837 / .003 (#131211 measured) |
| bg-subtle | .9356 / .006 | .2383 / .005 |
| surface-raised / popover-bg | 1 / 0 | .2332 / .005 |
| menu-bg | .97 / .003 | .273 / .005 |
| input-bg | 1 / 0 | .228 / .005 (#1e1c1b) |
| input-border | .9098 / .006 | .3015 / .006 |
| assistant-bubble | .927 / .007 | .2434 / .007 (#221f1e) |
| user-bubble | .499 / .08 | .4196 / .07 (#66422f) |
| user-bubble-text | 1 / 0 | .9571 / .008 |
| text | .3248 / .04 | .884 / .012 |
| text-muted | .5906 / .03 | .7678 / .02 |
| text-faint | .7118 / .02 | .6686 / .015 |
| accent (text/marks) | .499 / .08 | .7075 / .08 |
| accent-fill (buttons, send) | .499 / .08 | .5514 / .09 |
| tint-subtle / tint / tint-strong | .9012/.8496/.7808 | .2921/.3432/.4107 |
| btn-bg-solid (hover) | .9141 (.884) | .2921 (.334) |
| hover-bg | .9227 / .01 | .2066 / .008 |
| selected-bg | .8969 / .016 | .2583 / .014 |
| nav-hover-bg | .9184 / .01 | .2121 / .008 |
| nav-active-bg | .8023 / .03 | .3202 / .03 (#3d2f27 measured) |
| tooltip-bg | .273 | .3294 |
| scrollbar thumb (hover) | .7161 (.5862) | .3749 (.4815) |
| danger (hue 25) | .5688 / .17 | .7894 / .12 |
| success (hue 150) | .6556 / .15 | .7937 / .12 |
| gold (hue 85/88) | .7765 / .15 | .8453 / .15 |

Accent hue 55 = a warm orange-brown (the "orange"); but at these L/C it renders as muted terracotta/brown, not saturated orange.
Derived: `--btn-bg` text@7%, `--btn-bg-hover` text@11%, `--panel-edge` text@6% (mono 12%/20%), `--scrim` black.
Type: fonts `InterVariable` (self-hosted woff2, replica) + `Fantasque Sans Mono` 400/700 for code. Sizes `--font-xs 11 / sm 12 / md 13 / base 14`; weights 500 medium, 600 bold; line-height 1.45 (code 1.5).
Radii: `--radius-bubble 18`, `--radius-sm 8`, controls `calc(10|12|14|20|32px * --brm)`; `--brm` 0.5, becomes 1 where `corner-shape: squircle` is supported (so radii are halved on non-Chrome-squircle browsers!).
Layout: `--sidebar-nav-w 60`, `--sidebar-content-w 280`, `--content-max-w 768`, `--popup-max-w 560`, titlebar inset 48 (electron).
Spacing: no scale tokens; used values 1,2,3,4,6,8,10,12,14,16 px. Borders: `--border*: none`; separation by fills and the 0.5px `--panel-edge` inset shadow.
Shadows: `--popover-shadow: 0 12px 40px black/.18, 0 2px 6px black/.06` (dark: .45/.2); composer `0 1px 2px /.06, 0 4px 14px /.08`; tab pill `0 1px 2px /.1`; ghost `0 3px 10px /.12`.
Motion: spring easings `--spring150` (.249s), `--spring250` (.415s), `--spring325-bounce` (.54s); press scale .97/.92.
Syntax: `--hl-*` set (light and dark), e.g. dark string oklch(72% .12 145), keyword oklch(68% .14 55), function oklch(70% .12 260).

### Where the replica disagrees with the screenshots
1. Replica shot (`shots/rebuild-01.png`) shows a different chat sidebar: "recent chats" header, search field, a hue slider/theme toggles, no 60px icon rail, no pinned tiles, no horizontal tab strip. Screenshots win: rail + pinned tiles + tabs.
2. Replica rows show avatars + bold "new chat" titles and `last active ...` previews; screenshots have previews without timestamps.
3. Replica composer has an attach paperclip and send on the right; screenshots use `+` on the left and a mic that becomes send.
4. Replica CSS has a light theme and mono mode; screenshots are dark only (no evidence of light). Colour values match for dark (pixel-checked), so tokens are right.
5. Replica font is InterVariable; screenshots look like Inter/SF-like sans (cannot tell for certain). Mono in the code editor looks Fantasque-like.
6. Replica `.tabs` / `.tab` (components.css) is a small segmented control, not the real horizontal chat strip; the real one is `.tabstrip-*` in chat.css.
7. The replica has no terminal, browser or code editor styling to check; file tree CSS exists and matches shot 15 (30px rows, 16px indent).

## 8. Is `packages/ui/src/styles/kat.css` the kat-replica theme? NO.
It is a different, dark-only theme that borrows kat's structure: same section layout, same layout constants (60/280/768/560), same type scale (11/12/13/14, 1.45), same spring easings, same "no borders" rule, same OKLCH `--l/--c/--cm/--hue` mechanism.
Differences:
- No light or mono variants, no `prefers-color-scheme`.
- Greys are inverted relative to kat: canvas L .193, sidebar .216 (sidebar LIGHTER than canvas) vs kat sidebar .144 darker than panel .184. Elevated .247 (kat .233/.243).
- `--hue 50` vs 55; neutral chroma 0.008 flat vs kat .003-.007.
- User bubble / accent: `--l-orange-fill .585, C .153, h40` bright orange (accent mark .751/.161/h47) vs kat user bubble .4196/.07 brown (accent .7075/.08).
- Text L .949 vs .884; muted .664 vs .768; faint .6 vs .669.
- Sans = system stack (SF) vs InterVariable; only Fantasque mono is bundled.
- Adds tokens kat lacks: `--rail-tab 44`, `--pin-circle 48`, `--row-avatar 28`, `--radius-row 20`, `--radius-field 999`, quote bar colours, Tailwind bridge, `--accent-hover`.
- Missing vs replica: `--panel-edge`-based light variant, hl-* syntax tokens (check), `--popover-shadow` naming, tooltip etc. (not audited line-by-line).
Action: replace the palette sections 2 of kat.css with the replica values above (dark block at least, optionally light), keep the structural tokens (rail/pin/row sizes) which already match kat measurements, and decide on the font (Inter is OFL and could be shipped, unlike SF).

Extra tokens yuki will need (replica lacks them): tab-strip tokens (tab height 28, max-w 172, pill bg), date-pill, calendar popover, command-palette row/shortcut chip, context-menu item/danger, file-tree (row 30, indent 16, guide), editor gutter/current-line (#1f1e1d), scroll-to-bottom button, clamp fade, reply-bar, empty-state, toast, kbd.

## 9. Proposed yuki screens / routes (derived from kat)

Shell: rail (60) + sidebar (280, collapsible, ⌘S) + panel with top bar. Rail tabs map to top-level routes:

| route | rail icon | sidebar | main | source |
|---|---|---|---|---|
| `/chat` | chat | `chat` header + `+`; pinned tiles; chat list | `/chat/new` composes ("to: + add someone", empty-state cat) | shots 9-14, 21 |
| `/chat/:id` | chat | same, row selected | horizontal tab strip (open chats) + transcript + composer; single-chat header variant when opened from a pinned tile | 9-14, 18-20 |
| `/chat/:id` overlays | | | context menu, calendar popover (date pill), reply bar, scroll-to-bottom, message search (⌘F), attachment/link-card bubbles | 12, 16, 17, 19 |
| overlay: command palette | global ⌘K / (kat shows ⌘P for go-to-chat) | | `type a command...` list | 20 |
| `/code` (and `/code/*path`) | `</>` | `code` header with new file/new folder + file tree | breadcrumb path top bar + code editor with line numbers | 15 |
| `/terminal` | `>_` | session list (est.) | **TO BE REPLACED**: full panel slot (280 sidebar + ~1039x737 panel) | rail only, no shot |
| `/browser` | globe | tab/history list (est.) | **TO BE REPLACED**: full panel slot, same dimensions | rail only, no shot |
| `/search` (suggested) | via top-bar magnifier | | search all chats (⌘⇧F) | top bar icon, palette |
| `/settings` (suggested, not in kat shots) | bottom-left pill glyph? | | notifications (the "notifications off" toggle), theme/hue, account | needs decision |
| share (modal/sheet) | top-bar share icon | | share chat | 9-21 icons, palette |

The two "to be replaced" slots should be built as empty route shells that reuse the panel container (rounded 32px corner, top bar, optional sidebar content) so the replacement features drop in without layout changes. Suggest also reserving `lock`, `mute`, `mark as unread`, `reopen closed` (⌘⇧T) behaviours from the menu/palette.
