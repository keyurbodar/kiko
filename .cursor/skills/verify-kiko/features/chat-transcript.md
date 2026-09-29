# Chat transcript

A user with a conversation open reads it as one linear column: text on a background, no bubbles. Consecutive messages from one sender collapse into a run that carries the sender's avatar and name once at its top. A reader can react to a message, reply to one inline, jump back to a message a reply answers, and return to the latest message after scrolling away.

## Sub-features

- `transcript-linear` renders messages as one column of text rows, each with a stable `data-message-id`.
- `transcript-run-collapse` folds consecutive messages from one sender into a run: the avatar and name appear on the run's first row, later rows indent with neither and carry `data-continuation="true"`.
- `transcript-day-divider` renders a divider at each change of day, pinned to the top of the scroll viewport while its messages are on screen.
- `transcript-gutter-time` shows a run's later messages' timestamps in the gutter, revealed on hover only.
- `transcript-reactions` renders a chip per reaction with its count; a chip the viewer has given carries `data-mine="true"`.
- `transcript-reply` renders an inline reply as a quoted line above its own body, with the replied-to message's id on `data-reply-to`.
- `transcript-reply-jump` jumps to the message a reply answers when the quoted line is clicked.
- `transcript-actionbar` reveals a hover action cluster on any row, holding three quick reactions, the full picker, reply, and copy.
- `transcript-copy` acknowledges a copy by turning the copy icon into a check for one second. It raises no toast.
- `transcript-jump-pill` offers a return to the latest message once the viewport is away from the bottom, and never yanks the view on arrival.
- `transcript-waiting` shows a pulsing dots row while a bot's presence is `typing` or `working`, and unmounts the moment it is not.
- `transcript-virtualized` renders only the rows near the viewport, so the DOM count tracks the viewport rather than the message count.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. The transcript is the page; there is no navigation and no router.
- Hover a message row to reveal its action cluster.
- Click the quoted line above a reply to jump to the message it answers.
- Scroll away from the bottom to reveal the jump pill; click it to return.

## Driving it with ego-browser

Preconditions: dev server owned by this run per `../SKILL.md` **Launch**, on port 3001 unless a sibling checkout owns it; `../SKILL.md` **Doctor** reports `ok: true`. Evidence to `/tmp/kiko-verify-evidence/`.

- **It renders a column and opens at the newest message.** Observe: rows exist and the scroller is at its bottom.
  - `await page.waitForSelector("[data-component=chat-row]", { timeout: 20000 })`
  - `page.evaluate` reading `scrollHeight - clientHeight - scrollTop` on `[data-component=chat-scroll]`. Result is under 32, and no `[data-component=chat-jump-slot]` is present.

- **Runs collapse.** Observe: the first row of a run carries an avatar and `[data-component=chat-author]`; the next row carries `data-continuation="true"` and neither.
  - Read `data-continuation` and the presence of `.chat-rail [data-component=avatar-v2]` across consecutive `[data-component=chat-row]` elements.

- **Reactions toggle.** Observe: clicking a chip the viewer has given removes it; the count and `data-mine` change.
  - Record the chip's `data-emoji` and `data-mine`, click `[data-message-id="<id>"] [data-component=chat-reaction]`, then re-read both.

- **A reply jumps to its parent at the top.** Observe: the replied-to row lands flush with the scroller's top.
  - Read `[data-reply-to]` from `[data-component=chat-reply-quote]`, click it, then compare the replied-to row's `top` against the scroller's `top`. They match within a pixel.
  - Exception: if the parent is within a viewport of the transcript's end, the scroller is already at its bottom and `align: start` clamps. Record the offset as a clamp, not a failure.

- **Copy acknowledges in place with no toast.** Observe: the button's label flips to `Copied` and a check replaces the copy glyph; no toast element appears.
  - Click `[aria-label="Copy message"]`, then read `[aria-label="Copied"]` and `document.querySelectorAll('[data-component*="toast"]').length`. The count is 0. After a second the label is back.

- **The jump pill appears away from the bottom and returns.** Observe: the pill is absent while pinned, present after scrolling up, and gone again after clicking it.
  - Scroll up by writing `scrollTop` on `[data-component=chat-scroll]`, then read `[data-component=chat-jump-slot]`. Click `.chat-jump` and re-read.

- **The waiting row tracks presence.** Observe: `[data-component=chat-waiting]` exists only while a fixture bot's presence is `typing` or `working`.
  - Compare the presence of `[data-component=chat-waiting]` against the presences in `apps/web-solid/src/lib/fixtures.ts`.

- **Only the visible rows are in the DOM.** Observe: the `[data-component=chat-vrow]` count is far below the message count, and the first rendered row changes as the scroller moves.
  - Compare `document.querySelectorAll("[data-component=chat-vrow]").length` against the row count, then scroll and re-read.

## Gotchas

- The scroller is `[data-component=chat-scroll]`, not the window. `window.scrollTo` moves nothing; write `scrollTop` on the scroller.
- Setting `scrollTop` to a value it already holds fires no scroll event, so any state driven by scroll will not update. Move it to a different value.
- Rows are virtualized. An element captured before a scroll can be detached by the time you act on it; re-query by `data-message-id` immediately before each action.
- `page.hover` refuses a selector matching many rows. Scope it to one row, or move the pointer with `page.mouse.move` at the row's coordinates.
- A row ending a run reserves vertical space below its text, and the hover wash stops short of it. A wash that appears to end above the row's box is correct.
- The gutter timestamp is at `opacity: 0` until the row is hovered or focused. Reading it while not hovered returns an empty-visible element, not a missing one.
- `ButtonV2` overwrites `data-component` on its root, so a `data-component` passed to one is not readable. Match on class or `aria-label` instead.
- `page.evaluate(fn, a, b)` does not pass a second argument. Pass one object or one string.
