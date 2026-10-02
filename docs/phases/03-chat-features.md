# Phase 3. Chat features

This phase brings the chat itself to Telegram grade. Most tasks are independent and run at the same time, each inside its own component files. Two files are shared, `apps/web-solid/src/chat/VirtualThread.tsx` and the bubble component. A task that must edit one of them keeps the edit to the smallest insertion point and says so in its pull request.

Reference code is in `solid-refs/tweb/src/`, with file pointers in `docs/research/frontend-refs.md`. Port techniques, not files. tweb is GPL-3.0, and kiko's own code must be written fresh.

## Tasks

### P3-01 Port the typing indicator

`deps: P2-01` `difficulty: 3` `area: frontend`

**Verify.** `bun test apps/web-solid/src/chat/typing` passes the presence state machine cases, and the `verify-kiko` typing feature shows the wave, the label change from one name to two, and the send shrink.

**Goal.** Port the reference component to Solid with the same behavior and no React.

**Read first.** `docs/reference/typing-indicator.react.tsx`. Architecture section 19.5.

**Files.** Create `apps/web-solid/src/chat/typing/create-typing-presence.ts`, `typing/TypingIndicator.tsx`, `typing/typing.css`, and tests.

**Build.**

- Port `useTypingPresence` as `createTypingPresence` with `ping`, `send`, `clear`, and `reset`, the 3000 ms timeout, the 900 ms minimum, the beat counter, and the 340 ms send phase.
- Port `describe` exactly, including "and 2 others".
- Drive the three dots with one CSS keyframe animation of 1.25 s and a delay of one third of the period per dot. Scale runs 0.74 to 1 and opacity 0.32 to 1.
- Precompute the two springs as CSS `linear()` easings and animate enter, exit, and send with the Web Animations API from the bottom-left origin.
- Update the `role="status"` text 700 ms after the label changes. Under reduced motion, show static dots and fade only.

**Done when.** Unit tests cover timeout, minimum visible time, send while typing, and a ping during the send phase.

### P3-02 Reverse swipe to reply

`deps: P0-02` `difficulty: 2` `area: frontend`

**Verify.** `bun test apps/web-solid/src/lib/useSwipeToReply.test.ts` passes with a rightward drag, and the `verify-kiko` swipe feature shows the reply icon entering from the left.

**Goal.** Make the reply icon appear from the left side, as the spec requires.

**Read first.** `docs/research/frontend-current.md`, the swipe-to-reply note. `apps/web-solid/src/lib/useSwipeToReply.ts`.

**Files.** `apps/web-solid/src/lib/useSwipeToReply.ts`, `apps/web-solid/src/ui/SwipeToReply.tsx`.

**Build.**

- Accept a rightward drag. The row slides right by up to 64 px and the icon sits at the left edge.
- Fire the reply at 48 px. Cancel when vertical movement passes 20 px.
- Keep the trackpad wheel path working in the new direction.
- Scale and fade the icon with the drag distance. Respect reduced motion.

**Done when.** A leftward drag does nothing and vertical scroll is never blocked.

### P3-03 Render rich text and code blocks

`deps: P0-03, P2-03` `difficulty: 3` `area: frontend`

**Verify.** `bun test apps/web-solid/src/chat/rich` passes a tree-to-DOM table, and `bun scripts/bundle-budget.ts` shows sugar-high outside tier 2.

**Goal.** Render the server's rich text tree, with highlighted code.

**Read first.** Architecture section 6.4.

**Files.** Create `apps/web-solid/src/chat/rich/RichText.tsx`, `rich/CodeBlock.tsx`, `rich/rich.css`.

**Build.**

- Render every node type from `@kiko/protocol` with plain Solid components. Never set `innerHTML`.
- Load `sugar-high` lazily and highlight a code block when it first becomes visible. Show plain monospace text until then.
- Add a copy button to code blocks and a horizontal scroller for wide tables.
- Open links in a new tab with `rel="noopener noreferrer"`.

**Done when.** A message with 50 code blocks scrolls without a long task.

### P3-04 Collapse long messages

`deps: P2-01` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` read-more feature: a 3,000-character message is clamped with a fade and a chevron, expands in place, and the scroll position of the messages below does not jump.

**Goal.** Add "read more" as kat shows it.

**Read first.** `docs/research/kat-ui.md`, the bubble types list. `solid-refs/tweb/src/helpers/dom/onQuoteClick.ts` for scroll anchoring.

**Files.** Create `apps/web-solid/src/chat/Collapsible.tsx`.

**Build.**

- Clamp a bubble past a height threshold with a gradient fade and a chevron.
- Expand and collapse with no animation. Keep the viewport anchored on the tapped bubble.
- Remember the expanded state per message for the session.

**Done when.** `virtua` remeasures the row and no blank gap appears.

### P3-05 Port system messages and dividers

`deps: P2-01` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` dividers feature shows a date divider, the "new messages" divider at the first unread message, and an inline system event, each matching `~/kat-images`.

**Goal.** Port the astryx `ChatSystemMessage` pattern to Solid.

**Read first.** `docs/research/frontend-refs.md`, section 3. `docs/research/kat-ui.md`, the dividers list.

**Files.** Create `apps/web-solid/src/chat/SystemMessage.tsx`. Edit the existing date chip and unread rule to use it.

**Build.**

- One component with `variant: "default" | "divider"`, an optional icon, and children.
- The date divider and the unread divider use `role="separator"`. A live inline event uses `role="status"`.
- Style the unread divider with accent lines at 45 percent opacity and an accent label.
- Keep the sticky date pill and its calendar popover.

**Done when.** The three uses share one component and one stylesheet.

### P3-06 Bring the media viewer to Telegram parity

`deps: P2-01` `difficulty: 4` `area: frontend`

**Verify.** The `verify-kiko` media viewer feature: open from a thumbnail, pinch or wheel zoom to 4x, pan inside bounds, swipe to the next item, swipe down to close, and see the image return to its thumbnail.

**Goal.** Make the lightbox behave exactly like Telegram's.

**Read first.** `docs/research/frontend-refs.md`, section 2a. `solid-refs/tweb/src/components/mediaViewer/base.ts`.

**Files.** `apps/web-solid/src/chat/media/mediaViewer.tsx` and its helpers.

**Build.**

- Animate open and close as a move from the thumbnail's rectangle, reading geometry before writing styles.
- Zoom from 0.5 to 4 with pinch, wheel, and double tap. Bound panning to the image.
- Commit a horizontal swipe past 20 percent of the width or 125 px. A vertical swipe closes.
- Load the viewer as a tier 3 chunk and preload it on pointer down on a thumbnail.
- Play video in the viewer with the player from P3-08 when that task has merged, and with native controls until then.

**Done when.** The open and close run on the compositor with no layout in the animation frames.

### P3-07 Bring albums and multi-file attachments to parity

`deps: P2-01` `difficulty: 3` `area: frontend`

**Verify.** `bun test apps/web-solid/src/lib/album.test.ts` passes layouts for 1 to 10 items against the expected rectangles, and the `verify-kiko` album feature matches Telegram for 2, 3, 4, and 7 images.

**Goal.** Make grouped media look and behave like Telegram.

**Read first.** `docs/research/frontend-refs.md`, section 2b. `solid-refs/tweb/src/components/groupedLayout.ts`.

**Files.** `apps/web-solid/src/lib/album.ts`, the media bubble, and the composer attachment tray.

**Build.**

- Check the layouter against tweb's cases: fixed patterns for 2 to 4 items, the complex layouter for 5 or more, ratios clamped to 0.667 through 2.75.
- Derive corner radii from the position of each item in the group.
- Let the composer hold several files, show them as a tray, reorder by drag, and remove one. Send them as one album.
- Documents and mixed files stack as a list, not a grid.

**Done when.** The test table covers portrait, landscape, and mixed groups.

### P3-08 Build the audio and video player

`deps: P2-01` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` player feature: play an audio file, scrub, start a second one and see the first stop, and control playback from the keyboard media keys.

**Goal.** Replace native media controls with a Telegram-style player.

**Read first.** `docs/research/frontend-refs.md`, section 2f.

**Files.** Create `apps/web-solid/src/chat/media/player/` (`playback.ts`, `AudioBubble.tsx`, `VideoPlayer.tsx`).

**Build.**

- One playback controller for the app, so only one item plays at a time, with `mediaSession` metadata and handlers.
- An audio bubble with play, a scrubber, and duration. Draw a waveform when the server supplies one.
- Video controls for play, scrub, mute, and full screen.
- Stop decoding when the tab is hidden and the item is paused.

**Done when.** The player chunk is tier 3 and loads on the first media bubble that scrolls into view.

### P3-09 Port the link preview card

`deps: P2-01, P0-03` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` link preview feature against the mock: a card with site name, title, description, and image renders in a bubble, and the composer shows the same preview with a remove button.

**Goal.** Show link previews like Telegram, from data the server supplies.

**Read first.** `docs/research/frontend-refs.md`, section 2c. `solid-refs/tweb/src/components/wrappers/webPage.tsx`.

**Files.** The existing link card component in `apps/web-solid/src/chat/`, and the composer top plate.

**Build.**

- Lay out the card as site name, title, text, media, with the accent bar on the left. Support a large image and a small square image.
- In the composer, preview the first URL in the draft in the same plate that reply uses. Guard against a stale response by comparing the URL at resolve time.
- Request previews only from `/api/link-preview`. Delete the dev proxy from `vite.config.ts` when P8-02 has merged.
- Load images only from kiko's origin.

**Done when.** The card renders from a protocol fixture with no network call.

### P3-10 Add micro-motion

`deps: P2-01` `difficulty: 2` `area: frontend`

**Verify.** `bun test apps/web-solid/src/styles/motion.test.ts` passes. It fails if a transition is declared on a navigation, button, menu, tab, or composer selector.

**Goal.** Add the small motions the spec allows and prove the forbidden ones stay absent.

**Read first.** Architecture section 19.5.

**Files.** Create `apps/web-solid/src/styles/motion.css` and the test.

**Build.**

- Reaction pop, attachment add and remove (fade and scale), calendar open, toast enter, and incoming bubble fade.
- Put every duration and easing in tokens. Wrap everything in `prefers-reduced-motion: no-preference`.
- Use transform and opacity only.
- Write the test that scans the CSS for transitions on the forbidden selectors.

**Done when.** With reduced motion on, no element animates.

### P3-11 Add stop, edit, regenerate, and pinned messages

`deps: P2-08` `difficulty: 3` `area: frontend`

**Verify.** `bun kiko verify message-actions` passes on the server side, and the `verify-kiko` message actions feature shows stop ending a run, an edit of the last message rerunning the answer, and a pinned message in the top bar.

**Goal.** Give the human control over a run and over their own messages.

**Read first.** Architecture sections 6.2 and 9.2.

**Files.** The message menu and the composer in `apps/web-solid/src/`. `apps/server/src/room/socket.ts` for `regenerate` and `pin`.

**Build.**

- Turn the send button into a stop button while a run is active. It sends `stop`.
- Editing the last human message sends `edit`. The room deletes the answer that followed and delivers the edited message.
- Regenerate on the last agent answer does the same without an edit.
- Pin and unpin a message, with a pinned bar under the top bar and jump to message.
- Add a jump-to-first-unread control.

**Done when.** Every action applies optimistically and rolls back on a server error with a toast.

### P3-12 Add message search to the room

`deps: P1-04` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify room-search` passes: it finds a word in an old message, finds nothing after that message is deleted, and returns results in under 50 ms for a room with 20,000 messages.

**Goal.** Search one chat's messages on the server.

**Read first.** Architecture section 9.2.

**Files.** Create `apps/server/src/room/search.ts`. Edit `room/schema.ts`.

**Build.**

- Add an FTS5 table over message text, kept in step with insert, edit, and delete in the same transaction.
- Add a `search {query, before?, limit}` request and a paged response with message ids, snippets, and `seq`.
- Search chat titles across chats in `UserDO`. Searching message text across all chats is out of scope.

**Done when.** The suite passes and an edit updates the index.

### P3-13 Build the search screen

`deps: P3-12, P2-08` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` search feature: type a query, see results in a virtual list, click one, and land on that message with a highlight.

**Goal.** Let a person find a message and jump to it.

**Files.** Create `apps/web-solid/src/search/`.

**Build.**

- A search field in the top bar that opens a results panel rendered with `virtua/solid`.
- Debounce the query by 150 ms. Show cached results from IndexedDB first, then server results.
- Jump to a message by loading the window around its `seq`.

**Done when.** A jump to a message that is not loaded works and keeps scroll stable.

### P3-14 Build the command palette and slash commands

`deps: P2-16, P2-07` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` palette feature: `⌘K` opens the palette with `type a command...` focused and the first row highlighted, typing filters, Enter on `chat: new` creates a chat, `chats: go to chat...` (`⌘P`) lists chats, Escape closes, and typing `/` in the composer lists commands.

**Goal.** Build kat's command palette on the command registry, and add composer commands.

**Read first.** `~/kat-images/screenshot 20.png`, which the owner named as the target. `docs/research/kat-ui.md`, the overlays list and screenshot 20 notes.

**Files.** Create `apps/web-solid/src/palette/` and `apps/web-solid/src/composer/slash.ts`.

**Build.**

- Use `cmdk-solid` for filtering and keyboard navigation, styled with kat tokens. If it does not fit, use Kobalte's combobox and say why.
- Match screenshot 20: a centred panel about 560 px wide near the top of the window, the menu background, about 14 px radius, a borderless `type a command...` input, 32 px rows with an icon, the label, and the shortcut keys right-aligned and muted. The first row is highlighted. No animation.
- Rows come from the registry in P2-16, in registry order when the input is empty, and ranked by match when it is not. Disabled commands do not show.
- `⌘P` opens the same palette in chat mode, listing chats from the user store.
- Slash commands in the composer from the same registry (`/new`, `/remind`, `/skill:`), filling the existing empty slash list.
- Load the palette as tier 3 and preload it on the first modifier key press.

**Done when.** Opening the palette has no animation and takes one frame after preload.

### P3-17 Show time dividers after a gap, not only at a new day

`deps: P3-05` `difficulty: 2` `area: frontend`

**Verify.** `bun test apps/web-solid/src/chat/lib/time-label.test.ts` passes a table of cases, and the `verify-kiko` dividers feature shows `today 12:02 pm` and `today 2:22 pm` between two same-day messages two hours apart, with no divider between messages ten minutes apart.

**Goal.** Show a time divider wherever the conversation paused, the way kat, Instagram, and iMessage do, so a reader sees when the talk picked up again.

**Read first.** `apps/web-solid/src/chat/lib/grouping.ts`, `lib/dayLabel.ts`, and the `SystemMessage` divider from P3-05. The owner's kat screenshot shows `today 12:02 pm` and `today 2:22 pm` on the same day.

**Files.** `apps/web-solid/src/chat/lib/grouping.ts`, `chat/lib/dayLabel.ts`. Create `chat/lib/time-label.ts` and its test.

**Build.**

- No package. Use `Intl.DateTimeFormat` with the user's locale and time zone, lowercased.
- Insert a divider before a message when it starts a new calendar day, or when it comes more than 1 hour after the message before it. ASSUMPTION: 1 hour is the gap, as in iMessage. It is one named constant.
- Label by age: `today 2:22 pm`, `yesterday 9:10 am`, the weekday within the last 6 days (`monday 4:05 pm`), `sep 14, 9:00 am` within this year, and `sep 14 2025, 9:00 am` before it.
- Keep the floating date chip as it is. Recompute labels when the day changes, without a remount.
- Model the rule as one pure function from two timestamps and `now` to a label or nothing.

**Done when.** A burst of messages never gets a divider inside it, and every pause over the threshold gets exactly one.

### P3-15 Show tool activity and agent status

`deps: P2-08` `difficulty: 3` `area: frontend`

**Verify.** `bun kiko verify activity` passes on the server side, and the `verify-kiko` activity feature shows a chevron on an agent bubble that expands to the tools the run used.

**Goal.** Let the human see what an agent did to produce an answer.

**Read first.** Architecture section 9.2, the `status` frame. `docs/research/kat-ui.md`, the chevron on bubbles.

**Files.** Create `apps/web-solid/src/chat/Activity.tsx`. `apps/server/src/agent/outbox.ts` for the activity summary.

**Build.**

- On the server, attach to the last bubble of a run a short list of tool calls with name, a one-line argument summary, and status. Truncate each line to 200 characters.
- On the client, show a chevron on that bubble and expand in place with no animation.
- Show the live state (thinking, tool name) next to the typing indicator while a run is active.

**Done when.** Tool arguments that contain a credential pattern are redacted in the summary, and a test proves it.

### P3-16 Persist drafts and scroll position

`deps: P2-07` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` drafts feature: type in chat A, switch to chat B, reload, return to chat A, and see the draft and the same scroll position.

**Goal.** Never lose what the user typed or where they were.

**Files.** `apps/web-solid/src/warm/drafts.ts`, the composer, and `VirtualThread.tsx`.

**Build.**

- Save the draft and the reply target per chat to IndexedDB, debounced by 300 ms.
- Save the anchor message and offset per chat on route leave and restore them on entry.
- Show a draft marker on the chat row and the tab.

**Done when.** Switching chats restores both in the first painted frame.
