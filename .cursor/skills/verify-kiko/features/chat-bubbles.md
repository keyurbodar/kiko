# Chat bubbles

A user reading a Kiko conversation sees one centred column of messages, each in its own rounded bubble: the viewer's on the right in the warm user fill, the agent's on the left in the assistant fill. Consecutive messages from one sender collapse into a run whose corner points at the sender's side only on the last bubble, and the column opens already scrolled to the newest message.

## Sub-features

- `bubble-column` — the transcript is a single column capped at 768px and centred with `margin-inline: auto`, so bubbles never spread across a wide window.
- `bubble-width` — each bubble is `width: fit-content` with a `max-width: 80%` cap, so a short message reads as a short bubble and a long one stops growing.
- `bubble-sides` — the user's bubble carries the user fill and the warm bubble text; the agent's carries the assistant fill.
- `bubble-run-collapse` — consecutive messages from one sender inside the grouping window render as one run, and only the run's first row gets the extra top padding.
- `bubble-run-break` — a gap over 300 seconds, a change of sender, a change of calendar day, or a message that replies to something all break the run.
- `bubble-tail` — the run's final bubble clamps exactly one corner, on the sender's own side, down to the small radius.
- `bubble-jumbo` — a body that is one to three emoji clusters scales up, split into a single-emoji and a multi-emoji size; prose is never jumbo.
- `bubble-day-chip` — a floating chip names the day the reader is looking at, in lowercase, and it appears and disappears with that day's rows.
- `bubble-day-jump` — clicking the chip opens a month calendar; choosing a day scrolls the transcript to that day.
- `bubble-opens-newest` — the transcript arrives pinned to the newest message, not scrolled to the top.
- `bubble-no-border` — no bubble, chip, divider, quote or card draws a border; separation is a fill or a shadow.
- `bubble-no-animation` — nothing transitions except the swipe snap-back, the emoji press, and the typing wave.
- `chrome-lowercase` — every label the app draws is lowercase; a message body is never transformed.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. The transcript is the page. There is no sidebar, no top bar, and no router, so this is the only entry point a user has.
- Scroll up and back down to move between days and watch the date chip come and go.
- Click the date chip and pick a day to jump there.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- For every fixture state below, drive `http://127.0.0.1:3001/src/chat/harness.html?state=<slug>`, then `page.waitForFunction(() => typeof window.__chat === "object", undefined, { timeout: 15000 })`, and confirm `window.__chat.probe().dateChip` matches the state before measuring. Use `page.evaluate((slug) => window.__chat.setState(slug), "<slug>")` to move between states in one round; an unknown slug silently falls back to `today`, so a typo proves the wrong state rather than failing.

Selectors this feature relies on, all present in `apps/web-solid/src/chat/chat.css`:

| Handle | Element |
| --- | --- |
| `[data-component="chat-scroll"]` | the scroller, `.chat-scroller` |
| `[data-component="chat-surface"]` | the transcript root, which owns the scroller and the column |
| `[data-component="chat-column"]` | the centred content column, also `.chat-column`, capped at `--content-max-w` |
| `[data-component="chat-vrow"]` | one virtualized row |
| `[data-component="chat-stage"]` | the positioned host for the jump pill and the scroll scrims, also `.chat-stage` |
| `[data-component="chat-row"]` | one message row, also `.chat-row`; carries `data-message-id`, `data-side="user\|bot"`, `data-run="start\|mid\|bot"`, `data-gap` on a run start, and `data-replying` when it is the armed reply target |
| `.chat-bubble` | one message bubble; always paired with `.chat-bubble--user` or `.chat-bubble--bot`, optionally `--jumbo-single` / `--jumbo-group` |
| `.chat-text` | the message body, where the sender's message text lives |
| `[data-component="chat-divider"]` | a day-divider row, also `.chat-divider`, with `.chat-divider__label` and `.chat-divider__time` |
| `[data-component="chat-date-chip"]` | the floating date chip's anchor, also `.chat-chip-anchor`; it is `display: none` without `[data-visible]`, and gains `[data-open]` when the month grid is mounted |
| `.chat-chip` | the chip trigger, a `button` with `aria-expanded` |
| `.chat-calendar` | the month grid the chip opens, with `.chat-calendar__day` carrying `data-today`, `data-selected` and `data-disabled` |
| `[data-component="chat-unread-rule"]` | the new-messages rule: `.chat-unread-slot` wrapping `.chat-unread` and `.chat-unread__label`, with `[data-retiring]` collapsing the slot |
| `.chat-jump-latest` / `.chat-fades` | the pill and the scrims, which float on the scroller |

- **It opens pinned to the newest message.** Observe: the newest row is in view and the scroller sits at its bottom.
  - Run `page.evaluate(() => { const s = document.querySelector('[data-component="chat-scroll"]'); return { distanceFromBottom: s.scrollHeight - s.clientHeight - s.scrollTop, lastRow: [...document.querySelectorAll(".chat-row")].pop()?.textContent?.trim() }; })`. `distanceFromBottom` is under 32.
  - Run the same read on the composed app at `/`. A transcript that opens at the top is a defect, not a first-paint artifact — re-read after the virtualizer settles.

- **The column is 768px and centred.** Observe: the content column is capped and sits in the middle of the surface.
  - Run `page.evaluate(() => { const col = document.querySelector(".chat-column"); const surface = document.querySelector('[data-component="chat-surface"]'); const r = col.getBoundingClientRect(); const s = surface.getBoundingClientRect(); return { maxWidth: getComputedStyle(col).maxWidth, marginInline: getComputedStyle(col).marginInlineStart, width: Math.round(r.width), leftGap: Math.round(r.left - s.left), rightGap: Math.round(s.right - r.right), token: getComputedStyle(document.documentElement).getPropertyValue("--content-max-w").trim() }; })`.
  - `token` is `768px`, `maxWidth` resolves to `768px`, `marginInline` is `auto`, and `width` is at most 768. In a surface wider than 768, `leftGap` and `rightGap` are within a pixel of each other; equal gaps are the centring. A column pinned to the left is a defect even when every width reads correctly.
  - Narrower than 768 the column fills the surface and both gaps read 0. That is the correct end state below the cap, not a failed centring check.

- **Bubbles cap at 80% and shrink to content.** Observe: no bubble is wider than 80% of its row's content box, and a short message is much narrower than a long one.
  - Run `page.evaluate(() => { const row = document.querySelector(".chat-row"); const b = row.querySelector(".chat-bubble"); const mc = getComputedStyle(b); return { side: row.dataset.side, cap: parseFloat(mc.maxWidth), used: Math.round(b.getBoundingClientRect().width), padding: mc.padding }; })` on a short message, and again in the `long` state.
  - `maxWidth` computes to `588.8px` — 80% of the 736px row content box (the 768px row minus 16px of side padding per side), not 80% of the shell. In the `long` state `used` is exactly `588.8`, at the cap; on a short message it is well under it. **Assert the delta, not the keyword**: the computed `width` is the *used* value, so a bubble that shrinks correctly still reads a pixel value rather than `fit-content`. A `long` bubble that comes in under the cap means the cap is not binding; a short bubble at exactly the cap means the fit-content width is missing and every message renders as a slab.
  - `padding` is `7px 12px` on every bubble, which is what the row-height table assumes.
  - Re-run the same read across every row in the state and log the array, so one bubble at the cap and another at the full row width cannot hide. Write it to `/tmp/kiko-verify-evidence/chat-bubbles.json` and take `/tmp/kiko-verify-evidence/chat-bubbles.png` in the same run.

- **The two sides carry the two fills.** Observe: the user's bubble is the user fill with the warm bubble text, the agent's is the assistant fill.
  - Run `page.evaluate(() => { const root = getComputedStyle(document.documentElement); const read = (n) => root.getPropertyValue(n).trim(); return { userBubble: getComputedStyle(document.querySelector(".chat-bubble--user")).backgroundColor, assistantBubble: getComputedStyle(document.querySelector(".chat-bubble--bot")).backgroundColor, userRole: read("--user-bubble"), assistantRole: read("--assistant-bubble"), userText: getComputedStyle(document.querySelector(".chat-bubble--user")).color, userTextRole: read("--user-bubble-text") }; })`.
  - `userBubble` equals the resolved `--user-bubble` and `assistantBubble` the resolved `--assistant-bubble`, and the two are different colours. `userText` equals `--user-bubble-text`. A bubble whose background is `transparent` is a defect even when both roles resolve — the class is not applied.
  - `probe().tokens` carries the same four role values from the harness, so a mismatch between the two reads localises the fault to the stylesheet rather than the component.

- **The tail is on the run's last bubble only, on the sender's side.** Observe: within a run, the final bubble has exactly one corner clamped to the small radius, and that corner is the sender's own end corner.
  - Load `grouped`, then run `page.evaluate(() => [...document.querySelectorAll(".chat-row")].map((row) => { const b = row.querySelector(".chat-bubble"); const mc = getComputedStyle(b); return { side: row.dataset.side, run: row.dataset.run, topStart: mc.borderTopStartRadius, topEnd: mc.borderTopEndRadius, bottomStart: mc.borderBottomStartRadius, bottomEnd: mc.borderBottomEndRadius }; }))`.
  - The run flag is on the **row**. On every row with `data-run="bot"`, exactly one of the four corners resolves to `--radius-sm` (8px) while the other three resolve to `--radius-bubble` (18px) — `border-bottom-end` for a user row, `border-bottom-start` for a bot row, because the pointer reads as coming from the sender's side. On rows with `data-run="start"` or `"mid"` all four read the bubble radius. A row that is both the first and last of its run still carries `data-run="bot"`, so a single-message run has a tail too.
  - These are exact and browser-independent: no radius in the transcript uses the `calc(Npx * var(--brm))` idiom, so nothing halves on a browser without continuous corners. Read `mc.borderRadius` and the two end corners directly and compare them to `8px` and `18px`.
  - A tail on every bubble of a run, a tail on no bubble, or a tail on the wrong end corner is a defect — the last is the one that still looks like a tail.

- **A run of three collapses into one sender's block.** Observe: three consecutive messages from one sender share a run, and only the run's first row carries the extra top padding.
  - Load `grouped`, then read `window.__chat.probe().runs` together with `page.evaluate(() => [...document.querySelectorAll(".chat-row")].map((row) => ({ side: row.dataset.side, gap: row.dataset.gap ?? null, paddingTop: getComputedStyle(row).paddingTop })))`.
  - `probe().runs` matches the number of rows carrying `data-gap`, and the rows carrying `data-run="bot"` number the same. Exactly one row per run has `data-gap` and a computed `padding-top` of `8px`; every continuation row reads `1px`. A middle row that also reports `8px` means the row cannot tell a run break from a continuation.

- **A 300s gap breaks the run.** Observe: the message after the quiet stretch opens a new run.
  - Load `run-gap` and compare `probe().runs` against the same read on `grouped`. The gap state reports one more run for a comparable number of rows. The grouping window is 300000ms, so a gap strictly larger than five minutes splits a run and exactly five minutes does not.

- **A reply breaks the run.** Observe: the message that answers something else never tucks under the quoted one.
  - Load `run-break-reply` and `reply-text` and read `probe().runs` in each. A reply always opens its own run on both sides, which is why the two counts move together. A reply rendered as a continuation is a defect.

- **A pure-emoji body scales up; prose never does.** Observe: one emoji is the largest size, two or three are a step smaller, and any prose returns to the body size.
  - Load `jumbo-single`, `jumbo-group` and `jumbo-prose` in turn, and in each run `page.evaluate(() => [...document.querySelectorAll(".chat-row")].map((row) => { const b = row.querySelector(".chat-bubble"); return { classes: [...b.classList].filter((c) => c.startsWith("chat-bubble--")), fontSize: getComputedStyle(b).fontSize, lineHeight: getComputedStyle(b).lineHeight, height: Math.round(b.getBoundingClientRect().height) }; }))`.
  - `jumbo-single` reports a font size of `49px` and a line height of `61.25px`, `jumbo-group` reports `35px` and `43.75px`, and `jumbo-prose` reports `14px` and `20.3px`. The jumbo sizes are `3.5×` and `2.5×` the base with a `1.25` line height; the body size is `--font-base` with `--line-height`. A jumbo bubble reading any other ratio is wrong, and a prose bubble reading a jumbo size is worse — it means a mixed body was classified as pure emoji.
  - Counting is in grapheme clusters, so a variation selector or a ZWJ family is one emoji, and a fourth emoji is not jumbo at all. A bubble whose `classes` list carries a jumbo modifier while its computed `font-size` is `14px` is a defect the class list alone would have hidden.

- **The day chip names the visible day in lowercase.** Observe: the chip reads `today` over today's rows, `yesterday` over yesterday's, and a lowercase weekday name further back.
  - Load `today`, then `yesterday`, then `three-days-ago`, and in each read `window.__chat.probe().dateChip` and `page.evaluate(() => { const a = document.querySelector(".chat-chip-anchor"); const c = document.querySelector(".chat-chip"); return { visible: a?.hasAttribute("data-visible") ?? false, label: c?.textContent?.trim(), transform: c ? getComputedStyle(c).textTransform : null }; })`.
  - The three labels are `today`, `yesterday`, and a lowercase weekday such as `wednesday`, and every chip's `text-transform` computes to `lowercase`. A title-cased label is a defect even though the day is right. Weekday and month names are lowercase words, never `Wed` or `September`.

- **The chip appears and disappears with the day's rows.** Observe: it is present while today's rows are on screen and gone as soon as yesterday's rows are.
  - Load `today`, read `hasAttribute("data-visible")` on `[data-component="chat-date-chip"]`, then scroll the scroller up with `page.mouse.wheel` over `[data-component="chat-scroll"]` and re-read both the attribute and `probe().dateChip`. The anchor loses `data-visible` — and the chip's computed `display` becomes `none` — once the topmost visible row belongs to yesterday, and both return on the way back down. **Use the wheel, not a written `scrollTop`**: assigning the offset directly is not a user scroll, and the handler that writes `data-visible` is exactly what this recipe is proving.
  - Write the per-state label and visibility to `/tmp/kiko-verify-evidence/day-chip.json`.

- **Clicking the chip jumps to a chosen day.** Observe: a month calendar opens, and choosing a day scrolls the transcript there.
  - Click `.chat-chip`, then read `page.evaluate(() => { const a = document.querySelector(".chat-chip-anchor"); return { expanded: document.querySelector(".chat-chip").getAttribute("aria-expanded"), open: a?.hasAttribute("data-open") ?? false, calendar: !!document.querySelector(".chat-calendar"), todayMarked: document.querySelectorAll(".chat-calendar__day[data-today]").length, title: document.querySelector(".chat-calendar__title")?.textContent?.trim() }; })`. `expanded` is `"true"`, the anchor has `data-open`, the calendar exists, exactly one day is marked `data-today`, and `title` is a lowercase month and year.
  - Click a `.chat-calendar__day` that is neither `[data-today]` nor `[data-disabled]`, then re-read `probe().dateChip`, the scroller's `scrollTop` and the anchor's `data-open`. The chip's label matches the day chosen, `data-open` is gone and `aria-expanded` is back to `"false"`. If the chosen day was outside the virtualized window, the chip reports the day the reader landed on rather than the one clicked; that is the jump working, not a stale label.
  - The calendar hangs off the chip's own anchor with no portal, so scope its cells by `.chat-calendar__day`, never by a row or column ancestor.

- **Nothing draws a border.** Observe: the computed border width is `0px` on every bubble, chip, divider, quote and card.
  - Run one `page.evaluate` that queries every surface selector in a single pass — `.chat-bubble`, `.chat-row`, `.chat-divider`, `[data-component="chat-unread-rule"]`, `.chat-unread__label`, `.chat-quote`, `.chat-chip`, `.chat-calendar`, `.chat-jump-latest > button`, `.chat-link-card`, `[data-component="chat-menu"]`, `[data-component="chat-reaction-badge"]`, `[data-component="chat-emoji-picker"]`, `.chat-typing-bubble` — and maps each match to `{ selector, borderTopWidth: getComputedStyle(node).borderTopWidth, borderWidth: getComputedStyle(node).borderWidth, boxShadow: getComputedStyle(node).boxShadow !== "none" }`.
  - Log `{ matchCount, violations }` and write both to `/tmp/kiko-verify-evidence/no-border.json`. Every `borderWidth` is `0px`, and `matchCount` is greater than zero — a run that logged zero violations over a selector that matched nothing has proved nothing. Where a surface needs a hairline, `boxShadow` is not `none`: that is the correct separator. The unread rule's own 1px rules are `::before` and `::after` pseudo-elements, so they are not in this list; read them with `getComputedStyle(node, "::before")` if the rule ever grows a real border.
  - The `--border` role is `none`, so a slice that asks for a border renders nothing and still screenshots cleanly. This probe is the only thing that catches it.

- **Nothing animates except three places.** Observe: no bubble, chip, menu, divider or card carries a transition or an animation.
  - Run one `page.evaluate` over the same surface list, mapping each match to `{ selector, transitionDuration: getComputedStyle(node).transitionDuration, animationName: getComputedStyle(node).animationName }`, and additionally read the swipe row, a `.chat-menu__emoji` button, a `.chat-emoji-picker__cell`, a `.chat-reaction-badge` and each `.chat-typing-dot` — those are where the three permitted motions actually live.
  - Write `{ matchCount, violations, allowed }` to `/tmp/kiko-verify-evidence/no-animation.json`. `violations` is empty for every surface: `transitionDuration` is `0s` and `animationName` is `none` across the board. The only rows allowed to carry a name are the swipe snap-back, the `scale(0.85)` press on an emoji button, a picker cell and a reaction badge, and the typing dots' wave. List the allowed rows in the artifact by name rather than filtering them out, so a fourth animation is visible.
  - The menu and the picker render in a portal outside the column, so a scope that stops at `.chat-column` misses them. The jump pill and the scroll scrims float on the scroller rather than scrolling with it, so they must be in the pass too.

- **Every label is lowercase; no body is transformed.** Observe: chrome labels compute `lowercase` and message bodies compute `none`.
  - Run one `page.evaluate` mapping `.chat-chip`, `.chat-empty__text`, `.chat-unread__label`, `.chat-jump-latest > button`, `.chat-calendar__title`, `[data-component="chat-menu"]` buttons, `.chat-emoji-picker__preview-label`, `.chat-emoji-picker__group-label`, the divider label and time, and every `.chat-text` body, to `{ role, sample: textContent?.slice(0, 40), textTransform: getComputedStyle(node).textTransform }`.
  - Every `.chat-text` reads `none`, and every chrome label reads `lowercase` with a `sample` that is already lowercase. An `uppercase` or `capitalize` value is a defect, and so is a label that is title-cased in the source while its transform reads `none`.
  - Run this against a fixture body that starts with a capital letter. A `capitalize` transform would be invisible on an all-lowercase body and is the reason the assertion reads computed style rather than trusting the source.

## Gotchas

- **The transcript is virtualized.** `document.querySelectorAll('[data-component="chat-vrow"]').length` tracks the viewport, not the message count, and an element captured before a scroll can be detached by the time you act on it. Re-query immediately before every measurement, and never compare a row count against a fixture's message total.
- **The scroller is `[data-component="chat-scroll"]`, not the window.** `window.scrollTo` moves nothing. Write `scrollTop` on the scroller, and move it to a value it does not already hold — assigning the same value fires no scroll event, so anything driven by scroll silently does not update.
- **The 80% cap is measured against the row's content box, not the column or the window.** The row is itself capped at 768px and carries 16px of side padding, so the cap lands at 588.8px, not 614px and not a share of the shell. Measuring against the surface reports a false failure on a narrow window and a false pass on a wide one.
- **Two radius conventions ship side by side, and the split is deliberate.** `chat.css` uses literals throughout — the bubble 18px, the tail 8px, the quote 11px, the chip 15px. `interactions.css` uses the `calc(Npx * var(--brm))` idiom for the menu 20px, the picker 16px, its search 10px, its cell 8px and the typing bubble 18px, which matches kat's own reference stylesheets. `--brm` is `0.5` by default and `1` under `@supports (corner-shape: squircle)`, so those five read half their nominal value on a browser that cannot draw a continuous corner. **A halved menu or picker corner is the token system working, not drift — do not "fix" it.** A halved *bubble* in `chat.css` would be drift, because that file is on literals.
- **The typing bubble is the one place the two conventions disagree.** `.chat-typing-bubble` asks for 18px through the idiom while `.chat-bubble` asks for the same 18px as a literal, so on a browser without squircle the typing bubble reads a few pixels rounder than the message bubbles beside it. The interaction owner has flagged it; until it is settled, read it against the token and do not report the difference as a defect.
- **`--font-base` is 14px on `body`; the root is 16px.** A rem-based measurement of bubble padding or font size reads 0.875x too small if you resolve it against the root. Read the computed `font-size` off the element itself.
- **The chip is hidden with `display: none`, not with opacity.** Assert the anchor's `data-visible` attribute or the chip's computed `display`; a `querySelector` that only checks for the element's existence finds a chip that is not on screen.
- **Setting `scrollTop` is not a user scroll.** A jump driven by writing the offset skips the scroll events a wheel would fire, so state that tracks *how* the reader arrived — the chip's `data-visible` among it — can differ. Where the recipe cares about that, use `page.mouse.wheel` over the scroller instead.
- **The harness is a page, not a route.** `/src/chat/harness.html` is a Vite multi-page entry; it is not in the app's router, and a 404 on any other sub-path is expected.
