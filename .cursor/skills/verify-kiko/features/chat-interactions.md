# Chat interactions

Everything a reader can do to a message: open its menu, swipe it to reply, react to it, follow a reply back to what it answers, and see who is typing. The transcript is a conversation, not a document — the same message responds the same way whether the viewer wrote it or the agent did, with one exception the menu makes visible.

## Sub-features

- `menu-right-click` — right-clicking any message opens a menu; the viewer's and the agent's menus list the same actions except that only the viewer's carries `edit`.
- `swipe-to-reply` — dragging a bubble sideways past its threshold arms a reply and the bubble snaps back; a vertical drag scrolls instead and never fires.
- `reactions-toggle` — a reaction badge toggles: adding one the viewer has given removes it, and the badge's count and pressed state follow.
- `reaction-badge` — badges are absolutely positioned circles overlapping the bubble's corner, drawn with a shadow ring rather than a border.
- `reply-quote` — a reply's quote is the first child of its bubble: the sender's label clamps to one line, the quoted text to two, and the text is cut on a grapheme boundary.
- `reply-quote-thumb` — a quote whose parent is an image carries a 32px thumbnail beside the text, and only that quote lays out as a row.
- `reply-jump` — clicking the quote scrolls the transcript to the message it answers.
- `unread-rule` — a rule sits before the first unread incoming message, is never the last row, and collapses out of the layout when it retires.
- `picker-search` — the emoji picker filters as you type and keeps a shortcode preview in its footer.
- `typing-bubble` — typing renders as an in-list bubble of three dots with no avatar and no visible label; the label is announced to screen readers instead.

## How to get to it (user POV)

- Right-click any message, yours or the agent's, to open its menu.
- Drag a bubble away from the other side of the conversation, then release, to reply to it.
- Click a reaction badge to add or remove your own reaction.
- Click the quoted block at the top of a reply to jump back to the message it answers.
- Pick a reaction from the menu to open the emoji picker, and type in its search field to filter.
- Send a message to watch the typing bubble appear for whoever is replying, and the unread rule retire.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- **The harness has never been run in a real browser.** It is verified by typecheck and by unit tests over `FIXTURE_STATES`, not by a live render. Load `http://127.0.0.1:3001/src/chat/harness.html?state=today` once, confirm it mounts and `window.__chat.probe()` returns a populated object, and treat a blank or throwing page as the finding it is before running anything below.
- **`openMenu` and `openPicker` report what happened, they do not guarantee it.** They dispatch real `contextmenu` and `pointerdown`+`pointerup`+`click` events on the row, then check whether a portalled dialog appeared. **Read the boolean and `probe().overlay`; do not assert `true`.** A `false` means no dialog opened, and that is a finding to report rather than a step to work around.
- Drive `http://127.0.0.1:3001/src/chat/harness.html?state=<slug>`, wait for `page.waitForFunction(() => typeof window.__chat === "object", undefined, { timeout: 15000 })`, and confirm `probe().dateChip` before measuring.
- A **message id** for `openMenu` / `openPicker` / `setReplyTarget` is `document.querySelector(".chat-row").dataset.messageId`, read from the DOM immediately before each call. A row index is not an id: the transcript renumbers as it scrolls.
- Every recipe here is virtualized. Re-query the target immediately before each action, because a scroll detaches rows.

Selectors this feature relies on, all on disk today:

| Handle | Element |
| --- | --- |
| `.chat-row` | the row, also `[data-component="chat-row"]`; carries `data-message-id`, `data-side`, `data-run`, `data-gap`, `data-replying` |
| `[data-component="chat-quote"]` | the reply preview, also `.chat-quote`; first child of the bubble |
| `.chat-quote__label` / `.chat-quote__text` | the clamped sender label and the clamped quoted text |
| `.chat-quote__thumb` | the 32px image thumbnail, present only when the parent is an image |
| `[data-component="chat-row-time"]` | the hover-revealed timestamp, also `.chat-row-time` |
| `[data-component="chat-unread-rule"]` | the new-messages rule, labelled `new messages`: `.chat-unread-slot` wrapping `.chat-unread` and `.chat-unread__label`, with `[data-retiring]` collapsing the slot |
| `[data-component="chat-swipe-row"]` | the swipe wrapper, with `[data-swiping]` while the gesture is live and `[data-swipe-side="bot\|user"]` naming the direction |
| `[data-component="chat-swipe-indicator"]` | the arrow revealed during the swipe, and the thing to measure to know the gesture is live |
| `[data-component="chat-typing-slot"]` | the container the transcript renders the typing row into; `.chat-typing-row` lives inside it |
| `[data-component="chat-menu"]` | the portalled menu; `.chat-menu__quick` holds five `.chat-menu__emoji` buttons, and `.chat-menu__danger` is the delete action |
| `[data-component="chat-reaction-stack"]` | the badge stack, `data-side="user\|bot"` |
| `[data-component="chat-reaction-badge"]` | one badge, carrying `data-emoji`, `data-count` and `aria-pressed` |
| `[data-component="chat-emoji-picker"]` | the picker: `__search` / `__input`, `__tabs` / `__tab`, `__viewport`, `__group-label`, `__row`, `__cell`, `__preview` / `__preview-emoji` / `__preview-label` / `__preview-name`, `__empty` |
| `.chat-typing-row` | the in-list typing row, `role="listitem"`, wrapping `.chat-typing-bubble` and its three `.chat-typing-dot` |

The menu, picker and reaction names come from the interaction owner and are not yet visible to the harness owner, so the harness's own checks for them are looser than these. That is why the two recipes below read the return value rather than asserting a dialog opened.

- **Read the message id off the DOM before probing.** Observe: the harness takes a message id, and a row index is not one.
  - Run `page.evaluate(() => document.querySelector(".chat-row").dataset.messageId)` and pass that string to the probe. A `null` here blocks every recipe that takes an id, and is a handle to report rather than a value to guess.

- **The menu is the same on both sides, minus `edit` for the agent.** Observe: right-clicking the viewer's message and the agent's message each open a menu with a five-emoji quick strip, then reply, copy, pin, and delete; only the viewer's inserts `edit` before delete.
  - Load `today`, read one id per side with `page.evaluate(() => [...document.querySelectorAll(".chat-row")].map((r) => ({ id: r.dataset.messageId, side: r.dataset.side })))`, then call `window.__chat.openMenu(viewerId)` and **log its return value alongside `probe().overlay`**. Both are observations, not assertions: a `false` with `overlay` of `null` means the menu did not open, and that is a finding to report, not a step to retry. When it does open, read the actions with `page.evaluate(() => { const m = document.querySelector('[data-component="chat-menu"]'); return { quick: [...m.querySelectorAll(".chat-menu__emoji")].map((b) => b.dataset.emoji), actions: [...m.querySelectorAll("button")].filter((b) => !b.classList.contains("chat-menu__emoji")).map((b) => b.textContent.trim()), danger: !!m.querySelector(".chat-menu__danger") }; })`.
  - `quick` holds five emoji, `actions` is the ordered action list, and `danger` is `true`. Repeat for the agent's id: `actions` is the same list with `edit` removed and one entry shorter. Write both opens' return values and both action lists to `/tmp/kiko-verify-evidence/chat-menu.json` — the artifact needs the `false` case as much as the `true` one.
  - Read `probe().overlay` before the DOM: an `overlay` of `null` with the previous menu still in the document is a stale read, not an open menu. Close with `page.keyboard.press("Escape")` and confirm `overlay` is `null` before the second open.
  - An `edit` on the agent's menu is a defect even when every other action is right. Re-open the viewer's menu last and confirm `edit` is back, which proves the difference follows the side rather than the click order.

- **Swipe fires past its threshold, in the sender's direction.** Observe: a drag that crosses the axis lock past 48px arms a reply; a shorter one leaves no trace.
  - Load `today`, read a row's centre and its side with `page.evaluate(() => { const r = document.querySelector('[data-component="chat-row"]'); const b = r.querySelector(".chat-bubble").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, side: r.dataset.side }; })`. Drag **right** for a `bot` row and **left** for a `user` row — the indicator sits at `left: 16px` for a bot row and `right: 16px` for a user row, so dragging away from the sender is what reveals it. Dragging the other way scrolls or does nothing.
  - Move in several steps, not one jump: `page.mouse.move` to the centre, `mouse.down()`, then successive `mouse.move` calls, then `mouse.up()`. Read the live state mid-drag with `page.evaluate(() => { const row = document.querySelector('[data-component="chat-swipe-row"]'); return { swiping: row.hasAttribute("data-swiping"), side: row.getAttribute("data-swipe-side"), indicator: (() => { const i = row.querySelector('[data-component="chat-swipe-indicator"]'); return i ? getComputedStyle(i).display : null; })() }; })`.
  - Mid-drag past the lock, `swiping` is `true` and the indicator's computed `display` is `flex`; a tap or a sub-threshold drag leaves `swiping` `false` and the indicator at `display: none`, which is the point — nothing is drawn until the axis lock is decided.
  - On release, `probe().replyTarget` names the message and the row carries `data-replying`. A drag in the wrong direction, or one that never passed the lock, arms nothing. Write the threshold you found and the resulting `replyTarget` alongside the menu artifact.

- **A vertical drag scrolls and never replies.** Observe: a drag that is mostly vertical moves the scroller and arms nothing.
  - Repeat the drag with the movement split so the dominant axis is vertical, then read `probe().replyTarget` and `data-replying` across every row alongside the scroller's `scrollTop`. The offset moved and nothing is armed.
  - Run it immediately after a horizontal drag that did arm, so the assertion cannot pass on a run that could never arm anyway. A vertical drag that clears the armed row means the gesture is not honouring `touch-action: pan-y` and the two paths have merged.

- **Reaction badges toggle.** Observe: clicking a badge the viewer has given removes it; clicking one they have not given adds the viewer's.
  - Load `reactions`, then for each badge read `{ emoji, count, pressed }` from `data-emoji`, `data-count` and `aria-pressed`, click the badge by its `[data-emoji]`, and re-read the same three. `aria-pressed` is `true` only on the viewer's own badges, and its background is the user fill rather than the resting one.
  - Click a second time and the badge returns to its original count and pressed state — a toggle that only adds is a defect, and a single click cannot tell add from replace. Write the before/after pairs to `/tmp/kiko-verify-evidence/reactions.json`.

- **Badges are circles with a shadow ring, not bordered discs.** Observe: each badge is 28px tall, absolutely positioned so badges overlap each other by 8px, and separated from the bubble by a shadow ring.
  - Run `page.evaluate(() => [...document.querySelectorAll('[data-component="chat-reaction-stack"]')].flatMap((s) => [...s.querySelectorAll('[data-component="chat-reaction-badge"]')]).map((n) => { const mc = getComputedStyle(n); const r = n.getBoundingClientRect(); return { height: Math.round(r.height), radius: mc.borderRadius, position: mc.position, marginRight: mc.marginRight, borderWidth: mc.borderWidth, boxShadow: mc.boxShadow }; }))`.
  - `height` is `28px`, `position` is `absolute`, `borderWidth` is `0px`, and `boxShadow` is not `none`. A badge drawing a 1px `border` instead of a shadow ring is a defect, and so is a badge in normal flow, because the overlap is the point.
  - The overlap is a negative `margin-right` of `-8px` on every badge after the first, so read the *computed* `marginRight` and confirm it is negative for all but the first badge. A stack with zero margin is a row of separate pills, which is the defect a screenshot makes look fine.
  - The stack is anchored to the bubble's corner with a `data-side` of its own, so a stack on a `user` row and one on a `bot` row sit on opposite corners. A stack on the wrong side is a defect even when its geometry is right.

- **A reply's quote is the bubble's first child, and it clamps.** Observe: the quote sits above the body, its label on one line and its text on two, with an ellipsis rather than a cut grapheme.
  - Load `reply-text` and run `page.evaluate(() => { const b = [...document.querySelectorAll(".chat-bubble")].find((n) => n.querySelector(".chat-quote")); const q = b.querySelector(".chat-quote"); const label = q.querySelector(".chat-quote__label"); const text = q.querySelector(".chat-quote__text"); const ls = getComputedStyle(label); const ts = getComputedStyle(text); return { isFirstChild: b.firstElementChild === q, labelOverflows: label.scrollWidth > label.clientWidth, labelClamp: ls.textOverflow + "/" + ls.whiteSpace, textClamp: ts.webkitLineClamp, textOverflows: text.scrollHeight > text.clientHeight, cursor: getComputedStyle(q).cursor, text: text.textContent.trim() }; })`.
  - `isFirstChild` is `true` — the quote is inside the bubble's shape, not a detached box above it. `cursor` is `pointer`. The label clamps with `ellipsis` and `nowrap`; the quoted text carries `textClamp` `"2"` and both report overflowing. The quote is **two** clamped lines, a one-line label above a two-line text, so an assertion of "one line total" is wrong and an assertion that nothing clamps is a defect.
  - The text is cut on a grapheme boundary at a 140-character budget: the character before the ellipsis is a whole emoji or letter, never half a surrogate pair or a severed combining sequence. Assert `text.endsWith("…")` only for a parent longer than the budget; a short parent is shown whole with no ellipsis.

- **An image parent's quote carries a thumbnail.** Observe: a reply to an image shows a 32px square beside the quoted text, and that quote lays out as a row.
  - Load `reply-image` and run `page.evaluate(() => { const q = document.querySelector(".chat-quote"); const img = q.querySelector(".chat-quote__thumb"); const r = img.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), direction: getComputedStyle(q).flexDirection, hasText: q.querySelector(".chat-quote__text").textContent.trim().length > 0 }; })`.
  - `width` and `height` are both `32`, `direction` is `row`, and the quote still carries text. A thumbnail that replaced the parent's text, a text quote with no thumbnail on an image parent, or a thumbnail in a quote still laying out as a column is a defect. Read the same fields on `reply-text` in the same run to show the two quotes differ.

- **Clicking the quote jumps to its parent.** Observe: the transcript scrolls to the message the quote names, and that message lands at the top of the viewport.
  - Click `.chat-quote`, then compare the parent's `getBoundingClientRect().top` against the scroller's. They match within a pixel, and the parent is in the DOM after the jump even if the virtualizer had to mount it.
  - Find the parent by its text: the quote carries the parent's words, so match a row's `.chat-text` against the quote's text. **Pending:** the quote exposes no parent id yet, and there is no jump probe on the harness, so match on text and say in the artifact that the target was resolved by content rather than by id. Do not assert a jump against an id you guessed.
  - If the parent sits within a viewport of the transcript's end, the scroller is already at its bottom and an align-to-top request clamps. Record that as a clamp, not a failure.
  - Write the quote's clamp readings and the scroll delta to `/tmp/kiko-verify-evidence/reply-jump.json`.

- **The unread rule sits before the first unread incoming message, and is never last.** Observe: in the `unread` state the rule is mounted, is not the final row, and the message it marks is an incoming one with rows below it.
  - Load `unread`, scroll until the rule is on screen, then read `window.__chat.probe().unreadRule` and `page.evaluate(() => { const rows = [...document.querySelectorAll('[data-component="chat-vrow"]')]; const idx = rows.findIndex((r) => r.querySelector('[data-component="chat-unread-rule"]')); return { index: idx, total: rows.length, marked: rows[idx + 1]?.querySelector(".chat-row")?.dataset.side, label: rows[idx]?.querySelector(".chat-unread__label")?.textContent?.trim() }; })`.
  - `unreadRule` is `true`, `index` is greater than `-1` and less than `total - 1`, and the row after it is an incoming (`data-side="bot"`) row. The label is lowercase. A rule rendered after the last unread message, or before the viewer's own message, is a defect: the viewer never gets an unread marker on their own words, and a rule under the final message marks nothing.
  - `probe().unreadRule` reflects the mounted DOM, and a rule outside the virtualized window legitimately is not mounted. Write the position to `/tmp/kiko-verify-evidence/unread-rule.json`.

- **The unread rule retires when the viewer sends.** Observe: after the viewer sends, the rule collapses out of the layout and every message reads as read.
  - **Pending — no send path exists.** The harness exposes `setState`, `setTyping`, `setReplyTarget`, `openMenu` and `openPicker`; none of them sends a message, and the composer is not mounted in the chat surface, so no user path retires the rule. This recipe cannot run until a send path lands.
  - When it does, the retirement is a layout collapse rather than a fade: `[data-retiring]` on `.chat-unread-slot` sets `grid-template-rows: 0fr` and `.chat-unread-clip` clips the overflow. Assert that the slot's `grid-template-rows` reads `0fr` and its height falls to 0. A rule that fades out is a defect, and one that collapses over a transition is a second one.

- **The picker filters as you type and previews a shortcode.** Observe: typing in the picker's search narrows the grid, and the footer's preview updates to the highlighted emoji's shortcode and name.
  - Load `today`, call `window.__chat.openPicker(messageId)`, and **log its return value alongside `probe().overlay`** — again an observation, not an assertion. A `false` means no picker opened; report it. When it does open, read `page.evaluate(() => { const p = document.querySelector('[data-component="chat-emoji-picker"]'); return { cells: p.querySelectorAll(".chat-emoji-picker__cell").length, groups: [...p.querySelectorAll(".chat-emoji-picker__group-label")].map((n) => n.textContent.trim()), tabs: [...p.querySelectorAll(".chat-emoji-picker__tab")].map((n) => n.getAttribute("aria-label")), preview: p.querySelector(".chat-emoji-picker__preview-label")?.textContent?.trim() ?? null, name: p.querySelector(".chat-emoji-picker__preview-name")?.textContent?.trim() ?? null }; })`.
  - `cells` is non-zero, every `tabs` entry matches a `groups` entry, and `preview` is a shortcode in lowercase.
  - Then `page.fill` on `.chat-emoji-picker__input` with `fire` and re-read: `cells` drops, and the group labels narrow to the matching one. Then fill it with a string that matches nothing: `cells` is `0` and `.chat-emoji-picker__empty` is present, rather than the previous list left in place. Clear the field and confirm the full grid returns — a filter that only ever removes is a defect.
  - Write the counts, group labels and preview text to `/tmp/kiko-verify-evidence/picker.json`.

- **Typing is three dots, with the label for screen readers only.** Observe: an in-list bubble of three 6px dots appears while someone is typing; nothing readable is drawn, and an `aria-live` region carries the words.
  - Load `today` with `?typing=Ada` in the URL, or call `window.__chat.setTyping(["Ada"])`, confirm `probe().typing` is `true`, and run `page.evaluate(() => { const row = document.querySelector('[data-component="chat-typing-row"]'); const dots = [...(row?.querySelectorAll(".chat-typing-dot") ?? [])]; const live = document.querySelector('.sr-only[role="status"]'); const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); const visible = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement.closest(".sr-only")) visible.push(n.textContent); return { inList: !!row?.closest('[data-component="chat-vrow"]'), role: row?.getAttribute("role"), dotCount: dots.length, dotSize: dots[0] ? getComputedStyle(dots[0]).width : null, dotAnimation: dots[0] ? getComputedStyle(dots[0]).animationName : null, hasAvatar: !!row?.querySelector("img, [class*=avatar]"), visibleText: visible.join("").trim(), liveRole: live?.getAttribute("role"), livePoliteness: live?.getAttribute("aria-live"), liveText: live?.textContent?.trim() ?? null }; })`.
  - `inList` is `true` and `role` is `listitem` — the bubble is a row in the transcript, not a footer strip. `dotCount` is `3` and `dotSize` is `6px`. `hasAvatar` is `false`. `visibleText` is empty **after the tree walk, not before**: the name lives in an `.sr-only` span inside the row, so a plain `textContent` read is non-empty and would look like a drawn label. `liveRole` is `status`, `livePoliteness` is `polite`, and `liveText` names who is typing.
  - Then call `setTyping([])` and re-read: `probe().typing` is `false`, the row is unmounted, and the live region stops announcing. A typing bubble that lingers after `setTyping([])` is a defect.
  - The dots' wave is one of the three permitted animations, so `dotAnimation` is set and not `none` — a typing indicator with no animation is a defect too. Write the readings to `/tmp/kiko-verify-evidence/typing.json`.

## Gotchas

- **Menus and pickers portal out of the column.** Scope them by `[data-component="chat-menu"]` and `[data-component="chat-emoji-picker"]`, never by a bubble or column ancestor. A portalled menu is also a common source of a stray non-zero `transition-duration`; the no-animation probe in [Chat bubbles](./chat-bubbles.md) must include it.
- **The menu's own trigger is not a thing to click.** `.chat-menu__trigger` is a zero-size `position: fixed` anchor that only receives a replayed `contextmenu` event so Kobalte's positioning has something to anchor to. It is never visible and never hittable; asserting anything about it, or trying to click it, is a dead end. Drive the menu with `openMenu` or a real right-click on a row.
- **The menu's quick strip is buttons, not menu items.** `[role="menuitem"]` misses the five emoji buttons, so a recipe that counts menu items undercounts by five. Read the emoji strip and the action list separately, as the recipe does.
- **`openMenu` and `openPicker` return whether a dialog actually opened.** Read the return value and `probe().overlay`. A `false` with a previous overlay still in the document is a no-op, not an open menu, and the DOM read alone will happily return the stale one.
- **The swipe direction depends on the sender.** A `bot` row drags right, a `user` row drags left. Dragging the other way is the surest way to prove nothing, because it neither arms a reply nor scrolls.
- **The swipe indicator only paints past the axis lock.** `[data-swiping]` gates it with `display: none`, so a tap correctly leaves no trace. An indicator visible on a tap means the lock is not deciding the axis, which is the defect the vertical-drag recipe exists to catch.
- **The typing label is in the DOM but not on screen.** It lives in an `.sr-only` span inside the typing row, so any assertion based on `textContent` alone reports a visible label that is not there. Walk the text nodes and exclude `.sr-only`, or assert the row's rendered geometry instead.
- **The radii in this file are on the `--brm` idiom, unlike the transcript's.** `.chat-menu` 20px, `.chat-emoji-picker` 16px, its search 10px, its cell 8px and `.chat-typing-bubble` 18px are all `calc(Npx * var(--brm))`, matching kat's reference stylesheets, while `chat.css` uses literals. On a browser without `corner-shape: squircle` these read half. **A halved corner here is the token system working — do not report it as drift and do not "fix" it.** The one worth knowing is `.chat-typing-bubble`: it asks for the same 18px as `.chat-bubble` but through the idiom, so it reads a few pixels rounder than the message bubbles beside it. That gap is known and owned; read it against the token.
- **A reaction count that only grows is the usual failure.** Toggle the same badge twice and compare all three readings each time; a single click proves add and cannot distinguish it from a replace.
- **The quote clamps to two lines, not one.** The sender's label is a one-line ellipsis and the quoted text is a two-line clamp. An assertion written from either alone will fail against a correct quote, so read both in one pass.
- **`bun test` resolves `solid-js` to its server build**, where `createMemo` never re-runs. A unit test that derives state with `createMemo` will pass on a stale value and prove nothing. Anything derived belongs in these browser recipes, not in a `bun test`.
- **Geometry measured in a fallback face is not a measurement.** Nothing here depends on a font beyond the token layer, but wait for the fonts before reading sizes — see [Kat token layer](./kat-tokens.md).
