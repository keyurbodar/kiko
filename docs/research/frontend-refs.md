# Frontend reference research (yuki)

Paths are relative to /Users/keyur/Documents/kiko. T3 = refs/t3code, TW = solid-refs/tweb/src (tweb).
Everything below was read in the repos or fetched; "NOT FOUND" means searched and absent.

## 1. t3code

### 1.1 IndexedDB
- Raw IndexedDB, no library (no idb / idb-keyval / dexie in apps/web/package.json). Wrapped in Effect callbacks.
- Main DB: `apps/web/src/connection/storage.ts:46-47` name `t3code:connection-runtime`, version 4. Stores (`:49-53`, created in `upgradeneeded` at `:144-161`): `catalog`, `shell`, `thread`, `server-config`, `vcs-refs`. Out-of-line keys, values are JSON strings.
- What is cached: connection catalog doc (`:304-309`, corrupt copies kept under `document:corrupt:<ts>`), per-environment shell snapshot (key = environmentId, `:587-622`), per-thread detail snapshot (key `${envId}:${threadId}`, `:248`, `:664-700`), server config, VCS refs.
- Schema versioning per record: `schemaVersion` literal in each stored struct (`:57-77`); comment `:63-70` explains v2 (store snapshot sequence), v3 (paginated windows), v4. Old versions fail decode -> treated as cold cache (rollback safety).
- Other DBs: `apps/web/src/cloud/dpop.ts:49-104` (DPoP key store), `apps/web/src/assets/projectFaviconCache.ts:15-43` (favicon blobs; deletes unknown stores on upgrade).
- Hydration on boot: `packages/client-runtime/src/state/shell.ts:55-71` loads cached shell from `cache.loadShell`, state `status: "cached"` (statuses `empty|cached|synchronizing|live`, `:30`). Threads: `state/threads.ts:197-233` loads cached thread, seeds `lastSequence` from `snapshot.snapshotSequence`, status `cached`.
- Reconcile with server: shell WS subscribe sends `afterSequence: snapshotSequence` (`shell.ts:251`); items are `snapshot` or `event`; events applied only if `item.sequence > snapshot.snapshotSequence` (`shell.ts:157-165`); status flips to `live` (`:151-170`). If the cache cursor is not trustworthy, an authoritative HTTP snapshot is fetched first (`shell.ts:209-238`, `state/shellSnapshotHttp.ts`) and the cursor is omitted on failure. Threads use the same cursor resume (`threads.ts:829-853`, `retryExpectedFailureAfter: "250 millis"` `:853`; dedupe `item.event.sequence <= sequence` `:467-468`).
- Write-back: sliding queue of size 1 + `Stream.debounce("500 millis")` (`shell.ts:77`, `:94-95`, `:184`) so IDB writes are coalesced.
- Lesson for yuki: sequence-cursor resume + cache-first `cached` status + versioned records + debounced persist. T3 stores whole JSON snapshots per thread (not per-message rows), which is not a Telegram-grade bar for long histories; yuki should store messages as rows keyed by (chat, id).

### 1.2 Initial HTML shell
- `apps/web/index.html`, 20,123 bytes (~20 KB), almost all of it an inline blocking `<script>` (IIFE) that resolves theme from localStorage (keys `t3code:theme`, `t3code:themes:v1`, ...), sets `html.dark`, `documentElement.style.backgroundColor`, `<meta theme-color>` and `--boot-background/foreground/accent` CSS vars before first paint. Includes a duplicated copy of built-in palettes ("keep in sync", `:57-62` comment) and a try/catch fallback to OS preference.
- Inline `<style>` (`#boot-shell`, `#boot-shell-card` 96px, `#boot-shell-logo` 64px, `#boot-error`), and markup inside `#root`: `<div id="boot-shell"><img id="boot-shell-logo" src="/apple-touch-icon.png">` (a separate cached PNG, not inlined data URI). Module entry `/src/bootstrap.ts`.
- React's first commit replaces `#root` content. `src/main.tsx` comment: it resolves all chunks needed for the first commit (initial route chunks, managed-auth shell) before rendering so the splash holds until real UI paints (`startup` promise). `src/bootstrap.ts` is 4 lines: `import("./main").then(({startup}) => startup).catch(showBootError)`; `lib/bootError` writes into `#boot-error`.
- Technique worth copying: tiny inline script for theme + inline CSS + one icon, then dynamic import of main. Do not copy the 20 KB palette duplication.

### 1.3 Code splitting / preloading
- TanStack Router with `tanstackRouter({ autoCodeSplitting: true })` (`apps/web/vite.config.ts:~170-174`) and `defaultPreload: "intent"` (`apps/web/src/router.ts:13`): route chunks fetched on hover/focus intent.
- React `lazy()` for heavy panels: `components/ChatView.tsx:615-624` (PreviewPanel, DiffPanel, DevicePanel, FilePreviewPanel), `settings/ThemeEditorHost.tsx:16`, `pullRequest/PullRequestDetailPanel.tsx:259-260` (`loadCodeTab` function reused so it can be preloaded manually), `files/AttachmentFilePreview.tsx:39`, `lib/imageCompression.ts:503` (`heic-to` dynamic import only when needed), `main.tsx:48-52` (Clerk auth shell only when configured).
- Stale-chunk recovery: `window.addEventListener("vite:preloadError")` -> one guarded reload (`main.tsx:30-40`).
- No `modulepreload` or service worker found (`rg preload` only hits Electron/media attributes). Vite 8 / rolldown ("vite-plus").

### 1.4 Realtime + optimistic updates
- Protocol: typed WebSocket RPC (Effect RPC), `packages/client-runtime/src/rpc/{client,session}.ts`; subscriptions via `subscribeDynamic(ORCHESTRATION_WS_METHODS.subscribeShell, ...)` (`shell.ts:196-258`). Server event-sourced; each event has a monotonic `sequence`. Connection supervisor with retry delay (`connection/supervisor.ts:104`), wakeup-driven resubscribe on foreground (`shell.ts:191`, `connection/wakeups.ts`).
- Optimistic: `state/threadLifecycle.ts:18-100` `createOptimisticThreadLifecycle`: a `pending` list of pure `apply(thread)` functions layered over the server snapshot atom; derived atom re-applies pending updates, skipping those whose `sequence <= snapshot.snapshotSequence`. On command success the server returns `{sequence}`; the pending item is removed when the snapshot reaches that sequence (`:~85-100`). On failure it is removed (rollback). Used by `state/threadCommands.ts:267-337` (settle, snooze, pin, reorder). Chat sending itself is not an optimistic row in this file; do not assume it is.
- Pattern to port: overlay-of-pending-patches keyed by server sequence (no manual merge, no rollback bookkeeping).

### 1.5 AGENTS.md format (refs/t3code/AGENTS.md, 170 lines)
- Tone: direct, imperative, second person ("you" defined as the agent), opinionated, short sentences, some humor; includes "A note from Theo" in first person; says rules are "good defaults" the developer can override.
- Top to bottom H1/H2/H3 order:
  1. `# T3 Code` + 2-paragraph product description.
  2. `## What makes T3 Code special?` with three-to-four numbered H3 non-negotiables (Open at the core, Performance without compromise, Remote ready, Multi-surface).
  3. `## A note from Theo` (philosophy: yagni, smallest model, do not preserve complexity).
  4. `## A small glossary` (bold term + one-line definition; "you", "we", "user", "agent", "provider", "client", "environment", "project", "thread", "turn").
  5. `## The three ways to hurt yourself` (numbered, each a bolded name + concrete prohibition + why).
  6. `## Hit every surface` (checklist bullets, bold lead-in per surface).
  7. `## Dev servers`, `## Test data` (with a runnable bash block), `## Verifying` (smallest proof, "Do not run repo-wide checks"), `## Pull requests` (title convention, body shape, evidence rules), `## Documentation` (what to document / not), `## Plans and work artifacts`, `## How it works` (one paragraph architecture), `## Where code lives` (package -> one-line role), `## Taste` (short style rules), `## Additional tips`.
- Conventions: bold lead-in phrases at start of bullets, backtick commands and paths, relative links to docs, almost no tables, no emoji, rules always paired with the failure they prevent. Roughly 2.5-3k words.
- (For comparison, TW AGENTS.md uses a "Project Overview", "Tech Stack" table, "Development" bash block, then topic sections.)

## 2. tweb (solid-refs/tweb/src)

Stack facts from `solid-refs/tweb/AGENTS.md:1-40`: Solid.js (custom fork `src/vendor/solid/`), TS, Vite, SCSS, IndexedDB + CacheStorage + localStorage, SharedWorker + ServiceWorker. Much of the chat is still imperative DOM, not Solid; port ideas, not code.

### (a) Media viewer / lightbox
- Files: `components/mediaViewer/base.ts` (3039 lines, core), `index.ts` (601, chat media + prev/next, `openMedia` :479), `static.ts`, `avatar.ts`, `rtmp.ts`, `clipPath.ts`, `snapshotSize.ts`, `shouldSnapshotImage.ts`. `appMediaViewerNew.ts` is entirely commented out (only `export const z = 1` at :1417): ignore.
- Open animation: `base.ts:1181` `setMoverToTarget(target, closing, fromRight)`. A "mover" element is positioned over the thumbnail's `getBoundingClientRect`, then transitions to the final rect; same function reverses for close. Reads geometry before any style writes (comment `:1185-1188`), uses a clip-path to crop to the thumbnail (`clipPath.ts`). Handles closing while zoomed or rotated by transferring the live transform from `moversContainer` to the mover (`:1203+`).
- Zoom/pan: constants `base.ts:86-89` (step 0.5, min 0.5, max 4). `SwipeHandler` with `onZoom` (pinch), `onDoubleClick` (zoom to `ZOOM_INITIAL_VALUE+2` at the tap point or reset) `base.ts:527-593`; pan bounded by `adjustPosition`; debounced clamp (`:523`); "zoom part from WebZ" (`:1`). Pinch details in `components/swipeHandler.ts:420-436, 502-509`.
- Swipe between items: same handler `base.ts:546-565`: horizontal swipe commits if >20% of window width or >125px (prev when xDiff>0, next otherwise); vertical >20% height or >125px closes. Disabled while zooming. Slide transition `moveTheMover` `base.ts:1946`.
- Video: `lib/mediaPlayer/index.ts:40` `VideoPlayer extends ControlsHover` (custom controls, `speedDragHandler.tsx`, `playbackRateButton.tsx`, `qualityLevelsSwitchButton.tsx`, `preview.tsx` seek thumbnails); HLS via `lib/hls`; progressive video streamed by the service worker (see d).
- Port: mover-over-thumbnail FLIP, one gesture handler with explicit thresholds, geometry-read-before-write.

### (b) Grouped media album layout
- `components/groupedLayout.ts` (503 lines): port of tdesktop `grouped_layout.cpp` (header comment :1-8, link :33). `Layouter` class `:34`, `layout()` `:59-77`: 1 item -> `layoutOne`; >=5 items or any ratio>2 -> `ComplexLayouter` (`:370+`, tries several line-count attempts via `multiHeight`/`pushAttempt` and picks the best); 2/3/4 items use hardcoded patterns (`layoutTwoTopBottom`, `layoutTwoLeftRight`, `layoutThreeLeftAndOther`, `layoutFourTopAndOther`, ...; `:79-300`). Ratios are cropped by `cropRatios` (clamp 0.6667..2.75, based on average ratio >1.1) `:~60-80`. Output: `{geometry:{x,y,width,height}, sides: RectPart bitmask}`; `sides` drives which corners get the bubble radius.
- Wrapper: `components/prepareAlbum.ts:1-88` converts geometry to percentage `top/left/width/height` on absolutely positioned children and radius via `sides`. Test: `tests/groupedLayout.test.ts`. Pure function, directly portable.

### (c) Link preview card
- Bubble: `components/wrappers/webPage.tsx` (152 lines, Solid): `WebPageBox` (`:93`) composed of `WebPageName` (site name, `:28`), `WebPageTitle` (`:49`), `WebPageText` (`:59`), `WebPageMedia` (`:69`, with `has-vertical-photo`/`has-square-photo` classes and an aspect-ratio "resizer" div), `WebPageFooter` (`:10`, link/button). Title/description helpers: `wrappers/webPageTitle.ts`, `webPageDescription.ts`. Used in `components/chat/bubbles.ts` (import :183; click handling `:3927-3933`, `.webpage-preview-resizer` opens media; `getWebPageActionOnClick.ts`). Data: `lib/appManagers/appWebPagesManager.ts`. Quote variant `:121`.
- Composer: `components/chat/input.ts:3789-3870`: on text change, extract first URL (`lastUrl`), `getWebPage(foundUrl)` + `canSend('embed_links')`, then `setTopInfo({type:'webpage', title: site_name||title, subtitle: description||url})` (`:5690`, link icon `:5730`) i.e. the preview shows in the same top "helper" plate as reply/edit/forward; `willSendWebPage` carries the object. Option menu (above/below text, larger/smaller media, remove) `:956-1006`; sent as `inputMediaWebPage` with `force_large_media`/`force_small_media` `:2533-2540`; `no_webpage` flag when removed `:2517`. Stale-response guard: compares `getWebPagePromise` and `lastUrl` `:3858`.

### (d) Large file upload / download
- `lib/appManagers/apiFileManager.ts`: part size adaptive `getLimitPart` `:515-533`: starts 64 KB (`MIN_PART_SIZE`), doubles until parts <= max parts (upload 4000, download 8000, premium raises, `:181-207`), capped 512 KB upload / 1 MB download (`:87-90`). Upload slices `File` into parts `:1092-1135` with parallelism from `getDelta` (`:511`) and progress reporting `:1162`. Files <= `MAX_FILE_SAVE_SIZE` = 20 MB (`lib/appManagers/constants.ts:18`) are saved in CacheStorage (`:813`, `:993`); bigger ones go to `downloadStorage` / streaming.
- Streaming playback: service worker `lib/serviceWorker/stream.ts` (410 lines): handles HTTP Range, aligns offsets to chunk grid (`alignOffset`), chunk 512 KB, 1 MB if file >75 MB (`:70, :385-390`), CacheStorage chunk cache (`:142-183`), read-ahead preload of next chunks and the file tail for mp4 `moov` (`:188-212`, `PRELOAD_SIZE` 20 MB `:22`), special Safari first-range response (`:219`). Requests parts from the main worker via message port (`requestFilePartFromWorker` `:95`).
- Save-to-disk: `lib/serviceWorker/download.ts` (178 lines, `ReadableStream` piped to a download response keyed by id), writers `lib/files/{streamWriter,memoryWriter,downloadWriter,downloadStorage}.ts`. SW router `lib/serviceWorker/index.service.ts:292-328` (`stream`, `download`, `hls_stream`). Entry `sw.ts` (2 lines, imports the service worker).
- Port: range-aware SW streaming + chunk cache is relevant only if yuki serves large user media; for AI chat start with plain `fetch` + Range-capable server and `<video>`; keep adaptive part-size idea for uploads (S3 multipart).

### (e) Thumbnails / blur placeholders
- Telegram "stripped thumbs" (~100-300 byte JPEG bodies): `helpers/bytes/getPreviewURLFromBytes.ts:9-17` holds a constant `JPEG_HEADER_HEX` (shared JPEG header with tables) and rebuilds a full JPEG by splicing size bytes into the header + tail `ffd9`, then a data URL. `helpers/getImageFromStrippedThumb.ts:8-32` renders it into an `<img>` or a blurred `<canvas>` (class `thumbnail`) via `helpers/blur.ts` (canvas filter, falls back to `vendor/fastBlur`; radius 2, 2 iterations `:6-7`, queued through `heavyQueue`). `components/wrappers/photo.ts:140-220` draws stripped blurred thumb first, then fades the real image in (`noFadeIn`, `blurAfter`). Same in `video.ts`, `sticker.ts:285-380` (SVG outline from bytes `createSvgFromBytes`).
- thumbhash/blurhash: NOT FOUND in tweb source (matches only unrelated words). For yuki (own server) store a ThumbHash (~25 bytes) per image, decode to a tiny canvas/data URL; see section 5.

### (f) Audio / voice / video player
- `components/audio.tsx` (989 lines): audio/voice message UI; `decodeWaveform` `:62-80` (packed waveform bytes -> bars), transcription `audioTranscription.tsx`. Global playback state/queue/media session: `components/appMediaPlaybackController.ts` (1316 lines; `navigator.mediaSession` actions `:189-203`; playlists via `MediaSearchContext`). Video/round video: `lib/mediaPlayer/index.ts`; round bubbles `components/chat/bubbleParts/roundVideoBubble.ts`. Voice recording: `components/chat/voiceRecording/`, `opus-recorder/`. Port: single playback controller singleton (one audio at a time, mediaSession), waveform decoding to bars.

### (g) Swipe-to-reply
- `components/chat/bubbles.ts:1894-1925` touch path (only `IS_TOUCH_SUPPORTED`), wheel (trackpad two-finger) path `:1927-1934`, controller `createReplySwipeController` `:1936-2062`.
- Direction: swipe LEFT (finger moves left): `handleHorizontalSwipe` (`helpers/dom/handleHorizontalSwipe.ts:19-39`) negates xDiff, cancels the gesture if |yDiff|>20 before horizontal dominates; bubble (and the group avatar) `translateX(-x)` (`:2004`). The reply icon (`bubble-gesture-reply-icon`, `Icon('reply_filled')`) is appended to the bubble and CSS-positioned `right: var(--message-beside-button-margin)`, vertically centered (`scss/partials/_chatBubble.scss:216-222`), i.e. it appears on the right side, revealed behind the sliding bubble.
- Thresholds: `MAX = 64px` travel clamp, `replyAfter = 0.75*MAX = 48px`; icon opacity = min(1, xDiff/48), icon gets `is-visible` at >=48; on release, if past 48 it calls `chat.input.initMessageReply` after a 250 ms slide-back transition (`:1936-2060`). Refuses for pinned chat, selection mode, can't-send, service/sending bubbles (`:1900-1914`). A tap that never moves leaves no DOM changes (lazy `begin`).

### (h) Reply / quote preview
- Composer plate: `components/chat/input.ts` `initMessageReply` `:5409`, `setTopInfo` `:5690` (shared by reply, edit, forward, webpage, suggested; type union `:255`). Bubble header: `components/chat/replyContainer.ts` (`ReplyContainer` :275, `wrapReplyMedia` :47, `wrapReplyDivAndCaption` :151), `components/wrappers/reply.ts`, `messageForReply.ts`, `messageForReplyContent.ts`, `messagePreviewIcon.ts`; reply media thumbnail with the same stripped-thumb path. Pinned: `components/chat/pinnedMessage.tsx`. Quote text selection reply is part of `initMessageReply`'s reply-to object.

### (i) Read more / collapse
- No "Read more" for long message bodies found (NOT FOUND). Collapsible quotes exist: `helpers/dom/onQuoteClick.ts:8-50` toggles `is-expanded` on `is-truncated` blockquotes, saving/restoring scroll position via `helpers/scrollSaver.ts` and `animateSomethingWithScroll` so the transcript does not jump; honored only when selection is collapsed; respects `liteMode`. Class generation in `lib/richTextProcessor/wrapRichText.ts`. Port: truncated-quote pattern with scroll anchoring.

### (j) Reactions animation
- `components/chat/reaction.ts` (1552 lines): `ReactionElement` custom element `:719` (registered `:1551`), per-reaction assets `static_icon`, `select_animation`, `appear_animation`, `around_animation`, `center_icon` (`:274-302`, `:817`). `fireAroundAnimation` `:1107, :1183-1198` plays a Lottie effect (via `lib/lottie/lottieLoader`, worker-rendered canvas) around the icon; first-frame readiness awaited so the flight is not late (`:390`, `:558`, `:665` comments note cold Lottie parse ~1 s). Generic effect `ReactionGeneric` `:235`. Container/aggregation: `reactions.ts` (451), menu `reactionsMenu.ts`, `reactionContextMenu.ts`. Port: precompute/warm animation first frame; keep animation off the main thread.

### Notable tweb third-party packages (`solid-refs/tweb/package.json`)
- dependencies: `@tiptap/*` 3.28 (rich message input/editor: core, bold, italic, strike, underline, code-block, list, table, document, text, hard-break, extensions, pm) ; `temml` (LaTeX/MathML rendering).
- devDependencies of interest: `vite-plugin-solid` (Solid build), `@solid-primitives/refs`, `@solid-primitives/transition-group`; `hls.js` (adaptive video); `mediabunny` (media muxing/transcoding in browser, WebCodecs); `fflate` (gzip/deflate, e.g. TGS decompress); `libsodium-wrappers`, `@cryptography/{aes,sha1,sha256}`, `aes-js`, `big-integer`, `js-md5` (MTProto crypto, not needed by yuki); `highlight.js`, `prismjs` (code highlight); `tinyld` (language detection); `qr-code-styling`; `fast-png`, `pngjs` (image processing/tests); `@types/dom-webcodecs`; `fake-indexeddb` (tests); `vitest`, `@playwright/test`, `@axe-core/playwright`, `axe-core` (tests + a11y); `oxlint`; `sass`; `esbuild`; `vite` 8; `compression`/`express`/`http-proxy`/`ws` (local dev tooling). Telegram-grade needs: virtualized/anchored scroll (own code: `components/deferredSortedVirtualList.tsx`, `dynamicVirtualList/`), Lottie (own `src/vendor/tlottie`), workers (own `superMessagePort`).

## 3. Astryx ChatSystemMessage (VERIFIED, fetched via raw URL with curl)
Source: https://raw.githubusercontent.com/facebook/astryx/main/packages/core/src/Chat/ChatSystemMessage.tsx (React + StyleX, Meta copyright).
- API: `variant?: 'default' | 'divider'` (default `'default'`), `icon?: ReactNode`, `children: ReactNode`, `ref`, plus `BaseProps<HTMLDivElement>` (`className`, `style`, `xstyle`, rest DOM props). `themeProps('chat-system-message', {variant})` adds theme data-attrs.
- Structure: `default` -> `<div role="status" class=root><span class=content>{icon && <span class=icon>}{children}</span></div>`; root is `display:flex; align-items:center; justify-content:center; gap:spacing-2; padding-block:spacing-1; font body; size supporting; weight normal; color text-secondary; text-align:center`; content is `inline-flex` gap 1.5, icon `inline-flex; flex-shrink:0`. `divider` -> `<div role="status" width:100%><Divider label={children} /></div>` (the lines come from a separate `Divider` component, not read here, so its markup is UNVERIFIED).
- Accessibility: `role="status"` on root in both variants (implicit `aria-live=polite`, atomic). No icon aria-hidden handling (caller's responsibility). Note: `role="status"` on every date divider inside a long transcript makes screen readers announce on insertion; for yuki use `role="separator"` for date dividers and the unread divider (label via `aria-label`), and keep `role="status"` only for real inline events that arrive live.
- Doc comment lists intended use: "conversation started", date separators ("Today", "March 15, 2026"), "user joined", status changes. No sender, avatar, bubble or alignment.
- Solid port sketch: `ChatSystemMessage(props: {variant?: 'default'|'divider'|'unread'; icon?: JSX.Element; children})`; `Show` on variant; CSS custom properties instead of StyleX; divider = flex row with two `flex:1; height:1px` pseudo-lines and the label; `unread` = divider variant with accent color + `id` anchor for scroll-to. Use `<Dynamic>` or two branches; destructure via `splitProps`.

## 4. solid-refs primitives

NOTE: all of these dirs exist under /Users/keyur/Documents/kiko/solid-refs (corvu, kobalte, solid-primitives, tweb).

### Kobalte (`solid-refs/kobalte/packages/core/src`, @kobalte/core 0.13.14)
accordion, alert, alert-dialog, badge, breadcrumbs, button, checkbox, collapsible, color-area/channel-field/field/slider/swatch/wheel, combobox, context-menu, dialog, dismissable-layer, dropdown-menu, file-field, form-control, hover-card, image, link, listbox, live-announcer, menu, menubar, meter, navigation-menu, number-field, pagination, polymorphic, popover, popper, progress, radio-group, rating, search, segmented-control, select, selection, separator, skeleton, slider, spin-button, switch, tabs, text-field, time-field, toast, toggle-button, toggle-group, tooltip (plus i18n, list, primitives, colors). NOT FOUND in Kobalte: drawer/sheet, calendar/date-picker, OTP, resizable panels, virtual list.
Reuse for yuki: dialog/alert-dialog (modals), dropdown-menu + context-menu (message long-press/right-click menu, built on popper), popover, tooltip, hover-card (link previews on hover), tabs, toast + live-announcer (a11y announcements), select/combobox (model picker), image (load fallback), skeleton, file-field, switch, toggle-group, separator, dismissable-layer.

### Corvu (`solid-refs/corvu/packages`)
corvu (umbrella 0.7.2: accordion, calendar, dialog, disclosure, drawer, otp-field, popover, resizable, tooltip), `@corvu/dialog` 0.2.4, `@corvu/drawer` 0.2.4 (snap points, swipe-to-dismiss bottom sheet), `@corvu/otp-field` 0.1.4, `@corvu/calendar` 0.1.2, `@corvu/resizable` 0.2.5, `@corvu/popover` 0.2.0, `@corvu/tooltip` 0.2.2, `@corvu/disclosure`, `@corvu/accordion`, and utility packages solid-dismissible, solid-focus-trap, solid-list, solid-persistent, solid-presence, solid-prevent-scroll, solid-transition-size, utils. Reuse: drawer (mobile sheets, attachment/emoji panels), resizable (desktop sidebar), calendar (date jump), otp-field (login), solid-presence (exit animations), solid-prevent-scroll and solid-focus-trap for custom overlays like the lightbox.

### solid-primitives (`solid-refs/solid-primitives/packages`)
- Intent-based prefetch (hover/press): NOT FOUND as a package (no router/prefetch/preload package). Build from `event-listener`/`pointer`/`mouse` (pointerenter/touchstart/pointerdown + `scheduled`), or Solid Router's preload which is not in these refs.
- Page visibility: `page-visibility` 2.1.6, `createPageVisibility`, `usePageVisibility` (`src/index.ts:19,43`).
- Idle: `idle` 0.2.3 (`createIdleTimer`).
- Intersection observer: `intersection-observer` 2.2.5: `makeIntersectionObserver`, `createIntersectionObserver`, `createViewportObserver`, `createVisibilityObserver`, `withOccurrence`, `withDirection` (`:70-409`).
- WebSocket: `websocket` 1.4.0: `makeWS`, `createWS`, `createWSState`, `makeReconnectingWS`/`createReconnectingWS` (`:93-154`, retries/delay options), `makeHeartbeatWS` (`:185`).
- Storage: `storage` 4.4.0 (`makePersisted` and storage wrappers, localStorage/sessionStorage/IDB-like adapters; synchronous APIs only matter for small prefs, not message cache). `db-store` also exists.
- Scheduled/debounce: `scheduled` 1.5.3: `debounce`, `throttle`, `scheduleIdle` (requestIdleCallback), `leading`, `leadingAndTrailing`, `createScheduled` (`src/index.ts:32-285`).
- Media queries: `media` 2.3.6: `makeMediaQueryListener`, `createMediaQuery`, `createBreakpoints`, `createPrefersDark` / `usePrefersDark` (`:20-172`).
- Virtual lists: `virtual` 0.2.5: `createVirtualList`, `VirtualList` (`src/index.tsx:33,90`), fixed-row oriented; weak for chat (variable heights, bottom anchoring, prepend). Compare with virtua section 5.
- Also relevant: `connectivity` 0.4.6 (online signal), `resize-observer` 2.2.0, `bounds` 0.1.7, `scroll` 2.1.6, `gestures` 1.2.1, `pointer` 0.3.6, `upload` 0.1.5, `keyboard` 1.3.7, `raf`, `timer`, `lifecycle` 0.1.2, `static-store`, `broadcast-channel`, `workers`, `stream`, `sse`, `list`, `masonry`, `spring`/`tween`, `presence`, `transition-group`, `share`, `clipboard`, `fullscreen`, `permission`, `refs`.

## 5. npm facts (registry.npmjs.org latest, queried 2026-10-02)
| package | latest | notes |
|---|---|---|
| virtua | 0.52.10 | HAS Solid binding: export `./solid`; peer `solid-js >=1.0` (optional); also react/vue/svelte/angular. Unpacked 2.26 MB (all frameworks, tarball not what ships). Registry modified 2026-09-29. (A WebFetch summary printed "Jan 31, 2025" which contradicts the registry `time` field; trust `time`.) |
| sugar-high | 2.5.1 | zero-dep syntax highlighter; unpacked 99 KB; bundlephobia (secondhand, via fetch summarizer, re-check): 27.4 KB min, 10.3 KB gzip. Exports `.`, `./core`, `./lang`, `./lang/*`, `./gpu` (optional peer gpu-lexer). |
| @headless-tree/core | 1.7.0 | framework-agnostic core, no deps, 524 KB unpacked. Registry search shows only `@headless-tree/react` 1.7.0 as an official adapter; NO Solid adapter found (only an unrelated `@fluixi-ui/tree-view` alpha, `@headless-primitives/tree`). Solid use means writing your own thin adapter over core. |
| thumbhash | 0.1.1 | ESM, no deps, 12.9 KB unpacked, "very compact image placeholder". |
| fflate | 0.8.3 | no runtime deps; 797 KB unpacked (tree-shakable; description "8kB package"). |
| rrule | 2.8.1 | 687 KB unpacked, dep tslib, BSD-3, last published 2023-11-10 (stale). |
| @markwhen/rrule | 2.8.2 | fork of rrule, 634 KB unpacked, tslib, BSD-3. Not lighter in a meaningful way. |
| rrule-temporal | 2.2.8 | built on Temporal PlainDate/DateTime, MIT, 463 KB unpacked, dep `temporal-spec`; needs Temporal (native or polyfill). |
| rrule-rust | 3.1.1 | Rust, NAPI + wasm32-wasip1-threads, 268 KB unpacked, MIT; wasm needs threads/SharedArrayBuffer (COOP/COEP) in browser: poor fit for weak devices. |
| idb | 8.0.3 | promise wrapper over IDB, no deps, 82 KB unpacked. |
| idb-keyval | 6.3.0 | tiny keyval store, no deps, 56 KB unpacked (built output is far smaller; unpacked includes sources/maps). |

Recommendation inputs: unpacked size is NOT bundle size; measure with the bundler. For IDB, T3 uses raw IDB; yuki can use `idb` for row stores with indexes (messages by chat+id) and `idb-keyval` only for tiny blobs.
