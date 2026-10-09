# Message attachments and the image dialog

Since 2026-10-09 yuki draws attachments as t3code does. The human attaches pictures and files in the composer; a sent message shows its pictures as a small grid and its other files as rows; a picture opens in an image dialog. There is no album layout, link card, thumbhash, or video poster any more. Agents send no files, so only the human's messages carry attachments, but an old agent message that has files draws the same way.

A file is a picture when its type is GIF, JPEG, PNG, or WebP, or its name says so and the type is empty (`apps/web-solid/src/lib/attachments.ts` over `packages/protocol/src/attachments.ts`). Another picture type, an SVG or a HEIC, is refused in the composer. Every other file is a file row.

Each file uploads the moment it is picked, as a pending upload (`PUT /api/files/<room>/pending/<id>?name=&size=`, `sync/uploads.ts`), and the send names the uploads; the room claims them into `attachments/` as it stores the message (architecture section 18.1).

## Sub-features

- `composer-strip` — pictures in the composer are 64px square thumbnails (`rounded-lg`, a 1px hairline border, `object-cover`) with a 20px remove button on the top-right corner, always visible. Other files are rows under them: icon, name (truncated), size in 12px muted text (`391 B`, `48 KB`, `3.2 MB`), and an X.
- `composer-attach` — the attach button clicks a hidden `<input type="file" multiple aria-label="Attach files">`. A paste of files and a drop anywhere on the page also attach.
- `composer-drop` — while files are dragged over the page, `[data-component="composer-drop-overlay"]` covers the chat column inset by 8px: a 2px dashed accent border at 60%, `rounded-2xl`, and a centred pill "Drop files to attach" with a paperclip.
- `composer-limits` — t3code's: at most 100 files a message, any other file up to 50 MB, pictures up to 80 MB together. A picture over 10 MB is shrunk to fit, not refused. The last refusal is said in an error toast: `'big.zip' exceeds the 50 MB attachment limit.`, `'logo.svg' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images.`, `'blank.txt' is empty or could not be read.`, `You can attach up to 100 files per message.`
- `composer-upload` — while a file uploads, a thumbnail shows `[data-slot="upload-progress"]` along its bottom edge (`42%`, `bg-bg/85`, 10px text) and a file row shows the percentage in place of its size. A failed upload shows `[data-action="retry-upload"]` (`aria-label="Retry upload for <name>"`, a 20px black 70% button at the thumbnail's bottom left, or a ghost button on a row) whose tooltip is the reason: `Upload rejected (413)`, `Upload failed`, `Upload timed out`, `Not connected`. The send button (`[data-action=prompt-submit]`) is disabled, and its `aria-label` and `title` say why, until every file is ready: `Attachment still uploading`, `Attachments still uploading`, `Retry or remove the failed attachment`.
- `message-grid` — a sent message draws its pictures in `grid max-w-[210px] grid-cols-2 gap-2`, each tile `aspect-[4/3]`, `rounded-lg`, bordered, `object-cover`, `cursor-zoom-in`. A lone picture spans both columns.
- `message-files` — other files are rows: icon, name, an eye (`Preview <name>`) and a download link. Preview opens the files tab on the file when its viewer can show it, else the file in a new tab.
- `message-only-files` — a message with no text shows only its attachments in the bubble. Text sits 8px under them.
- `optimistic` — a message shows at once from blob URLs (`local:` id) and switches to `/api/files/<room>/<id>` once the room confirms the send. The file id is the pending id the upload used. A send the room refuses (an upload that expired or was removed) stays marked failed, and an error toast gives the reason.
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
  - **Measured:** right after the send the row id is `local:<uuid>` and the tiles' `src` starts with `blob:`. Once the room confirms it, the row has the stored id, the tiles read `/api/files/<room>/<id>` at `101×76` each, the grid's `grid-template-columns` is `101px 101px`, and the file row's link has `download="report.pdf"`. The Files tab lists `attachments/<time36>-sunset.png` and `attachments/<time36>-report.pdf` only after the send, never while they are pending.
- **Upload progress and the send block.** Read the strip and the send button right after an upload: `JSON.stringify({ strip: [...document.querySelectorAll("[data-component=composer-attachment]")].map((e) => e.textContent.trim()), send: document.querySelector("[data-action=prompt-submit]").getAttribute("aria-label") })`.
  - **Measured (2026-10-09):** right after `upload` of `sunset.png` and `report.pdf`: strip `["0%", "report.pdf0%"]`, send disabled with `Attachments still uploading`. A second later: `["", "report.pdf193 B"]`, send enabled as `Send`.
- **A failed upload and its retry.** `agent-browser --session <s> network route '**/pending/**' --abort`, upload a file, and read `[data-action=retry-upload]` and the send button. Then `network unroute '**/pending/**'` and click the retry button.
  - A lone picture measures `210×158` with `col-span-2`, and the bubble holds no text.
- **Open the message's dialog.** Click `[data-component=chat-attachment-image][aria-label="Preview sunset.png"]`.
  - **Measured:** `sunset.png (1/2)`, `Next image` gives `ocean.png (2/2)`, `ArrowLeft` gives `sunset.png (1/2)`, Escape closes.
- **Preview a file.** Click `[data-component=chat-attachment-file] button[aria-label="Preview report.pdf"]`.
  - **Measured:** the right panel opens on Files with `[data-component="file-viewer"][data-kind="pdf"]` and an embedded PDF.
- **The drop overlay.** Dispatch a `dragover` on `document` with a `DataTransfer` that holds a `File`, read the overlay, then dispatch `drop` on the chat shell.
  - **Measured:** text `Drop files to attach`, `border-top: dashed 2px`, `border-radius: 16px`, and a box 8px inside `[data-component="chat-shell"]` on every side. After the drop the overlay is gone and the strip holds `dropped.png`.
- **Limits.** Upload a `logo.svg` and a 51 MB `big.zip` at once.
  - **Expected:** the strip takes neither, and one toast says `'big.zip' exceeds the 50 MB attachment limit.` (the last refusal). Toasts hide after a few seconds, so read them right after the upload.
- **The harness probes.** `window.__chat.probe()` has `images`, `files`, and `viewer`; `await window.__chat.openMedia("m-02", 2)` resolves `true` with the caption `tall.png (3/3)`, and `closeMedia()` returns `true`.
- **Proof.** Write tile and row geometry and the dialog's open, step, and close state to `/tmp/yuki-verify-evidence/media.json` in the same run.

## Gotchas

- **`ModalV2` renders nothing until the overlay chunk loads.** The app loads it on idle; the image dialog also loads it when it opens, so the harness works. A dialog check that runs before the chunk lands waits a moment, which is why `openMedia` is async.
- **`[data-component="image-dialog"]` is on the dialog's inner column**, not on the modal. `ModalV2.Content` overwrites a `data-component` passed to it.
- **Clicking a tile through `element.click()` in an `eval` is fine**, but pick the tile by its `aria-label`: the last `[data-component=chat-row]` can be the typing row, not the message.
- **The tiles and thumbnails carry a 1px border on purpose**, as t3code draws them. They are outside the no-border check in [Chat bubbles](./chat-bubbles.md).
- **The files tab draws a picture inline** (`[data-component="file-image"]`), with no dialog. Zoom lives in the chat's image dialog; see [Files panel](./files-panel.md).
- **A blocked upload never reaches the transcript.** It fails in the composer, and send stays off until it is retried or removed. A removed attachment's pending upload is deleted (`DELETE /api/files/<room>/pending/<id>`); one left behind is swept by the server after 24 hours.
