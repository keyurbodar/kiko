# Message images and the lightbox

A message can carry a picture, and the picture is a picture a user acts on: it renders as a bounded rectangle inside its bubble, and clicking it opens a full-screen viewer where the image is at its natural size and can be zoomed. The same viewer opens from a thumbnail in the composer's attachment strip, so one modal answers both. Until this landed the transcript drew only the reply quote and the body text, so an image message showed nothing but its words.

## Sub-features

- `message-image` — an image message renders a clickable picture inside the bubble, between the reply quote and the body text. The button is `[data-component="chat-image-trigger"]`; its child `<img>` is `[data-slot="chat-image"]`, and the button carries `aria-label="Open image: <alt>"`.
- `image-geometry` — the trigger is `width: min(300px, calc(420px * aspect))` with `aspect-ratio: aspect`, so any aspect at or above about `0.714` is capped at 300px wide and a taller picture is `420 * aspect`. `border-radius` is `12px`, `margin-bottom` is `4px`, `overflow` is `hidden`, `background` is `var(--input-bg)`, there is no border, and the cursor is a pointer. `aspect` is `image.width / image.height`, falling back to `1.5` when either is not a positive number.
- `image-object-fit` — the `<img>` is `object-fit: cover` at `100%`/`100%` with `border-radius: inherit`, so the picture fills the box and takes the 12px corner rather than the bubble's pill.
- `lightbox` — the viewer opens over the page with `caption` set to the alt text, the image at its intrinsic size, four buttons — `Zoom out`, `Fit to window`, `Zoom in`, `Close image preview` — and a `.lightbox-status` readout reading `100% zoom`. While it is open `#root` carries `aria-hidden="true"` and `document.body` has `overflow: hidden`; focus lands on `.lightbox-viewport`.
- `lightbox-zoom` — `Zoom in` takes the status to `150% zoom` and a 560x320 image to 840x480. `Fit to window` returns it to `100% zoom`, and Escape closes.
- `lightbox-focus-return` — Escape returns focus to the image button that opened the viewer.
- `composer-attachment-lightbox` — clicking an `.attachment-thumb` in the composer's attachment strip opens the same viewer, with `caption` set to the filename and the source the attachment's `blob:` URL. Before this, the strip's thumbnail was a dead click: `onAttachmentClick` was wired all the way down to `input.openAttachment?.()`, which was undefined.
- `one-lightbox-per-transcript` — the transcript creates one `createLightbox()` and renders its `view` once; every row gets the same `open` callback. The composer's strip creates its own. The transcript's instance is single on purpose: the transcript is virtualized, so a per-row viewer would be destroyed the moment its message scrolled out of the buffer, taking an open dialog with it.

## How to get to it (user POV)

- Open the chat harness at `http://127.0.0.1:<port>/src/chat/harness.html?state=reply-image` and scroll the transcript to a message carrying a picture. The state slices `a-25`, `a-26` and `a-27`; `a-25` and `a-26` are the two with images, and both are in the `ada` thread.
- Click any message image to open the viewer.
- Press `Zoom in` or `Zoom out`, or `Fit to window`, to change the scale; press `Escape` or click `Close image preview` to close.
- In the composed app at `http://127.0.0.1:<port>/`, attach a file to the composer, then click its thumbnail in the attachment strip to open the viewer.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- The message image needs the `reply-image` fixture state, so the round starts at `http://127.0.0.1:3001/src/chat/harness.html?state=reply-image`. `a-25` (a 640-wide mountain SVG) and `a-26` (a 560x320 diagram SVG) are the two image messages; `a-26` is the one with real, easy-to-read geometry.
- The composer attachment path needs the **composed app** at `http://127.0.0.1:3001/`, because the chat harness does not mount the composer.
- Selectors this feature relies on:
  - `[data-component="chat-image-trigger"]` — the `<button>` around a message image, carrying `aria-label="Open image: <alt>"`.
  - `[data-slot="chat-image"]` — the `<img>` inside that button.
  - `.lightbox` — the modal surface.
  - `.lightbox-caption` — the title, holding the alt text or the filename.
  - `.lightbox-viewport` — the focusable, zoomable region.
  - `.lightbox-image` — the image the viewer renders.
  - `.lightbox-status` — the `aria-live` percent readout.
  - `.lightbox-bar` and `.lightbox-button` — the control row and its buttons, labelled `Zoom out`, `Fit to window`, `Zoom in`, `Close image preview`.
  - `[data-component="composer-attachment"]` — one chip in the composer's attachment strip.
  - `.attachment-thumb` — the chip's thumbnail, and the click target that opens the viewer.
- **Reach the image, then read its geometry.** Scroll the `a-26` message into view and re-query; the transcript is virtualized, so query the handle inside a retry loop rather than holding it across a wait. Run `page.evaluate(() => { const b = document.querySelector('[data-component="chat-image-trigger"]'); const img = b.querySelector('[data-slot="chat-image"]'); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return { box: [Math.round(r.width), Math.round(r.height)], aspectRatio: cs.aspectRatio, width: cs.width, borderRadius: cs.borderRadius, marginBottom: cs.marginBottom, overflow: cs.overflow, background: cs.backgroundColor, cursor: cs.cursor, borderWidth: cs.borderTopWidth, objectFit: getComputedStyle(img).objectFit, intrinsic: [img.naturalWidth, img.naturalHeight], label: b.getAttribute("aria-label") }; })`. `box` is `[300, 171]`, `aspectRatio` is `1.75`, `width` is `min(300px, calc(420px * 1.75))`, `borderRadius` is `12px`, `marginBottom` is `4px`, `objectFit` is `cover`, `intrinsic` is `[560, 320]`, and `label` begins `Open image:`. Report the matched count next to the read: a geometry probe over a selector that matched nothing proves nothing.

- **Prove the `min()` caps the width.** The same read on `a-25` (a 640-wide image) reports `box` of `[300, …]` and `intrinsic` of `[640, …]`. Any aspect at or above roughly `0.714` renders 300px wide; only a picture taller than that narrows to `420 * aspect`. A recipe that asserts the width equals the image's own pixel width is asserting the wrong thing — the box is capped, and the natural size is what the **viewer** shows.

- **Open the viewer from the message image and read its whole state.** Click the button, then run `page.evaluate(() => { const l = document.querySelector(".lightbox"); const img = l.querySelector(".lightbox-image"); const r = img.getBoundingClientRect(); return { caption: l.querySelector(".lightbox-caption").textContent.trim(), size: [Math.round(r.width), Math.round(r.height)], buttons: [...l.querySelectorAll(".lightbox-button")].map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()), status: l.querySelector(".lightbox-status").textContent.trim(), rootHidden: document.getElementById("root").getAttribute("aria-hidden"), bodyOverflow: getComputedStyle(document.body).overflow, active: document.activeElement.className }; })`. `caption` is the image's alt text, `size` is `[560, 320]` — the natural size, not the 300px trigger — `buttons` is `["Zoom out", "Fit to window", "Zoom in", "Close image preview"]`, `status` is `100% zoom`, `rootHidden` is `"true"`, `bodyOverflow` is `"hidden"`, and focus is on `.lightbox-viewport`.

- **Zoom in, then fit back.** With the viewer open, click the `Zoom in` button and re-read `page.evaluate(() => { const l = document.querySelector(".lightbox"); const r = l.querySelector(".lightbox-image").getBoundingClientRect(); return { status: l.querySelector(".lightbox-status").textContent.trim(), size: [Math.round(r.width), Math.round(r.height)] }; })`. `status` is `150% zoom` and `size` is `[840, 480]` — 1.5x the 560x320 natural size. Click `Fit to window` and the same read returns `100% zoom` and `[560, 320]`.

- **Close with Escape and prove focus went back.** Press `Escape`, then run `page.evaluate(() => ({ open: document.querySelectorAll(".lightbox").length, active: document.activeElement.getAttribute("data-component"), label: document.activeElement.getAttribute("aria-label") }))`. `open` is `0`, `active` is `chat-image-trigger`, and `label` still begins `Open image:` — focus returns to the button that opened the viewer. A close that leaves focus on `<body>` is a real defect, so assert all three.

- **Open the viewer from a composer attachment.** In the composed app, attach a PNG through the real file input, then click the chip's thumbnail. Run `page.evaluate(() => { const l = document.querySelector(".lightbox"); const img = l.querySelector(".lightbox-image"); return { caption: l.querySelector(".lightbox-caption").textContent.trim(), src: img.src.slice(0, 5), status: l.querySelector(".lightbox-status").textContent.trim() }; })`. `caption` is the **filename**, not an alt string, and `src` is `blob:`. Press `Escape` and the viewer is gone. This is a second, separate trigger: proving the message path alone leaves the attachment strip's dead click unverified.

## Gotchas

- **The transcript is virtualized, so a handle that was there a moment ago may be gone.** `virtua` recycles rows, and an image button that resolved at one moment can be detached before the next query runs. Scroll the target into view and then **re-query inside a retry loop** — never hold a selector or an element handle across a wait. This cost a real debugging round on this feature.
- **`page.$` does not exist in `ego-browser`.** There is no element-handle call to hang a stale reference on; call `page.setInputFiles(selector, path)` directly for the composer's file input, and do not port a Playwright-shaped script that reaches for `page.$`.
- **`ChatMessage.image` used to render nowhere.** `MessageRow` drew only the reply quote and the body text, so an image message showed its words and nothing else. A run that finds no image and reports the fixture is wrong has to check whether the trigger exists at all before blaming the state.
- **The composer's `openAttachment` is a sibling of `view` in the controller config, not a member of it.** Passing it inside `view` silently does nothing, and the symptom is exactly the old one: the thumbnail is a dead click.
- **The transcript has one lightbox on purpose.** It is not a per-row viewer. A per-row instance is destroyed the moment its message scrolls out of the virtualized buffer, taking an open dialog with it — so a run that opens a viewer and scrolls the transcript will see the modal vanish, and must not report that as a broken close button.
- **The button is the labelled thing, not the image.** It is a `<button type="button">` carrying `aria-label="Open image: <alt>"`, because a clickable `<img>` is not keyboard-reachable and the `<img>`'s own `alt` cannot label the button. Assert the `aria-label` on the button.
- **The trigger's width is capped, the viewer's is not.** A 640-wide image renders a 300px trigger and opens at 640px. Reading the trigger's box and calling it the image size reports a scaling bug that is not there.
- **`aspect` falls back to `1.5`.** An image whose `width` or `height` is missing or not positive renders at a 1.5 ratio, so a fixture with a malformed size is not a render failure — read `aspect-ratio` before concluding the image is broken.
- **`page.setInputFiles` needs the real input.** The composer's attachment strip only fills by way of the actual `input[type=file]`; there is no probe for adding a file, and the chat harness does not mount the composer at all. Drive this path at `/`.
