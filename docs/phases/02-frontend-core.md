# Phase 2. Frontend core

This phase turns the fixture-driven template in `apps/web-solid` into an app with routes, a tiny HTML shell, local storage, and a live connection. It runs at the same time as Phase 1. Until P2-08, the client talks to a mock room that replays fixture frames from `@yuki/protocol`.

Measurements for layout and color are in `docs/research/kat-ui.md`. When that file and `~/kat-images` disagree, the screenshots win.

## Tasks

### P2-01 Rewrite the theme to the kat values

`deps: P0-02` `difficulty: 3` `area: frontend`

**Verify.** Run the `verify-yuki` skill's theme check. Sampled pixels of the sidebar, the panel, an assistant bubble, and a user bubble match `#0b0a09`, `#131211`, `#221f1e`, and `#66422f` within 2 per channel.

**Goal.** Make the app look like kat by changing tokens, not components.

**Read first.** Architecture section 19.8. `docs/research/kat-ui.md`, the replica theme and repo theme sections.

**Files.** `packages/ui/src/styles/kat.css`. Create `packages/ui/src/styles/tokens.md`.

**Build.**

- Set the hue to 55, make the sidebar darker than the panel, and set the user bubble to kat's brown. Keep the `--cm` chroma multiplier as the one control for accent strength.
- Set sizes from the screenshots: 60 px rail, 280 px sidebar, 768 px column, 50 px top bar, bubble padding 7 px by 12 px, radius 18 px and 8 px for stacked corners, 14 px text, 1.45 line height, 2 px between bubbles in a stack.
- Keep the system font stack. Keep the light tokens defined and unused.
- Add tokens for the tab strip, date pill, calendar, palette, editor gutter, clamp fade, reply bar, approval card, and board.
- Reduce the four icon systems to one sprite and list the icons in `tokens.md`.

**Done when.** No component file contains a raw color value.

### P2-02 Build the app shell and the routes

`deps: P0-02, P0-14` `difficulty: 3` `area: frontend`

**Verify.** Open `/chat`, `/files`, `/board`, `/memory`, and `/settings` directly by URL. Each paints the rail with the right item active, and the browser back button returns to the previous route.

**Goal.** Give the app URLs and the kat frame around every screen.

**Read first.** Product document, "Screens and routes". Architecture section 19.3.

**Files.** `apps/web-solid/src/main.tsx`. Create `apps/web-solid/src/app/routes.tsx`, `app/shell.tsx`, `app/rail.tsx`, `app/top-bar.tsx`, and one placeholder file per route.

**Build.**

- Use `@solidjs/router` with one `lazy()` route per rail item. The chat route keeps the existing transcript and composer.
- Build the rail (chat, files, board, memory, and settings at the bottom), the sidebar container, the main panel with its 32 px top-left corner, and the top bar.
- Leave out kat's terminal, browser, notification, and share controls.
- Switch routes with no transition.

**Done when.** The rail's local tab signal is gone and the URL is the only source of the active route.

### P2-03 Build the HTML shell and split the bundle by tier

`deps: P2-02` `difficulty: 4` `area: frontend`

**Verify.** `bun scripts/bundle-budget.ts` passes: `index.html` is at most 20 KB, and the JS loaded before first paint of `/chat` is under the budget the task records in the script.

**Goal.** Paint something in the first response and load the rest in tiers.

**Read first.** Architecture section 19.3. `docs/research/frontend-refs.md`, the t3code shell notes.

**Files.** `apps/web-solid/index.html`, `apps/web-solid/vite.config.ts`. Create `apps/web-solid/src/bootstrap.ts` and `scripts/bundle-budget.ts`.

**Build.**

- Inline the critical CSS, the theme variables, and the app icon in `index.html`. Hold the shell until the first route's chunks have loaded, then swap.
- Load tier 2 from `bootstrap.ts` with a dynamic import. Mark tier 3 and tier 4 modules with `lazy()` and list them in the budget script.
- Reload once on `vite:preloadError`.
- Write `bundle-budget.ts` to read the build manifest and fail when a tier grows past its recorded size plus 5 percent.

**Done when.** The budget script prints one line per tier with its gzip size.

### P2-04 Build the horizontal tab strip

`deps: P2-01, P2-02` `difficulty: 3` `area: frontend`

**Verify.** Run the `verify-yuki` tab strip feature: open three chats, close the middle one, and reload. The same tabs return in the same order with the same active tab.

**Goal.** Port kat's tab strip for open chats.

**Read first.** `docs/research/kat-ui.md`, "Horizontal tab navigation". `~/kat-images/screenshot 8.png`.

**Files.** Create `apps/web-solid/src/app/tab-strip.tsx` and `app/open-tabs.ts`.

**Build.**

- Tabs are 28 px tall with a 10 px radius, 13 px medium text, a 172 px maximum width, a 13 px glyph, and a label that fades out at the edge.
- The active tab has a raised pill and a close button. An unread tab shows a dot.
- Persist the open tabs and their order locally. Middle click and the close button close a tab. The strip scrolls sideways when it overflows.
- Activating a tab is a route change with no animation.

**Done when.** Keyboard users can move between tabs with the arrow keys and close with Delete.

### P2-05 Build the IndexedDB warm tier

`deps: P0-02, P0-03` `difficulty: 4` `area: frontend`

**Verify.** `bun test apps/web-solid/src/warm` passes with `fake-indexeddb`, including a schema version bump that drops the stores.

**Goal.** Keep recent data on the device so the app paints before the network answers.

**Read first.** Architecture section 19.2. `docs/research/frontend-refs.md`, the t3code IndexedDB notes.

**Files.** Create `apps/web-solid/src/warm/db.ts`, `warm/messages.ts`, `warm/chats.ts`, `warm/outbox.ts`, `warm/drafts.ts`.

**Build.**

- Use raw IndexedDB behind a small promise wrapper. No library.
- Stores: `chats`, `messages` keyed by `[roomId, seq]`, `outbox` keyed by `clientId`, `drafts`, `media`, and `meta` for `lastSeq` per room and the schema version.
- Read the newest N messages of a room with a reverse cursor.
- Batch writes and flush them with `requestIdleCallback`, at most every 500 ms.
- Wrap every call so a blocked or missing IndexedDB degrades to memory only.

**Done when.** Writing 10,000 messages and reading the newest 50 takes under 50 ms in the test.

### P2-06 Build the sync client with optimistic patches

`deps: P2-05` `difficulty: 5` `area: frontend`

**Verify.** `bun test apps/web-solid/src/sync` passes against the mock room: send while offline, reconnect, and see one message; receive a `reset`; apply 1,000 events without a dropped frame of work over 8 ms.

**Goal.** Build the layer that keeps Solid stores, IndexedDB, and the server in agreement.

**Read first.** Architecture sections 9.2, 9.3, and 19.2.

**Files.** Create `apps/web-solid/src/sync/socket.ts`, `sync/room-store.ts`, `sync/user-store.ts`, `sync/patches.ts`, `sync/mock-room.ts`.

**Build.**

- One reconnecting socket per room and one for the user, with backoff and `hello {lastSeq}` on every connect.
- A room store that holds the visible message window and applies events in `seq` order.
- A pending-patch list over the server state. Drop a patch when its `clientId` is acknowledged.
- Write sends to the outbox first and resend them after a reconnect.
- A mock room that implements the protocol in memory from the shared fixtures.

**Done when.** Every user action in the store API returns before any network call resolves.

### P2-07 Replace the fixture store with the sync client

`deps: P2-06, P2-02` `difficulty: 4` `area: frontend`

**Verify.** `bun test` passes in `apps/web-solid`, and the app runs against the mock room with `src/lib/fixtures.ts` deleted from the production import graph.

**Goal.** Put the real data layer under the existing components.

**Read first.** `docs/research/frontend-current.md`, section 3.

**Files.** `apps/web-solid/src/lib/store.ts`, `src/lib/types.ts`, and the components that call `useApp`.

**Build.**

- Keep the `useApp` shape where it still fits and back it with the sync stores.
- Replace the local message types with the types from `@yuki/protocol`.
- Boot in the order from architecture section 19.2: shell, IndexedDB, sockets.
- Pass the real `firstUnreadMessageId` and typing names to the transcript, which `main.tsx` stubs today.
- Move the fixtures to the dev harness and the mock room only.

**Done when.** The transcript, the composer, and reactions work against the mock room with no fixture import outside tests and the harness.

### P2-08 Connect the chat to the real server

`deps: P2-07, P1-12` `difficulty: 3` `area: frontend`

**Verify.** Run the `verify-yuki` live chat feature against `bun dev:server`: send a burst of three messages, see one answer arrive as bubbles with a typing indicator between them, reload, and see the same transcript at once.

**Goal.** Make the browser talk to the Worker.

**Read first.** Architecture sections 6.3 and 9.1.

**Files.** `apps/web-solid/src/sync/socket.ts`, `apps/web-solid/vite.config.ts`. Create `apps/web-solid/src/chat/bubble-pacing.ts`.

**Build.**

- Proxy `/api` to the dev server in Vite, including WebSocket upgrades.
- Render draft frames as a growing bubble and replace the draft with the final block.
- Pace bubbles from a live run with the gap from section 6.3. Apply no gap to history or under reduced motion.
- Send `typing` frames from the composer at most once every 2 seconds.

**Done when.** The feature passes with the network throttled to "slow 3G" in the browser tools.

### P2-09 Build the sidebar chat list

`deps: P2-07, P2-01` `difficulty: 3` `area: frontend`

**Verify.** Run the `verify-yuki` sidebar feature with 2,000 chats in the mock: the list scrolls without blank rows, and pin, rename, and delete apply at once.

**Goal.** Finish the chat sidebar to match kat.

**Read first.** `docs/research/kat-ui.md`, the sidebar section. `~/kat-images/screenshot 9.png` through `13.png`.

**Files.** `apps/web-solid/src/sidebar/`.

**Build.**

- Render the chat list with `virtua/solid`. Rows have a 28 px avatar, a name, and a one-line preview.
- Keep the pinned tiles at 48 px with a two-line caption.
- Add the header with `chat` and a `+` button, the new-chat popover, and the context menu from kat (rename, pin, mute, mark as unread, close, delete). The `+` only starts a chat. It never toggles the sidebar.
- Put a search field with a filter button at the top of the list, as MonoCode does. Typing filters the list by title and preview locally.
- Lay each row out the way MonoCode does, in kat's colors: a muted first line with the agent's avatar and name on the left and the relative time on the right, with an unread dot before the time; a bold title line; and a muted one-line preview.
- Apply every action optimistically through the user store.

**Done when.** The list stays on `virtua/solid` and no row renders outside the viewport plus overscan.

### P2-15 Give the sidebar its own toggle

`deps: P2-02` `difficulty: 2` `area: frontend`

**Verify.** In a real browser, the panel icon at the top of the rail and the toggle shortcut each collapse and reopen the sidebar with no animation, the `+` button opens only the new-chat menu, and the collapsed state survives a reload.

**Goal.** Stop hiding the sidebar toggle behind the `+` menu and behind clicking the active rail item.

**Read first.** `apps/web-solid/src/app/shell.tsx`, `app/rail.tsx`, `sidebar/sidebar.tsx`. MonoCode's layout, which the owner chose as the reference: a panel icon is the first item in the icon rail and toggles the list column.

**Files.** `apps/web-solid/src/app/rail.tsx`, `app/shell.tsx`, `sidebar/sidebar.tsx`, `sidebar/icons.tsx`.

**Build.**

- Add a sidebar-panel icon as the first rail item, above the sections. It toggles the sidebar and shows its state with `aria-expanded`.
- Remove `toggle sidebar` from the `+` menu, and stop toggling when the active rail item is pressed. One control, one shortcut.
- Bind a toggle shortcut, ignoring it while focus is in the composer or another text field. P2-16 moves it to kat's `⌘S`.
- Keep the collapsed state in the shell and persist it in `localStorage`.

**Done when.** No code path other than the rail icon and the shortcut changes the collapsed state, except the resize handle snapping shut.

### P2-16 Add the command registry and keyboard shortcuts

`deps: P2-15` `difficulty: 3` `area: frontend`

**Verify.** `bun test apps/web-solid/src/commands` passes, and in a real browser `⌘S` toggles the sidebar, `⌘T` opens a new chat, `⌘W` closes the active tab, and none of them fire while the composer has focus except those marked global.

**Goal.** Give every action one entry in one registry, with its shortcut, so the palette, the menus, and the keyboard all run the same code.

**Read first.** `~/kat-images/screenshot 20.png`, kat's command palette and its shortcut map. The `@tanstack/solid-hotkeys` README in `node_modules` after install.

**Files.** Create `apps/web-solid/src/commands/` (`registry.ts`, `hotkeys.ts`, `kat-commands.ts`, tests). Edit `app/shell.tsx` and `sidebar/sidebar.tsx` only to register their actions.

**Build.**

- A typed registry: `{ id, title, group, icon, shortcut?, global?, when?, run }`. Titles use kat's `noun: verb` form in lowercase. A route or feature registers its commands on mount and they leave on unmount.
- Bind shortcuts with `@tanstack/solid-hotkeys` (`createHotkey`, `Mod` for `⌘` or `ctrl`). If it fails in practice, use `tinykeys` and say why in the pull request.
- Start with kat's map: `view: toggle sidebar ⌘S`, `chat: new ⌘T`, `chat: reopen closed ⌘⇧T`, `chat: attach file... ⌘O`, `chat: rename F2`, `chat: pin ⌘D`, `chat: close ⌘W`, `chat: delete`, `chats: go to chat... ⌘P`, `chats: search messages in current chat ⌘F`, `chats: search all chats ⌘⇧F`, and `palette: open ⌘K`. A command whose feature does not exist yet stays registered and disabled. Leave out `chat: share`, since yuki has no share links.
- Move the sidebar toggle from P2-15 to `⌘S` through the registry.
- Single-key and plain shortcuts never fire while a text field has focus. `⌘K` and `⌘S` are global.
- Export a list of all shortcuts for a later cheatsheet.

**Done when.** No component calls `addEventListener("keydown")` for an app shortcut. Every shortcut lives in the registry.

### P2-17 Fill the sidebar for every section

`deps: P2-19` `difficulty: 2` `area: frontend`

**Verify.** With `agent-browser`, each rail section shows its own sidebar panel and none shows "not built": chat shows pinned tiles and the chat list, files shows the chat picker and the file tree, and settings shows its section list. Switching sections has no animation and keeps each panel's scroll position.

**Goal.** Give every rail section a sidebar, so the column is never empty.

**Read first.** `apps/web-solid/src/sidebar/sidebar.tsx`, which receives `section` from the shell. `~/kat-images/screenshot 9.png` to `15.png`.

**Files.** `apps/web-solid/src/sidebar/`. Create `settings/sidebar.tsx`. Edit `app/sections.ts`, `app/rail.tsx`, and `app/routes.tsx` to remove the board. Move the memory record list from the main panel into the sidebar if P5-04 put it there.

**Build.**

- One panel component per section, chosen from a table keyed by `SectionId`. Each loads lazily except chat.
- Remove the board section: the rail has chat, files, and settings (memory moved into the chat info panel in P2-19), and `/board` redirects to `/chat`. A group's tasks live in the chat (P6-09).
- The header shows the section name and its one primary action: new chat, new file, or nothing for settings.
- Settings: providers, models, integrations, skills, account. Selecting one routes to `/settings/<name>`.
- Keep the collapse toggle, width, and resize handle shared by all panels.

**Done when.** `sidebar.tsx` has no "not built" text.

### P2-18 Let users theme everything with JSON

`deps: P2-01, P4-05, P1-05` `difficulty: 4` `area: frontend`

**Verify.** `bun test apps/web-solid/src/theme` passes, including a table of bad themes that each name the wrong key. With `agent-browser`: paste a theme that sets the accent, bubble radius, message spacing, and font, see it apply live, save it, reload with no flash of the old theme, see it on a second browser profile signed in as the same user, then reset to kat.

**Goal.** Let a user change any visual token by pasting a JSON theme, with radius, spacing, type, and colors all in reach.

**Read first.** `packages/ui/src/styles/tokens.md` and `kat.css`. t3code's approach, which yuki extends: `refs/t3code/apps/web/src/themePalette.ts` (`ThemeFile` at line 47, `parseThemeFile` at line 1352, `applyThemePalette` at line 1516) and `components/settings/ThemeImportDialog.tsx`. t3code themes colors only; yuki themes every token.

**Files.** Create `apps/web-solid/src/theme/` (`schema.ts`, `apply.ts`, `presets/`, `editor.tsx`, tests) and `docs/theming.md`. Edit `apps/server/src/user/` for one theme record, `core/protocol` for one user event, and the HTML shell for the pre-paint script.

**Build.**

- A versioned format: `{ "version": 1, "name", "extends": "kat-dark" | "kat-light" | <id>, "appearance": "dark" | "light", "colors": {...}, "radius": {...}, "spacing": {...}, "type": {...}, "size": {...}, "variants": { "light": {...} } }`. Every key maps to one existing CSS variable from `tokens.md`. Missing keys inherit from `extends`, so a two-line theme works.
- Groups. `colors`: every surface, text, accent, bubble, border, and status token. `radius`: bubble, panel, menu, button, input, tile, chip, and a `scale` multiplier. `spacing`: a `scale` multiplier plus bubble padding, row gap, run gap, rail and sidebar padding. `type`: UI and mono font families, base size, line height, weights. `size`: rail width, sidebar default width, row heights, composer height, avatar sizes.
- A `tokens` escape hatch: `{ "--any-token-from-tokens.md": value }`. Unknown variable names are refused. There is no raw CSS field.
- Validate by hand, as t3code does, so the theme code stays out of Effect and tiers 1 to 2. Check colors and lengths with `CSS.supports`, clamp numbers to ranges, and report each problem as `radius.bubble: expected a length, got "big"`. A theme with errors is never applied.
- Apply by setting CSS variables on `document.documentElement`, the way `applyThemePalette` does. Preview a draft live and revert on cancel.
- Persist in `UserDO` (one record, synced to every device by a user event) and cache the applied variables in `localStorage`. A tiny inline script in the HTML shell applies the cache before first paint, so a reload never flashes.
- Settings, appearance: presets (kat dark, kat light, and two more), a JSON editor with inline errors (CodeMirror, lazy), paste, import a `.json` file, export, and reset.
- Navigation, menus, and the composer keep 0 ms animation. Themes cannot change that, and the format has no motion keys.
- Document every key with its default in `docs/theming.md`, generated from `schema.ts` by a script so the two never drift.

**Done when.** Every variable in `tokens.md` is reachable from the format, and a theme can never break the app: the worst a bad value does is fail validation.

### P2-19 Build the chat info panel and fold memory into it

`deps: P1-11, P2-09, P5-04, P8-08, P4-05` `difficulty: 4` `area: frontend`

**Verify.** With `agent-browser`: clicking the chat's avatar or title in the tab strip or top bar opens the info panel on the right with no animation, `Escape` closes it, and its scroll survives switching chats. A one-agent chat shows the agent, its model, mute and pin toggles, memory about this chat, links, media, and files. A link or file sent in the chat appears in its card without a reload. Editing a memory record from the panel shows the new version in its history. The rail no longer has a memory item, and `/memory` opens the panel's memory view.

**Goal.** Put everything about one chat behind one click on its name, as Telegram's profile and kat's chat panel do, and remove the separate memory section so the user never leaves the chat.

**Read first.** The owner's kat reference: the panel opened from a chat tab, with header, members, lock and mute, links, and files. `docs/reference/group-chat/`. The memory screen from P5-04 and the files panel from P8-08.

**Files.** Create `apps/web-solid/src/chat/info/` (panel, sections, tests). Create `apps/server/src/room/catalog.ts` for the links and media lists. Edit `app/shell.tsx`, `app/top-bar.tsx`, `app/tab-strip.tsx`, `app/sections.ts`, `app/rail.tsx`, `app/routes.tsx`, and move `apps/web-solid/src/memory/` into the panel.

**Build.**

- A right-hand panel, 360 px, resizable, toggled by the chat avatar or title in the tab strip and top bar, by `⌘I`, and by the command `chat: info`. It is lazy, so the chat route does not grow.
- Sections, each a card that opens a full list inside the panel with a back arrow:
  - **Header.** Large avatar, inline-editable name, and a subtitle: `started <date>` for a one-agent chat, `<n> members` for a group.
  - **Members.** Avatars in a row with names, the human first with a crown, and an `add` button. In a one-agent chat, adding an agent turns it into a group. Each agent opens a card with role, model, status, and rename or remove. P6-08 builds on this.
  - **Model.** The model this chat uses, with the picker from P4-05.
  - **Toggles.** Mute and pin. Lock is left out: yuki has no per-chat lock yet.
  - **Memory.** Records this chat created or used most, then `all memory` for the full searchable list, with view, edit, history, pin, archive, and delete from P5-04. Memory stays per user; the panel only filters it.
  - **Links.** Every link sent in the chat with title and site, newest first.
  - **Media.** A grid of photos and videos that opens the media viewer.
  - **Files.** The room's files with size, opening the file viewer from P8-08.
  - **Danger zone.** Export as markdown (P8-09 when it lands), clear history, delete chat.
- A room RPC and socket frame return links and media from the room log, paged, newest first, built from the stored messages and file index. Live updates arrive as room events.
- Remove the memory rail item and route. `/memory` and `/memory/:id` redirect to the active chat with the panel open on memory.
- Reserve section slots for tasks and notes (P6-09) and reminders (P5-07). They render only when the feature exists.

**Done when.** Nothing about one chat needs another section of the app, and the rail has chat, files, and settings.

### P2-10 Add intent-based preloading

`deps: P2-03, P2-07` `difficulty: 3` `area: frontend`

**Verify.** `bun test apps/web-solid/src/lib/intent.test.ts` passes, and in the browser's network panel a hover of 80 ms on the files rail item fetches the files chunk before the click.

**Goal.** Load what the user is about to open, and nothing else.

**Read first.** Architecture section 19.3.

**Files.** Create `apps/web-solid/src/lib/intent.ts`. Edit the rail, the tab strip, and the sidebar rows.

**Build.**

- `createIntent(el, onIntent)` fires on pointer hover for 80 ms, on pointer down, and on keyboard focus. Build it from `@solid-primitives/event-listener` and `@solid-primitives/scheduled`.
- On a route link, preload the route chunk. On a chat row, read that chat's newest messages from IndexedDB into memory.
- Do nothing while the tab is hidden or the connection reports `saveData`.
- Cancel the timer when the pointer leaves.

**Done when.** Moving the pointer across ten rows without stopping preloads nothing.

### P2-11 Throttle work in background tabs

`deps: P2-06` `difficulty: 2` `area: frontend`

**Verify.** `bun test apps/web-solid/src/sync/visibility.test.ts` passes: after 30 seconds hidden the room socket is closed, and on return the store resyncs from `lastSeq`.

**Goal.** Spend nothing on a tab nobody is looking at.

**Read first.** Architecture section 19.6.

**Files.** Create `apps/web-solid/src/sync/visibility.ts`.

**Build.**

- Use `@solid-primitives/page-visibility`. When hidden, stop typing pings, preloading, animation loops, and idle IndexedDB work.
- Close the room socket after 30 seconds hidden. Keep the user socket.
- On return, reconnect and resync.

**Done when.** A hidden tab makes no network request for 5 minutes in the test.

### P2-12 Mount toasts and i18n, and lowercase every string

`deps: P2-02` `difficulty: 1` `area: frontend`

**Verify.** Copy a message in the app and see the toast. `bun test apps/web-solid/src/copy.test.ts` passes, which fails on any interface string with an uppercase letter.

**Goal.** Fix two mounting bugs and apply the lowercase voice.

**Read first.** `docs/research/frontend-current.md`, section 9.

**Files.** `apps/web-solid/src/app/shell.tsx`, the i18n dictionaries in `packages/ui/src/i18n/`.

**Build.**

- Mount `ToastV2.Region` and `I18nProvider` in the shell.
- Move every interface string into the dictionary and make each one lowercase. Proper nouns that a user typed stay as typed.
- Add the test that scans the dictionary.

**Done when.** The copy toast appears and the test passes.

### P2-13 Build sign-in and session bootstrap

`deps: P2-02, P1-02` `difficulty: 2` `area: frontend`

**Verify.** With no session, `/chat` shows the sign-in screen. After `bun yuki login --dev --browser`, a reload shows the chat.

**Goal.** Let a person sign in and keep the session across reloads.

**Read first.** Architecture section 10.

**Files.** Create `apps/web-solid/src/app/sign-in.tsx` and `app/session.ts`.

**Build.**

- A sign-in screen with Google and GitHub buttons in the kat style, loaded as its own chunk.
- A session check on boot that reads a cached flag first and confirms with `/api/me` in the background.
- On 401 from any call, clear the warm tier for that user and show sign-in.

**Done when.** Signing out removes that user's IndexedDB data.

### P2-14 Audit the frontend verification skill

`deps: P2-08, P2-09, P2-04` `difficulty: 3` `area: docs`

**Verify.** The `maintain-verification-skill` run ends with every feature in `.cursor/skills/verify-yuki/features/` either proven in a live session or corrected, and its report is in the pull request.

**Goal.** Bring the existing verify skill in line with the routed, live app.

**Read first.** `.cursor/skills/verify-yuki/SKILL.md`.

**Files.** `.cursor/skills/verify-yuki/`.

**Build.**

- Run the `maintain-verification-skill` skill.
- Add feature files for routes, the tab strip, the sidebar, live chat, and offline send.
- Remove steps that depend on the deleted fixture store.

**Done when.** The skill's map lists every feature this phase added.
