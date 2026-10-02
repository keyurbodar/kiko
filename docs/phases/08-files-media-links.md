# Phase 8. Files, media, and link previews

This phase adds real files. At the end, a user uploads attachments, agents read and write files in the room's file space, the files route shows a tree and an editor, and links get server-side previews.

## Tasks

### P8-01 Build the safe fetcher

`deps: P0-01` `difficulty: 4` `area: backend`

**Verify.** `bun test apps/server/test/safe-fetch.test.ts` passes. The cases include `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`, a decimal IP host, a public URL that redirects to a private one, a fourth redirect, a 4-second response, and a 5 MB body.

**Goal.** Write the one function that fetches a URL someone else chose.

**Read first.** Architecture section 18.2.

**Files.** Create `apps/server/src/lib/safe-fetch.ts` and its test.

**Build.**

- Allow `http` and `https` only. Reject IP-literal hosts and hosts that resolve to private, loopback, link-local, or metadata ranges. Resolve with DNS over HTTPS and check every address.
- Use `redirect: "manual"`, recheck each hop, and stop after 3.
- Time out after 3 seconds and stop reading after 1 MB.
- Send no cookies and no authorization header.
- Return a typed result with a reason on refusal.

**Done when.** Every other module that fetches a user-supplied or model-supplied URL imports this function.

### P8-02 Build the link preview route

`deps: P8-01, P1-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify link-preview` passes against a local fixture server: a page with Open Graph tags returns title, description, site name, and an image URL on kiko's origin, a second call is served from KV, and a page with no tags is cached as a miss.

**Goal.** Fetch link previews on the server, cache them, and re-host their images.

**Read first.** Architecture section 18.2.

**Files.** Create `apps/server/src/previews/route.ts`, `previews/parse.ts`, and `previews/image-job.ts`. Delete the proxy in `apps/web-solid/vite.config.ts`.

**Build.**

- Parse with `HTMLRewriter` and stop at `</head>`. Read `og:*`, the `twitter:*` fallbacks, `<title>`, and the favicon.
- Cache under the normalized URL in KV for 24 hours, and a miss for 10 minutes.
- Enqueue a job that copies `og:image` to R2 through the safe fetcher, with a size cap and a content-type check. Serve the image from `/api/preview-image/:hash`.
- Require a session on the route and rate-limit per user.

**Done when.** The client never receives a third-party image URL.

### P8-03 Build file upload, download, and the room file index

`deps: P1-04` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify files` passes: upload a 30 MB file in parts, download a byte range from the middle, see the file event on the room socket, and get 404 when another user requests it.

**Goal.** Store bytes in R2 and the index in the room.

**Read first.** Architecture section 18.1.

**Files.** Create `apps/server/src/files/upload.ts`, `files/download.ts`, and `apps/server/src/room/files.ts`.

**Build.**

- Upload through the Worker as a stream for small files and with R2 multipart upload for large ones. Compute SHA-256.
- Key objects as `u/<userId>/r/<roomId>/<fileId>`.
- Keep `ws_files(id, path, r2_key, size, type, sha256, width, height, thumbhash, author)` in the room and emit an event on every change.
- Download with a session check, `Range` support, and an immutable cache header.
- Enforce a per-file size cap and the per-user storage limit from the limits record.

**Done when.** A second upload of the same bytes to the same path stores one object.

### P8-04 Process attachments in a queue

`deps: P8-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify attachments` passes: after an image upload, the file row gains width, height, and a thumbhash within 5 seconds, and a job that fails twice succeeds on the third delivery.

**Goal.** Compute image metadata without holding a room awake.

**Read first.** Architecture section 7.9.

**Files.** Create `apps/server/src/jobs/consumer.ts` and `jobs/attachment.ts`.

**Build.**

- Add the queue consumer to the Worker with a typed job union: `attachment` and `preview-image`.
- For an image, read the dimensions from the header bytes and compute a thumbhash from a small decode.
- Write the result back to the room with an idempotent call.
- Let the client supply dimensions and a thumbhash at upload time, and only compute what is missing.

**Done when.** A repeated job changes nothing.

### P8-05 Add the file tools and web fetch

`deps: P8-03, P8-01, P1-12` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify file-tools` passes with the test model: the agent writes `notes/plan.md`, reads it back, lists the directory, and fetches a fixture page as text.

**Goal.** Let agents work with room files and read the web.

**Read first.** Architecture sections 7.5 and 18.

**Files.** Create `apps/server/src/agent/extensions/files.ts` and `extensions/web.ts`.

**Build.**

- `read_file(path)` returns text truncated to the limits in `pi-durable`'s `truncate.ts`, or an image part when the model accepts images.
- `write_file(path, content)` and `list_files(prefix)`.
- `web_fetch(url)` uses the safe fetcher and returns the page as text.
- Declare effects: `read`, `write`, `read`, `read`. File reads and web fetches return untrusted content.

**Done when.** A path with `..` or a leading slash is rejected.

### P8-06 Wire composer attachments to upload

`deps: P8-03, P2-08` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` attachments feature: paste an image, drop two files, see all three in the tray with progress, send, and see the album appear at once and survive a reload.

**Goal.** Make attachments real and optimistic.

**Files.** `apps/web-solid/src/composer/`. Create `apps/web-solid/src/sync/uploads.ts`.

**Build.**

- Accept paste, drag and drop, and the `+` button.
- Compute dimensions and a thumbhash in the client before upload, and show the thumbhash until the image loads.
- Show the message at once with local blob URLs, upload in the background with progress, and retry on failure.
- Keep pending uploads in the outbox so a reload resumes them.
- Compress nothing in the client. `fflate` is used only if the task finds a case that needs it, and the pull request says which.

**Done when.** Sending a message with three attachments blocks no interaction.

### P8-07 Build the file tree

`deps: P0-10, P8-03, P2-07` `difficulty: 4` `area: frontend`

**Verify.** The `verify-kiko` file tree feature: rows are 30 px, each level indents 16 px, a chevron rotates on open, the selected row is `#28221f`, hidden files are at half opacity, and the arrow keys move and expand.

**Goal.** Build the files sidebar so it looks and behaves like kat's tree.

**Read first.** `docs/research/kat-ui.md`, the file tree section. `~/kat-images/screenshot 15.png`.

**Files.** Create `apps/web-solid/src/files/tree.tsx` and `files/tree.css`. Use `createTree` from P0-10.

**Build.**

- Build the tree from the room's file index paths.
- Match kat: 30 px rows, 16 px indent, a 16 px chevron, file-type icons from the existing sprite, indent guides on hover only.
- New file and new folder buttons in the header. Rename and delete in a context menu.
- Expand and collapse with no animation. Persist the expanded set per room.
- Virtualize with `virtua/solid` past 500 visible rows.

**Done when.** The tree updates from room events when an agent writes a file.

### P8-08 Build the file viewer and editor

`deps: P8-07` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` file editor feature: open a text file, see line numbers and the current-line highlight, edit, save, and reload to the saved content. `bun scripts/bundle-budget.ts` shows CodeMirror outside tiers 1 to 3.

**Goal.** View and edit room files.

**Read first.** `docs/research/kat-ui.md`, the code view section. Architecture section 19.3.

**Files.** Create `apps/web-solid/src/files/editor.tsx` and `files/viewer.tsx`.

**Build.**

- Load CodeMirror 6 lazily with only the extensions used: line numbers, active line, history, search.
- Theme it from kat tokens. Show the path in the top bar with the directory muted and the file name bold.
- Save through `PUT` with the previous SHA-256 as a precondition, and show a conflict if an agent wrote the file meanwhile.
- Show images and media with the media viewer, and other binary files as a download.

**Done when.** A conflict never overwrites the other writer's content.

### P8-09 Export a chat as markdown

`deps: P2-08` `difficulty: 1` `area: frontend`

**Verify.** `bun test apps/web-solid/src/chat/export.test.ts` passes a fixture transcript to expected markdown.

**Goal.** Let a user take a conversation out of kiko without a share link.

**Files.** Create `apps/web-solid/src/chat/export.ts`.

**Build.**

- Page through the room's history and write one markdown file with author, time, and text per message.
- Download it from the client. Create no URL on the server.

**Done when.** The export of a 5,000-message chat completes without freezing the page.
