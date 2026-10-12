# Composer

The composer is the dock below the transcript: where a reader types, what they see when they are replying to something, and the send that puts their words into the thread. It is the only surface that changes state, and the only one that lives exclusively in the composed app: the chat harness mounts the transcript alone, so nothing here is reachable from a fixture state.

## Sub-features

- `composer-dock`: the composer sits in flow at the bottom of the transcript pane, inside `[data-component="composer-dock"]`, below the transcript and above nothing.
- `composer-input`: the input is a `contenteditable` `<div>` carrying `[data-component="prompt-input"]`, wrapped by `prompt-input-box` and `prompt-input-v2`.
- `composer-send`: `Enter` sends, and the message lands in the transcript as the viewer's own row on the right.
- `composer-clear`: the input empties on send.
- `composer-reply-bar`: an armed reply shows a bar above the input naming the quoted sender and quoting their words, with a jump control and a `Cancel reply` button.
- `composer-reply-send`: sending while a reply is armed appends a **reply**, carrying the quote into the transcript rather than dropping it.
- `composer-scroll-down`: a square appears above the composer, centred over the chat column, whenever the reader is away from the latest message, and it disappears at the end.
- `composer-dock-scrolled`: the dock carries `data-scrolled` while the reader is not at the end, which is the state the scroll-down control is derived from.

## How to get to it (user POV)

- Open `http://localhost:<port>/` and click the field at the bottom of the conversation.
- Type a message and press `Enter` to send it.
- Hover a message and press its reply arrow, or choose Reply in its menu, and the reply bar appears above the input; press `Cancel reply`, or just send, to move on.
- Press the smiley button left of send to open the emoji picker; the pick goes in at the caret.
- Type `:` and two letters (at the start or after a space) to get a list of matching shortcodes. Arrows move, Enter or Tab inserts, Escape closes. Enter never sends while the list is open.
- Scroll up through the history and a down-arrow button appears above the composer, centred over the chat column; click it to return to the newest message.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/yuki-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- **This feature is `/`-only.** The chat harness mounts `MessageList` alone, so `[data-component="composer-dock"]` and `[data-component="prompt-input"]` are both `0` there: measured on a harness page. Every recipe below is a composed-app recipe, and a run that reaches for the composer in a fixture state is driving something that is not on the page.
- **Use `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`.** The server binds IPv6 loopback only; `curl` to `127.0.0.1:3017` exits `7` (connection refused) while `localhost:3017` answers `200`.
- **Every `page.goto` passes `{ waitUntil: "domcontentloaded", timeout: 60000 }`.** The transcript's media never finishes loading, so the default `load` wait never fires and the driver's default deadline rejects on a healthy page.

Selectors this feature relies on:

- `[data-component="composer-dock"]`: the dock; carries `data-scrolled` while the reader is away from the end.
- `[data-component="prompt-input"]`: the `contenteditable` `<div>` that takes the text.
- `[data-component="prompt-input-box"]` and `[data-component="prompt-input-v2"]`: the input's own wrappers.
- `[data-component="composer-reply-bar"]`: the armed-reply bar, with the class `.reply-bar`; its jump control is `.reply-bar-jump` and the cancel button carries `aria-label="Cancel reply"`.
- `[data-component="composer-scroll-down"]`: a 26px square centred over the chat column, with `aria-label="Jump to latest"`.
- `[data-component="chat-shell"]`: the pane; `data-reply-target` names the armed message, and `data-range` is the virtualizer's window.
- `[data-component="chat-row"][data-replying]`: the armed row in the transcript.

- **Confirm the composer is there, and that it is in flow.** Observe: the dock exists and sits at the bottom of the pane.
  - Load `/`, then run `page.evaluate(() => { const d = document.querySelector('[data-component="composer-dock"]'); const p = document.querySelector('[data-component="chat-shell"]'); const s = document.querySelector('[data-component="chat-scroll"]'); return { dock: !!d, position: getComputedStyle(d).position, dockBottom: Math.round(d.getBoundingClientRect().bottom), paneBottom: Math.round(p.getBoundingClientRect().bottom), scrollerBottom: Math.round(s.getBoundingClientRect().bottom), viewport: window.innerHeight, isLastChild: p.lastElementChild === d }; })`.
  - `dock` is `true` and `isLastChild` is `true`: the dock is the pane's last child, below the transcript. **The position is `relative`, not `absolute`, and that is load-bearing**: nothing between the dock and the viewport is a positioned ancestor, so `bottom: 0` would resolve against the window and the composer would span the whole page. A dock that is `absolute` here is a defect, and it shows up as a composer stretched across the full width rather than as a computed style.

- **Confirm the input is what you think it is.** Observe: the field is a contenteditable div with a send control.
  - Run `page.evaluate(() => { const n = document.querySelector('[data-component="prompt-input"]'); return { tag: n.tagName, contenteditable: n.getAttribute("contenteditable"), role: n.getAttribute("role"), box: !!document.querySelector('[data-component="prompt-input-box"]'), v2: !!document.querySelector('[data-component="prompt-input-v2"]'), buttons: [...document.querySelectorAll('[data-component="prompt-input"] button, .composer-dock button')].map((b) => b.getAttribute("aria-label") || b.className?.toString().slice(0, 30)), fileInputs: document.querySelectorAll('input[type=file][aria-label="Attach files"]').length }; })`.
  - **Measured:** `tag` is `DIV`, `contenteditable` is `"true"`, `role` is `"textbox"`, and the dock carries the attach button (`aria-label="Attach files"`), the emoji button (`aria-label="Emoji"`) and the send button (`aria-label="Send"`). **A `textarea` or a single-line `input` is not what is on the page**, so a recipe written for either will find nothing; drive the field with `page.mouse.click` on its centre and then `page.keyboard.type`.
  - `fileInputs` is `1`: the composer always holds one hidden `<input type="file" multiple aria-label="Attach files">`, beside the form rather than inside the field. The attach button clicks it; `agent-browser upload` can set files on it directly.

- **Send a message and watch three things change at once.** Observe: the input clears, a viewer row appears on the right, and the transcript scrolls to it.
  - Click the input's centre, `page.keyboard.type("try https://аррӏе.com and @ada now")`, then `page.keyboard.press("Enter")`. Wait ~1.2s and run `page.evaluate(() => { const rows = [...document.querySelectorAll('[data-component="chat-row"]')]; const last = rows[rows.length - 1]; const s = document.querySelector('[data-component="chat-scroll"]'); return { rowCount: rows.length, lastId: last?.dataset.messageId, lastSide: last?.dataset.side, lastText: last?.querySelector(".bubble-text")?.textContent, inputNow: document.querySelector('[data-component="prompt-input"]').textContent, distanceFromBottom: s.scrollHeight - s.clientHeight - s.scrollTop }; })`.
  - **Measured:** a new row appears with `side: "user"` and the typed text, and `inputNow` is `""`: the input cleared. The send is a real store mutation, not a local echo: it is `useApp.appendMessage` in the composed app.
  - **Assert the new row is the last one and on the right.** `lastSide` is `"user"`, and the bubble's `data-align` is `"end"`. A send that lands on the left, or that appends above the last row, is a defect.
  - The transcript is virtualized, so `rowCount` is the **viewport**, not the total. Never assert a send by a row count; assert by the new row's own text and side.

- **Arm a reply and read the bar.** Observe: the reply hover action on a message raises a bar naming who is being replied to and quoting them.
  - Load `/`, hover a row's `[data-slot="bubble-content"]`, then click that row's `[data-action="reply"]`.
  - Then run `page.evaluate(() => ({ shellReplyTarget: document.querySelector('[data-component="chat-shell"]').getAttribute("data-reply-target"), replying: [...document.querySelectorAll('[data-component="chat-row"][data-replying]')].map((r) => r.dataset.messageId), replyBar: document.querySelectorAll('[data-component="composer-reply-bar"]').length, barText: document.querySelector('[data-component="composer-reply-bar"]')?.textContent?.trim(), barButtons: [...document.querySelectorAll('[data-component="composer-reply-bar"] button')].map((b) => b.getAttribute("aria-label") || b.textContent.trim()) }))`.
  - **Measured:** the pane's `data-reply-target` names that message, the same row carries `data-replying`, and the bar renders with the quoted sender's name followed by the quoted text, plus two controls, the quote itself (the jump control) and a button labelled `Cancel reply`.
  - **The bar names the QUOTED sender, and the armed row paints nothing.** `data-replying` is state a probe reads, not a style hook: there is deliberately no ring on the armed row, so a `box-shadow` other than `none` on its `[data-slot="bubble-content"]` is a regression. See [Chat interactions](./chat-interactions.md).
  - Press `Cancel reply` and re-read: the bar is gone and `data-reply-target` is back to `null`. **Assert the bar disappears, not that the row changed.** The row never changed.

- **Sending while a reply is armed produces a reply, not a root message.** Observe: the sent row carries the quote.
  - Arm a reply as above, then type `agreed` and press `Enter`. Wait ~1.2s and run `page.evaluate(() => { const rows = [...document.querySelectorAll('[data-component="chat-row"]')]; const last = rows[rows.length - 1]; return { lastText: last?.querySelector(".bubble-text")?.textContent, hasQuote: !!last?.querySelector('[data-component="chat-quote"]'), quoteLabel: last?.querySelector(".chat-quote__label")?.textContent?.trim(), replyBar: document.querySelectorAll('[data-component="composer-reply-bar"]').length, shellReplyTarget: document.querySelector('[data-component="chat-shell"]').getAttribute("data-reply-target") }; })`.
  - `hasQuote` is `true` and `replyBar` is back to `0`. **This is the assertion that matters:** the composed app's `onSend` calls `useApp.appendReply` when a target is armed and `appendMessage` otherwise, and those are different mutations: a send that drops the quote clears the reply bar while the quote never reaches the transcript, which is a message with no parent and a composer that has forgotten why it was open.
  - Also assert the transcript **scrolled to the sent message**. `scrollToLatest` is called on send deliberately, and the alternative (`jumpToMessage`) would also arm the landing highlight, which is right when a reader clicks a quote to go find something and wrong here, because it flashes every message they send.

- **The scroll-down button appears only when there is somewhere to go.** Observe: it is present mid-history and gone at the end.
  - Load `/`, read `page.evaluate(() => document.querySelectorAll("[data-component='composer-scroll-down']").length)`: it is `0` at the bottom. Then set the scroller away from the end: `page.evaluate(() => { document.querySelector('[data-component="chat-scroll"]').scrollTop = 0; })`, wait ~500ms, and re-read `page.evaluate(() => ({ down: document.querySelectorAll("[data-component='composer-scroll-down']').length, aria: document.querySelector('[data-component="composer-scroll-down"]')?.getAttribute("aria-label"), dockScrolled: document.querySelector('[data-component="composer-dock"]')?.getAttribute("data-scrolled"), range: document.querySelector('[data-component="chat-shell"]')?.getAttribute("data-range") }))`.
  - **Measured:** `down` becomes `1`, the button's `aria-label` is `Jump to latest`, and the dock's `data-scrolled` becomes `"true"` while the pane's `data-range` reads something like `0-11`. Click it and re-read: `down` is back to `0` and `data-scrolled` is gone.
  - **Assert it never sits over the composer's own controls.** It is a 26px rounded square centred over the chat column, 8px above the dock, and it renders only when there is somewhere to go, so a control overlapping the composer's own controls is a defect. The `data-range` attribute is the cheapest way to confirm you are actually mid-history rather than trusting that a `scrollTop` write took effect.

- **Proof.** Write the send, the reply-arm and the scroll-down readings, including the before/after of `data-reply-target`, the bar's presence, and the sent row's `side` and quote. Write them to `/tmp/yuki-verify-evidence/composer.json`, in the same run that measured them.

## Gotchas

- **The composer does not exist in the chat harness.** Measured on a harness page: `[data-component="composer-dock"]` is `0`, `[data-component="prompt-input"]` is `0`, and `setReplyTarget` arms the transcript's `replyTarget` while rendering **no reply bar at all** (`replyBar` is `0` with a target armed, and no row carries `data-replying`). Every composer recipe is a `/` recipe, and the unread rule's *retirement* (which needs a send) is one too.
- **The input is a `contenteditable` `<div>`, not a `textarea` or an `input`.** Measured `tag: "DIV"`, `contenteditable: "true"`, and **`role="textbox"`**. A recipe that reaches for `textarea` or types into `[data-component="prompt-input"]` with `page.fill` will find neither. Click the element's centre with `page.mouse.click`, then `page.keyboard.type` and `page.keyboard.press("Enter")`.
- **`page.fill` will not work on it.** The field is not a form control; it is driven by keyboard input into a contenteditable node. Use click-then-type, and read the text back with `textContent`.
- **The send button is labelled `Send` (capital S), and the buttons beside it carry their own labels.** The composer is not part of the lowercase-chrome pass, which covers the transcript's own labels; a recipe that asserts every button in the app is lowercase will catch the composer's own `aria-label` and report a real thing that is out of scope. Scope the lowercase assertion to the transcript surfaces it names.
- **The scroll-down control reads `data-scrolled` on the dock, not its own visibility.** It is rendered by a conditional in the composed app, so the honest assertion is its **presence in the DOM** (`document.querySelectorAll("[data-component='composer-scroll-down']").length`), going `0 → 1 → 0`. Do not assert a computed `display`, because the element does not exist at all when it is hidden.
- **Emoji shortcodes and the emoji button.** Observe: `:lo` lists shortcodes with the typed part washed in accent; ArrowDown then Enter inserts that emoji in place of `:lo` and sends nothing; the smiley button's picker inserts at the caret.
  - Click `[data-component="prompt-input"]`, type `so :lo`, and read `[data-component="emoji-shortcode"]` rows: the first is `:lol:` (prefix matches first) and the list is at most 50. Press ArrowDown, then Enter: the input reads `so 😭` and no message was sent. Type ` :fire` and Tab: `🔥` (an exact shortcode ranks first).
  - Put the caret mid-text, click `[data-action="composer-emoji"]`, then a cell in `[data-component="emoji-picker"]`: the emoji lands at that caret and focus returns to the input.
  - Measured 2026-10-09 with agent-browser at 1280x820: all of the above held.

- **A written `scrollTop` is not a user scroll.** The dock's `data-scrolled` is derived from the transcript's reported scroll state, so move the scroller with `page.mouse.wheel` over `[data-component="chat-scroll"]` when the recipe is about that state, and use a direct write only when you are deliberately testing the far-from-bottom condition. Confirm with `data-range` that the transcript actually moved.
- **The reply bar's jump control's accessible name is its own quoted text, not a fixed label.** Measured: the two buttons in the bar report the quoted body as one name and `Cancel reply` as the other. **Locate the cancel button by `aria-label="Cancel reply"`, not by position or by `text`**, because the other button's text is the quote and changes per message.
- **An armed reply paints nothing on the row.** `data-replying` is state a probe reads, not a style hook, and the reply bar is the whole indication. A ring or any `box-shadow` on the armed row's content is a regression.
- **The transcript is virtualized, so a row handle can be detached between the click and the read.** Re-query `[data-component="chat-row"][data-replying]` immediately before reading it, and never assert a send by a row count.
- **A send while a reply is armed is a different store mutation from a plain send.** `appendReply` carries the quote; `appendMessage` drops it. Asserting only that the input cleared passes against both, and would have passed against the bug where the quote vanished from both surfaces.
- **The attachment input is always there, hidden.** It is `input[type=file][aria-label="Attach files"]`, outside `[data-component="prompt-input"]`. See [Message attachments and the image dialog](./chat-images.md).
- **A long paste is one text part, and the room keeps the whole text.** A paste with a line break, or one of 8000 characters or more, goes into the box as one text part (`largePaste` and `handlePaste` in `apps/web-solid/src/composer/prompt-input/attachments.ts`; `onPaste` in `interaction.ts`). Send is refused with "This message is too long to send." only when the frame does not fit, about 504 KB of JSON (`sendFits` in `core/protocol/src/attachments.ts`, through `sendRefusal` in `apps/web-solid/src/lib/attachments.ts`). An edit is capped at 16,000 characters. The server keeps the first 16,000 characters (and at most 64 KB of JSON) as the bubble and stores the full text as `message.txt` (`apps/server/src/room/whole-text.ts`).
- **Send waits for attachment uploads.** Each file uploads when picked; until all are ready the send button is disabled and its `aria-label` is the reason (`Attachment still uploading`, `Retry or remove the failed attachment`), not `Send`. See `composer-upload` in [Message attachments and the image dialog](./chat-images.md).