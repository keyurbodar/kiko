# Message media and the viewer

A message can carry pictures and clips, and they are things a user acts on: a single item is fitted into a bounded box, several become an album grid whose cells round only their outer corners, and clicking any of them opens a full-screen viewer where the item is at its natural size, can be zoomed and panned, and can be stepped through. A clip shows its poster frame with a duration badge rather than playing inline, and it is the viewer that plays it.

## Sub-features

- `media-single` — a single item is fitted into a box sized from the item's own dimensions, so a tall picture is bounded by height and a wide one by width.
- `media-album` — two or more items go through the album layouter, whose geometry depends only on the count. Each cell rounds **only the corners on the album's outline**, so a 2×2 has eight rounded corners, not sixteen.
- `media-bare-bubble` — a message carrying media drops the bubble's padding (`p-0` on the content) and hands it to the caption, so the picture sits flush inside the bubble's own radius. A media-only message therefore has no padding at all.
- `media-video` — a clip renders as its poster frame with a `m:ss` duration badge and a play mark, never as an inline `<video>`. Playing it is the viewer's job.
- `media-card` — media and a webpage card in the same row are two independent reservations; neither reflows the other.
- `viewer-open` — clicking a cell or a lone item opens a full-screen modal with the body as its caption and a `1 / n` counter, with the previous and next items available.
- `viewer-zoom` — `zoom in` / `zoom out` step the scale by 0.5 between 0.5 and 4, a range input carries the level, and `fit to the window` returns to 1. Below 1 the pan is pinned to 0.
- `viewer-shell` — the shell is a Kobalte modal, so the focus trap, `aria-modal`, Escape-to-close, the scroll lock and the focus restore are the library's, not hand-rolled.
- `viewer-pan` — a drag of more than 4px pans the picture and can page to the next item at the edges; a shorter travel is a click, and a click on a fitted photo zooms to 2×.

## How to get to it (user POV)

- Open the chat harness at `http://localhost:<port>/src/chat/harness.html?state=media-only` for a lone picture, or `?state=album-4` for a four-up grid.
- Click any cell or any lone item to open the viewer.
- Press `zoom in` / `zoom out`, drag the range input, or press `fit to the window` to change the scale; press `Escape`, `close`, or click outside to dismiss.
- Press `next item` / `previous item` to step through an album; in a single-item message those two buttons are not rendered.
- In the `video` state, click the clip's poster to open the viewer on it.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- **Use `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`.** The server binds IPv6 loopback only; `curl` to `127.0.0.1:3017` exits `7` (connection refused) while `localhost:3017` answers `200`.
- **Every `page.goto` passes `{ waitUntil: "domcontentloaded", timeout: 60000 }`.** The media on this page is exactly why the default `load` wait never fires here — it is not a misconfiguration, it is the app.
- **Wait for the media to decode before measuring.** The fitted box is asked for from the item's declared dimensions, but the `<img>` inside it only reaches its natural size once the bytes land. Measured: immediately after `setState("video")` the block is `[0, 0]`, and after ~1.5s it is `[420, 236]` with the image reporting `naturalWidth: 1280`. **A zero-sized media box measured too early is a measurement artifact, not a render failure** — re-read after a wait, and record both values so the difference is visible.
- **`openMedia`, `closeMedia` and `probe().viewer` all report `false` with the viewer open.** They test `[data-component="media-viewer"]`, which the viewer does not render. **Assert the viewer by `.media-viewer` or `[role=dialog]`** and treat a `false` from those three as a fact about the probe. See the gotchas.
- Selectors this feature relies on:
  - `[data-component="chat-media"]` — one message's media block, carrying `data-count` and an inline `width: min(<n>px, 100%)`.
  - `[data-component="chat-media-cell"]` — one album cell, carrying `aria-label="Open <alt>"` and an absolute percentage `left`/`top`/`width`/`height`.
  - `[data-component="chat-media-duration"]` — a clip's `m:ss` badge.
  - `[data-slot="bubble-content"]` — the media's own parent, which reads `padding: 0px` on a media message.
  - `[data-component="chat-webpage"]` — the webpage card, for the `media-card` state.
  - `.media-viewer` (also `.media-viewer--photo`) — the full-screen viewer dialog. **Not `[data-component="media-viewer"]`.**
  - `.media-viewer-image`, `.media-viewer-caption`, `.media-viewer-counter`, `.media-viewer-stage`, `.media-viewer-canvas`, `.media-viewer-topbar`, `.media-viewer-zoom-pill`, `.media-viewer-zoom-range`, `.media-viewer-sibling` — the viewer's parts.

- **Read the two shapes apart before measuring anything.** Observe: a lone item is a box, several items are a grid of cells.
  - Run `page.evaluate(() => { const m = document.querySelector('[data-component="chat-media"]'); return { count: m.getAttribute("data-count"), cells: m.querySelectorAll('[data-component="chat-media-cell"]').length, box: [Math.round(m.getBoundingClientRect().width), Math.round(m.getBoundingClientRect().height)], inlineWidth: m.style.width }; })` on `media-only`, then on `album-2`.
  - **Measured:** `media-only` reports `count: "1"`, **zero** cells and a box of `[400, 400]`; `album-2` reports `count: "2"`, **two** cells and a box of `[420, 141]`. The same distinction is available from the harness without a query: `probe().media` is `1` in both cases while `probe().mediaCells` is `0` for a lone item and `2` for an album. **Counting only `chat-media` tells you a message has media; counting `chat-media-cell` is what tells you a lone item from an album.**

- **A lone item is fitted, and the fit depends on the item's own aspect.** Observe: a square is 400px, a landscape is 320×400, a 16:9 is 420×236, and a portrait clip is bounded by height rather than width.
  - Load each of `media-only`, `photo-caption`, `video`, `video-portrait` and `media-card`, settle for the decode, and read the same box and inline width.
  - **Measured:** `media-only` is `[400, 400]` at `width: 400px`; `photo-caption` is `[320, 400]`; `video` and `video-caption` are `[420, 236]`; `video-portrait` is `[368, 400]` — the portrait clip's box is bounded by **height**, at 400, while its width follows the aspect. `media-card` is `[420, 236]` and additionally carries one `[data-component="chat-webpage"]`.
  - The inline `width` is the literal `min(<n>px, 100%)`, so the cap is readable straight off the style attribute without layout. The height follows from the aspect once the box is capped.
  - A box wider than 420px, or a landscape clip whose height exceeds its width, is a defect in the clamp ladder.

- **A media message drops the bubble's padding.** Observe: the content's padding is `0px` on a media message, and the picture takes the bubble's own corners.
  - Run `page.evaluate(() => { const c = document.querySelector('[data-slot="bubble-content"]'); const m = document.querySelector('[data-component="chat-media"]'); const cs = getComputedStyle(c); return { contentPadding: cs.padding, contentRadius: cs.borderRadius, contentOverflow: cs.overflow, mediaRadius: getComputedStyle(m).borderRadius, caption: c.querySelectorAll(".chat-text").length }; })` on `media-only`, and the same on `today` for comparison.
  - **Measured:** every media state reports `contentPadding: "0px"`, `contentRadius: "18px"`, `contentOverflow: "hidden"`, and `mediaRadius: "0px"`. The media draws no radius of its own; the bubble's corners are the media's corners. **Do not assert `7px 12px` on a media bubble** — the text-only assertion in [Chat bubbles](./chat-bubbles.md) is about text-only rows, and a media row correctly reads `0px`. A `photo-caption` message wraps its body in its own padded block, so its text still sits 12px from the edge while the content node reads `0px`.

- **Album cells round only the corners on the album's outline.** Observe: a two-up has two rounded outer corners per cell and square inner ones; a 2×2 has eight rounded corners in total, not sixteen.
  - Load `album-2` through `album-5` and `album-pano`, settle, and run `page.evaluate(() => { const m = document.querySelector('[data-component="chat-media"]'); return [...m.querySelectorAll('[data-component="chat-media-cell"]')].map((c) => { const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { size: [Math.round(r.width * 100) / 100, Math.round(r.height)], rect: [cs.left, cs.top, cs.width, cs.height], radius: cs.borderRadius, borderWidth: cs.borderWidth, cursor: cs.cursor, aria: c.getAttribute("aria-label") }; }); })`.
  - **Measured cell radii, and this is the whole point of the recipe:**
    - `album-2` — `[420, 141]`, cells at `251×141` (`17px 0px 0px 17px`) and `168×141` (`0px 17px 17px 0px`). Two cells, two rounded outer edges each, the shared inner edge square.
    - `album-3` — `[420, 420]`, cells `420×210` (`17px 17px 0px 0px`), `210×209` (`0px 0px 0px 17px`), `210×209` (`0px 0px 17px`). The lone top cell carries two rounded corners; the two below carry one each.
    - `album-4` — `[420, 376]`, cells `420×236` (`17px 17px 0px 0px`), then `139×139` / `70×139` / `209×139` in a row where only the leftmost and rightmost round. **The middle cell reads `0px` on every corner**, which is the proof that the clamping is per-outline-edge and not a blanket radius.
    - `album-5` — `[420, 573]`, five cells whose rounding follows the same outline rule.
    - `album-pano` — `[420, 556]`, three cells: a `284×135` with `17px 0px 0px`, a `135×135` with `0px 17px 0px 0px`, and a full-width `420×420` with `0px 0px 17px 17px`.
  - **A cell with all four corners rounded is a defect**, and `album-4` is the state that catches it, because its middle cell is interior on three sides.
  - Every cell's `borderWidth` is `0px` and its `cursor` is `zoom-in`; separation is the 1px positional gap between the percentage rects, not a border or a gap property. The album block's own computed `gap` reads `normal` — the cells are absolutely positioned, so a gap property would do nothing.

- **A clip shows a poster with a duration badge.** Observe: a video message renders an image, not a `<video>`, and carries a `m:ss` badge.
  - Load `video`, settle, and run `page.evaluate(() => { const m = document.querySelector('[data-component="chat-media"]'); return { video: m.querySelectorAll("video").length, poster: !!m.querySelector("img"), duration: m.querySelector('[data-component="chat-media-duration"]')?.textContent?.trim(), badgeDisplay: m.querySelector('[data-component="chat-media-duration"]') ? getComputedStyle(m.querySelector('[data-component="chat-media-duration"]')).display : null, item: window.__chat.messages()[0].media[0].kind }; })`.
  - **Measured:** `video` is `0`, a poster `<img>` is present, and the badge reads **`0:06`**, which is the fixture's 6-second duration. `video-portrait` reads `0:04`. The badge's own `position` is absolute and its background is `oklch(0 0 0 / 0.55)`-class translucent black over the poster's bottom-end corner.
  - An inline `<video>` inside a bubble is a defect: it puts a second set of chrome inside the bubble and a second scroll target inside a virtualized transcript. Assert `video` is `0`.

- **The viewer opens from a cell, and it is a modal.** Observe: the dialog covers the page, the app behind it is hidden and scroll-locked, and the body becomes the caption.
  - Load `album-4`, settle, then **click the cell by hand**: `page.click('[data-component="chat-media-cell"]')`. Wait ~800ms and run `page.evaluate(() => ({ viewer: document.querySelectorAll(".media-viewer").length, dialog: document.querySelectorAll("[role=dialog]").length, byComponent: document.querySelectorAll("[data-component='media-viewer']").length, rootHidden: document.getElementById("root").getAttribute("aria-hidden"), bodyOverflow: getComputedStyle(document.body).overflow, buttons: [...document.querySelectorAll(".media-viewer button")].map((b) => b.getAttribute("aria-label")), counter: document.querySelector(".media-viewer-counter")?.textContent?.trim(), siblings: document.querySelectorAll(".media-viewer-sibling").length, caption: document.querySelector(".media-viewer-caption")?.textContent?.trim() }))`.
  - **Measured:** `viewer` is `1`, `dialog` is `1`, **`byComponent` is `0`**, `rootHidden` is `"true"`, `bodyOverflow` is `"hidden"`, `siblings` is `2`, and the caption is the **message body's own text** — `Four is the plain 2x2, which is the only album shape that needs no special casing at all.`
  - `buttons` is exactly `["close", "previous item", "next item", "zoom out", "zoom in", "fit to the window"]` for a multi-item message. The counter reads **`1 / 4`** and is an `aria-live="polite"` region. `previous item` / `next item` are rendered only when the message carries more than one item.
  - Assert the shell by `.media-viewer` or `[role=dialog]`. **`[data-component="media-viewer"]` is `0` with the dialog open** — the shell is a `ModalV2.Content` and carries `data-component="modal-v2-content"`.

- **The zoom controls change the scale.** Observe: `zoom in` grows the picture and `fit to the window` returns it.
  - With the viewer open on `album-4`, run `page.evaluate(() => { const i = document.querySelector(".media-viewer-image"); return { rendered: [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)], natural: [i.naturalWidth, i.naturalHeight], rangeValue: document.querySelector(".media-viewer-zoom-range").value, rangeAttrs: { min: document.querySelector(".media-viewer-zoom-range").min, max: document.querySelector(".media-viewer-zoom-range").max, type: document.querySelector(".media-viewer-zoom-range").type } }; })`.
  - **Measured at fit:** the image renders `1420×652` from a natural `1600×900` — fitted to the stage, not shown at natural size, because the stage is narrower than 1600px. The range input's `min` is `0.5`, `max` is `4` and its current value is `1` (`ZOOM_FIT`).
  - Click `.media-viewer button[aria-label="zoom in"]`, wait ~400ms, and re-read: the rendered size becomes `2130×978` and the range value `1.5` — exactly 1.5× the fitted size, matching the `ZOOM_STEP` of 0.5. Click `fit to the window` and it returns to `1420×652` with the range back at `1`.
  - **Assert the range input's `value`, not a text readout.** The zoom pill contains the two buttons and the range input and **no text at all** — measured `textContent` is `""` — so there is no `100% zoom` string to read. The scale's observable truth is the rendered geometry plus the range's value. A recipe looking for a percent readout is looking for a control this viewer does not have.
  - A clip message does not render the zoom pill at all (`isPhoto()` gates it), so a zoom recipe on `video` finds nothing and that is correct.

- **Stepping through an album swaps the image and the counter.** Observe: `next item` moves to the following picture.
  - With the viewer open on `album-4`, read `page.evaluate(() => { const i = document.querySelector(".media-viewer-image"); return { natural: [i.naturalWidth, i.naturalHeight], counter: document.querySelector(".media-viewer-counter")?.textContent?.trim() }; })`, click `.media-viewer button[aria-label="next item"]`, wait ~400ms, and re-read.
  - **Measured:** the image's natural size changes from `1600×900` to `1000×1000` and the counter goes from `1 / 4` to `2 / 4`. A `next item` that leaves the image and the counter unchanged is a defect.
  - The two switchers are always present as siblings; their `--hidden` modifier drives `display: none`, and **a hidden sibling still computes `visibility: visible`** — so `visibility` is the wrong thing to assert. Read the class modifier or the computed `display`.

- **Escape closes and the page comes back.** Observe: the dialog is gone, the root is no longer hidden, and the scroll lock is released.
  - Press `Escape`, wait ~500ms, and run `page.evaluate(() => ({ viewer: document.querySelectorAll(".media-viewer").length, dialog: document.querySelectorAll("[role=dialog]").length, rootHidden: document.getElementById("root").getAttribute("aria-hidden"), bodyOverflow: getComputedStyle(document.body).overflow }))`.
  - **Measured:** `viewer` and `dialog` both drop to `0`, `rootHidden` goes back to `null` and `bodyOverflow` back to `visible`.
  - The focus trap, the `aria-modal` semantics and the focus restore are Kobalte's, so do not assert a specific element holds focus on close without reading it: measured on Escape, `document.activeElement` resolves to neither a `data-component` nor a `.media-viewer-*` class, because the cell that opened the viewer is inside a **virtualized** row that may have been recycled. Assert the close, not the focus target, unless the row is still mounted — and if you do assert focus, scroll the opener back into view first.

- **Proof.** Write the album cell rects, the fitted boxes and the viewer's open/zoom/close state to `/tmp/kiko-verify-evidence/media.json` in the same run that measured them.

## Gotchas

- **The fitted box is `0` until the image decodes.** The block's width comes from the item's declared dimensions, but the `<img>` reaches its natural size only once the bytes land, and a landscape clip measured immediately after `setState` reads `[0, 0]`. **Wait ~1.5s and re-read.** A zero-sized media box is a measurement artifact far more often than it is a render failure, and it is the single most common false positive in this file.
- **`probe().viewer`, `openMedia()` and `closeMedia()` all look for `[data-component="media-viewer"]`, which the viewer does not render.** Measured on the composed app: after a real click the component selector is `0` while `.media-viewer` is `1` and `[role=dialog]` is `1`. `openMedia` returns `false`, `closeMedia` returns `false` and `probe().viewer` is `false` **with the viewer open**. **Assert the viewer by `.media-viewer` or `[role=dialog]`, and open it by clicking a cell.** The viewer itself works; only the probe's success test is wrong.
- **The shell is a Kobalte modal, so its `data-component` is `modal-v2-content`.** Anything handed to `ModalV2.Content` as a `data-component` prop is overwritten, the same way `MenuV2.Content` overwrites the message menu's. Select by class, or by `menu-v2-content` / `modal-v2-content` where there is no class.
- **There is no `.lightbox`, no `[data-component="chat-image-trigger"]` and no `[data-slot="chat-image"]`.** Measured `0` for each on a live harness page. The old image button and its `Open image: <alt>` label are gone: media is `[data-component="chat-media"]`, its cells are `[data-component="chat-media-cell"]` with `aria-label="Open <alt>"`, and the viewer is `.media-viewer`. A recipe that reaches for a `.lightbox-*` class is reading a component that no longer exists.
- **The viewer has no percent readout.** The zoom pill holds `zoom out`, a range input and `zoom in`, and its `textContent` is the empty string. **Assert the range input's `value`** (`0.5` to `4`, step `0.5`, fit at `1`) plus the rendered image geometry. Looking for `100% zoom` is looking for a control the viewer does not draw.
- **The viewer is fitted to the stage, not shown at natural size.** A 1600px-wide image measured `1420px` wide on a 1420px viewport. Reading the rendered width and calling it a scaling bug reports the fit working. The natural size is on `naturalWidth` / `naturalHeight`.
- **A media bubble's content padding is `0px`, not `7px 12px`.** Media takes the bubble's edges, so the bubble hands its padding to the caption. The `7px 12px` assertion in [Chat bubbles](./chat-bubbles.md) is about **text-only** rows; a media row reading `0px` is correct, and asserting the padding there reports a correct implementation as a defect.
- **The media draws no radius of its own.** `chat-media` computes `border-radius: 0px` and relies on `[data-slot="bubble-content"]`'s `18px` + `overflow: hidden` to clip it. A radius asserted on the media block will read `0px` and mean nothing.
- **Album cells round only the corners on the album's outline, and `album-4` is the proof.** Its middle cell is interior on three sides and measures `0px` on all four corners. **A cell with all four corners rounded is the defect this file exists to catch.** The outer radius is 17px, derived from the bubble's own radius, and the cells' `width`/`height`/`left`/`top` are **percentages** — read the rendered `getBoundingClientRect()` for geometry and the computed style for the radius, and do not compare the two against each other.
- **Album cells are absolutely positioned, so `gap` is meaningless here.** The computed `gap` on the album block is `normal` and the 1px separation comes from the percentage rects. A recipe asserting a gap of 1px is reading a property that does nothing.
- **The album geometry is a deliberate transcription of tweb's, rounding included.** Cells legitimately measure `209.5px` and the whole album lands back on exactly 420px. **Do not round a cell to an integer and then assert the row sums to 420** — the sub-pixel is the design. Read `Math.round(w * 100) / 100` if you need a stable number.
- **The transcript is virtualized, so a cell handle can be detached.** An image cell that resolved at one moment can be gone before the next query runs. Scroll the target into view and re-query immediately before every click; never hold an element across a wait.
- **A hidden viewer sibling still computes `visibility: visible`.** The `--hidden` modifier drives `display: none`. Read the class modifier or the computed `display`, never `visibility`.
- **`page.setInputFiles` is the only way to add a composer attachment,** and the chat harness does not mount the composer at all, so any composer-attachment recipe runs at `/`. See [Composer](./composer.md).
