# Message attachments and the image dialog

Since 2026-10-09 kiko draws attachments as t3code does. The human attaches pictures and files in the composer; a sent message shows its pictures as a small grid and its other files as rows; a picture opens in an image dialog. There is no album layout, link card, thumbhash, or video poster any more. Agents send no files, so only the human's messages carry attachments, but an old agent message that has files draws the same way.

A file is a picture when its type is GIF, JPEG, PNG, or WebP, or its name says so and the type is empty (`apps/web-solid/src/lib/attachments.ts`). Every other file, an SVG or a HEIC included, is a file row.

## Sub-features

- `composer-strip` — pictures in the composer are 64px square thumbnails (`rounded-lg`, a 1px hairline border, `object-cover`) with a 20px remove button on the top-right corner, always visible. Other files are rows under them: icon, name (truncated), size in 12px muted text (`391 B`, `48 KB`, `3.2 MB`), and an X.
- `composer-attach` — the attach button clicks a hidden `<input type="file" multiple aria-label="Attach files">`. A paste of files and a drop anywhere on the page also attach.
- `composer-drop` — while files are dragged over the page, `[data-component="composer-drop-overlay"]` covers the chat column inset by 8px: a 2px dashed accent border at 60%, `rounded-2xl`, and a centred pill "Drop files to attach" with a paperclip.
- `composer-limits` — at most 10 files a message, a picture up to 10 MB, any other file up to 50 MB. A refused file is said in an error toast: `big.png is over 10 MB`, `You can attach up to 10 files. 1 file was left out`.
- `message-grid` — a sent message draws its pictures in `grid max-w-[210px] grid-cols-2 gap-2`, each tile `aspect-[4/3]`, `rounded-lg`, bordered, `object-cover`, `cursor-zoom-in`. A lone picture spans both columns.
- `message-files` — other files are rows: icon, name, an eye (`Preview <name>`) and a download link. Preview opens the files tab on the file when its viewer can show it, else the file in a new tab.
- `message-only-files` — a message with no text shows only its attachments in the bubble. Text sits 8px under them.
- `optimistic` — a message shows at once from blob URLs (`local:` id) and switches to `/api/files/<room>/<id>` once the uploads land.
- `image-dialog` — black 75% backdrop, the picture centred within 92vw by 86vh, a close button above its top-right corner, arrows when there are more pictures, and a caption `name (i/n)` in 12px white at 80%. Arrow keys move and wrap. Escape and a click outside the picture close. It opens and closes with no animation, and has no zoom.

## How to get to it (user POV)

- In the app at `http://localhost:5173/chat/<id>`: press the composer's `+`, pick files, look at the strip, press a thumbnail, then send. Press a tile in the sent bubble to open the dialog; press the eye on a file row to open it in the files tab.
- In the chat harness at `http://localhost:<port>/src/chat/harness.html?state=grid-3` (also `grid-2`, `grid-4`, `grid-5`, `grid-shapes`, `picture-only`, `picture-caption`, `video`, `picture-link`, `file-single`, `file-group`, `user-grid-3`, `user-grid-2-reply`, `user-picture`). The harness has no composer.

## Driving it with agent-browser

Use only `agent-browser --session <name>`. The commands below are what the 2026-10-09 run used, against the logged-in test session.

- **Attach through the input.** `agent-browser --session <s> upload 'input[type=file][aria-label="Attach files"]' a.png b.png report.pdf`. Then read the strip: `[...document.querySelectorAll("[data-component=composer-attachment]")].map(e => ({ img: e.hasAttribute("data-image"), text: e.textContent.trim(), box: [e.getBoundingClientRect().width, e.getBoundingClientRect().height] }))`.
  - **Measured:** two thumbnails at `[64, 64]` with `border-radius: 8px` and `border-top-width: 1px`, and one row whose text is `report.pdf391 B`.
- **Open the composer's dialog.** Click `button[aria-label="Preview ocean.png"]` and read `[data-component="image-dialog-caption"]`.
  - **Measured:** `ocean.png (2/2)`; `ArrowRight` gives `sunset.png (1/2)` (it wraps); Escape removes `[data-component="image-dialog"]` and the strip still holds 3.
  - The backdrop is `[data-component="modal-v2-overlay"]` and computes `oklab(0 0 0 / 0.75)`. The modal content's `transition-duration` is `0s` and `animation-name` is `none`. A press at (20, 20), outside the content, closes it.
- **Send and read the bubble.** Type in `[data-component=prompt-input]`, press Enter, and read the last row with tiles.
  - **Measured:** right after the send the row id is `local:<uuid>`; with uploads blocked (`network route '**/api/files/*?path=*' --abort`) the tiles' `src` starts with `blob:` and the picture is drawn. Unblocked, a few seconds later the row has the stored id, the tiles read `/api/files/<room>/<id>` at `101×76` each, the grid's `grid-template-columns` is `101px 101px`, and the file row's link has `download="report.pdf"`.
  - A lone picture measures `210×158` with `col-span-2`, and the bubble holds no text.
- **Open the message's dialog.** Click `[data-component=chat-attachment-image][aria-label="Preview sunset.png"]`.
  - **Measured:** `sunset.png (1/2)`, `Next image` gives `ocean.png (2/2)`, `ArrowLeft` gives `sunset.png (1/2)`, Escape closes.
- **Preview a file.** Click `[data-component=chat-attachment-file] button[aria-label="Preview report.pdf"]`.
  - **Measured:** the right panel opens on Files with `[data-component="file-viewer"][data-kind="pdf"]` and an embedded PDF.
- **The drop overlay.** Dispatch a `dragover` on `document` with a `DataTransfer` that holds a `File`, read the overlay, then dispatch `drop` on the chat shell.
  - **Measured:** text `Drop files to attach`, `border-top: dashed 2px`, `border-radius: 16px`, and a box 8px inside `[data-component="chat-shell"]` on every side. After the drop the overlay is gone and the strip holds `dropped.png`.
- **Limits.** Upload an 11 MB `big.png` and ten text files at once.
  - **Measured:** the strip takes 10 files and two toasts say `big.png is over 10 MB` and `You can attach up to 10 files. 1 file was left out`. Toasts hide after a few seconds, so read them right after the upload.
- **The harness probes.** `window.__chat.probe()` has `images`, `files`, and `viewer`; `await window.__chat.openMedia("m-02", 2)` resolves `true` with the caption `tall.png (3/3)`, and `closeMedia()` returns `true`.
- **Proof.** Write tile and row geometry and the dialog's open, step, and close state to `/tmp/kiko-verify-evidence/media.json` in the same run.

## Gotchas

- **`ModalV2` renders nothing until the overlay chunk loads.** The app loads it on idle; the image dialog also loads it when it opens, so the harness works. A dialog check that runs before the chunk lands waits a moment, which is why `openMedia` is async.
- **`[data-component="image-dialog"]` is on the dialog's inner column**, not on the modal. `ModalV2.Content` overwrites a `data-component` passed to it.
- **Clicking a tile through `element.click()` in an `eval` is fine**, but pick the tile by its `aria-label`: the last `[data-component=chat-row]` can be the typing row, not the message.
- **The tiles and thumbnails carry a 1px border on purpose**, as t3code draws them. They are outside the no-border check in [Chat bubbles](./chat-bubbles.md).
- **The files tab keeps its own picture viewer** (`.media-viewer`, `apps/web-solid/src/files/media/`), with zoom and gestures. It is a different modal from the chat's image dialog. Measured: clicking `.fv-image` opens `.media-viewer` with `.media-viewer-zoom-pill`, and Escape closes it.
- **A blocked upload leaves a failed message** in the view after its retries (about 3.5 s). It is a local patch, never sent, and a reload drops it.
