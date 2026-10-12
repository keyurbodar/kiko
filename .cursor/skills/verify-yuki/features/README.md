# Yuki verification map

This directory is the maintained source for verifying the user-facing behavior of Yuki. Read the index before driving the app, then use the matching feature file as the recipe.

The map reflects what exists **today**. Yuki is a chat app laid out in one row: a sidebar down the left edge, a top bar over the chat, a bubble-styled transcript filling the rest of the viewport, a composer docked below it, and one token layer behind all of it. Routes swap the main panel, and the appearance setting picks the light or dark scale. Where a recipe depends on a module that has not landed, the file says so and gives the reason: a gap is recorded, never papered over with an invented selector.

## Baseline preconditions

- **Use `http://localhost:<port>/`, never `http://127.0.0.1:<port>/`.** The Vite server binds the IPv6 loopback only. Measured: `curl` to `127.0.0.1:3017` exits `7` (connection refused) and to `localhost:3017` answers `200`. Every URL in this map uses `localhost`; one that uses `127.0.0.1` fails at the connection, not at the assertion.
- **Always pass `{ waitUntil: "domcontentloaded" }` to `page.goto`.** The transcript's media never finishes loading, so the `load` event does not arrive and the default times out on a healthy app. Pair it with an explicit `timeout: 60000`. `domcontentloaded` alone has still timed out on a cold Vite module graph. Then `waitForFunction` on the condition you care about.
- **`page.on` does not exist** (`typeof page.on === "undefined"`). To capture console errors and uncaught exceptions, inject listeners before the app boots with `await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source })`, then read the array with `page.evaluate`. Registering it after `goto` misses every error the module graph already threw. See the Drive section in `../SKILL.md` for the exact snippet.
- **`openMenu` and `openPicker` return what happened, they do not guarantee it.** `openMenu` dispatches a real `contextmenu` and then tests `[role='menu'], [data-component*='menu']`, so it returns `true` and `probe().overlay` reads `"menu"` even though `[data-component="chat-menu"]` is `0`: the menu's content element carries `data-component="menu-v2-content"` instead, because `MenuV2.Content` overwrites the prop. **Read the boolean, then read the menu by `.chat-menu` or `[data-component="menu-v2-content"]`.**
- **`openPicker` opens the menu, clicks `.chat-menu__more`, and waits for `[data-component='emoji-picker']`.** Read its boolean like `openMenu`'s.
- Launch the dev server per `../SKILL.md` **Launch**, with the Worker for the signed-in shell, and keep `/tmp/yuki-verify-evidence/vite.pid` in place.
- Port 3001 unless a sibling Yuki checkout already owns it; then a free port, used consistently in every later step.
- `../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- Never drive an instance this run did not start. A port that answers but is not owned by your pid is another checkout's app.

## Driving conventions

- The harness is `ego-browser nodejs`. There is no Playwright and no Puppeteer here; a script that imports `chromium` from Playwright fails.
- One TaskSpace per goal. Print `space.id` and pass it back via `await taskSpace(<id>)` in later rounds; every invocation is a fresh Node process.
- Page globals do not exist in the Node script. Put `window`/`document` access inside `page.evaluate()`.
- Read colour with `getComputedStyle`. `src/theme/apply.ts` writes the palette's tokens inline on `<html>`, and `getComputedStyle` returns the value the page uses either way.
- **There is no `chat.css`.** The chat slice is inline Tailwind utilities on the component that renders the element, plus the token layer. `apps/web-solid/src/styles/` holds `app.css`, which declares the `@layer` order and imports kat and the icon styles, and `motion.css`. **A `.chat-*` class is a QA handle, not a style hook**, many exist only so a probe can find the element, and several components say so in their own source comments (`.chat-chip-anchor` "is a handle, not a style", `.chat-chip` "is a QA handle, not a style", the `harness-*` set survives "because a named node is still easier to find in devtools"). Assert computed values; never conclude a value holds "because the class is applied". Component stylesheets sit beside their components. The bubble shape is in `chat/ui/bubble.css`, which `bubble.tsx` imports. `sidebar/sidebar.css` and `composer/composer.css` style their own areas.
- The vendored v2 component set is repointed at the kat palette and sits in `@layer v2`, below `utilities`. A chat menu asking for `p-2`, `rounded-[calc(20px*var(--brm))]` and `min-w-[200px]` wins against the vendored `2px` / `6px` because of that layer order, and an unlayered rule would beat every utility regardless of specificity. See [Kat token layer](./kat-tokens.md).
- The transcript is a bubble column inside a virtualized scroller, not a list of text rows. Hover actions (`chat-actions`) show on a pointer device only, see [Chat interactions](./chat-interactions.md). The sidebar has its own file, see [Sidebar](./sidebar.md).
- **An unlayered rule silently beats every utility, and margin was the casualty once already.** A bare `* { margin: 0 }` in `packages/ui/src/styles/kat.css` beat Tailwind's `@layer utilities` and killed every margin utility in the app: `mx-auto` computed to `0px` and the 768px transcript column sat pinned to the left edge with every width reading correctly. It is now inside `@layer base`. **Assert the column's centring by absolute position, not by the token**: see [Kat token layer](./kat-tokens.md).
- Drive the chat slice through its harness page, `http://localhost:<port>/src/chat/harness.html?state=<slug>`, and use `window.__chat` for state changes and counts. The composed app (`/`, which lands on `/chat/<id>` once signed in) is the **only** place the composer exists, and it is the right place for a proof about the page as a user gets it.
- Treat every command as literal. Keep the port and paths exactly as written.
- Do not edit a source file to make an assertion pass. A failing check is a finding to report.
- `bun test` resolves `solid-js` to its server build, where `createMemo` never re-runs. A unit test that derives state passes on a stale value, so anything derived belongs in these browser recipes rather than in a `bun test`.

## Proof and skip reporting

- Evidence goes to `/tmp/yuki-verify-evidence/`, and it must still be there after cleanup. The artifact names are listed in `../SKILL.md` **Evidence**.
- Capture the action and the resulting state, not only a final screenshot.
- Assert from the script's own output: the `console.log` value is the doc.
- A rule that must be *absent* (no borders, no animation, no uppercase body) is proven by reading computed style over every candidate element and logging the match count next to the violation count. A count of zero violations over a selector that matched nothing proves nothing.
- Record the port, the feature id, and the entry point with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with ego-browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Kat token layer](./kat-tokens.md): the one stylesheet behind every colour, type step and corner radius: the roles resolve, the Tailwind bridge works, the four self-hosted fonts actually load, and both the light and the dark scale resolve, and the Mode setting picks one.
- [App shell](./app-shell.md): the mounted page: the title, the unique root, and the full-height flex row that holds the sidebar beside the transcript pane and the composer dock; the top bar over the chat, and the appearance setting.
- [Chat bubbles](./chat-bubbles.md): the visual contract of the column: the 736px centred measure, the `min(calc(100% - 3.5rem), 36rem)` fit-content cap, the 18px radius with 6px joints inside a run and a tail on the last bubble, run collapse and break, the bare jumbo emoji sizes, the sticky lowercase day chip and its calendar jump, plus the no-border, no-animation and lowercase-chrome probes. Every value is a Tailwind utility on `apps/web-solid/src/chat/ui/*.tsx`, and the bubble primitives are reached by `[data-slot="bubble"]` / `[data-slot="bubble-content"]`.
- [Chat interactions](./chat-interactions.md): what a reader can do to a message: the right-click menu on both sides, the hover actions and quick reactions, reaction badges, the reply quote and its jump, the unread rule, the emoji picker, and the typing bubble.
- [Rich text](./rich-text.md): what a message body does with the runs inside it: urls become anchors, a mention and a hashtag stay prose with more weight, sentence furniture is trimmed off a url, a scheme-less host is gated on a real TLD, and a homograph host keeps its text and loses its href behind a confirm dialog.
- [Message attachments and the image dialog](./chat-images.md): the composer's thumbnails and file rows, the drop overlay, a sent message's picture grid and file rows, and the image dialog a picture opens.
- [Files panel](./files-panel.md): the chat's right panel on Files: file tabs and their keys, the header crumbs and actions, the explorer, every viewer with its limits, and the image dialog's zoom.
- [Sidebar](./sidebar.md): the conversation column's left edge: the chat and settings panels, collapsing and coming back, drag-resize with its 220/420 clamps, the pinned grid and how it reflows, row unread states, the hover preview, and the right-click menu whose items mutate real state. Handles are `[data-component="sidebar"]`, `sidebar-row`, `sidebar-pin-tile`, `sidebar-unread-count`, `sidebar-resize`, `sidebar-add`, `sidebar-chats`, `sidebar-empty` and `hover-card-v2-content`.
- [Composer](./composer.md): the dock below the transcript: the prompt input, the send path that appends to the store, the reply bar a hover action, the menu or a quote arms, the emoji button and `:shortcode` list, and the scroll-to-latest button. The composer exists **only in the composed app at `/`**. The harness mounts `MessageList` alone.

## Fixture states

`FIXTURE_STATES` in `apps/web-solid/src/lib/fixtures.ts` is the record of chat slug to messages, and `window.__chat.states()` returns the same thirty-six keys at runtime. Every slug returns a non-empty message list, and an unknown slug falls back to `today`. The harness's own state readout says so: `[data-component="harness-state"]` renders `Unknown state: <slug>`, so a typo is visible on the page rather than silent.

| Slug | State |
| --- | --- |
| `read-more` | a 3,000 character body between short rows, clamped until expanded |
| `pause-gap` | a pause over an hour inside one day, which draws a divider; ten minutes does not |
| `grouped` | three consecutive agent messages, one run |
| `run-gap` | a run broken by a gap longer than the 300s grouping window |
| `run-break-reply` | a run broken because the next message replies to something else |
| `long` | a long multi-paragraph body, so the 80% cap binds |
| `jumbo-single` | one jumbo-sized pure-emoji body |
| `jumbo-group` | a run of jumbo emoji |
| `jumbo-prose` | a jumbo run that also contains prose |
| `link` | links in the body: the text draws them and nothing else |
| `reply-text` | a reply to a text message |
| `reply-image` | a reply to a message with a picture, so the quote carries a thumbnail |
| `grid-2` / `grid-3` / `grid-4` / `grid-5` | the picture grid at four counts; an odd count leaves one tile on the last row |
| `grid-shapes` | a pano, a square and a portrait, all cropped to the same 4:3 tile |
| `picture-only` / `picture-caption` | a lone picture with no body, and one with a line of text |
| `video` | clips, which are file rows like any other file |
| `picture-link` | a picture and a link in one message |
| `rich-text` | every run the body parser has to tell apart on one line |
| `reactions` | a cluster: one chip the viewer has pressed beside a counted chip they are not part of |
| `edited` | the edited marker on a body that was not rewritten |
| `pinned` | a pinned message, plus the reply that follows it |
| `three-days-ago` / `yesterday` / `today` | the day boundaries, for the date chip |
| `unread` | an unread division with a rule before the first unread incoming message, and rows above **and** below it |
| `file-single` / `file-group` | one PDF with a caption; three files on an old agent message plus a docx from the viewer |
| `user-grid-3` / `user-grid-2-reply` / `user-picture` | the viewer's own pictures, pictures sent as a reply, and a lone picture |
| `link-only` | messages that are only a link; they draw as ordinary bubbles |
| `grouped-own` | three consecutive viewer messages in one run, then a two-message agent run |

Load one with `?state=<slug>`, or move between them in a round with `page.evaluate((slug) => window.__chat.setState(slug), "<slug>")`. Assert `probe().state` and `[data-component="harness-state"]` before measuring.

**No harness state spans two calendar days**, so `probe().dayLabels` is `[]` in every one of them and no `[data-component="chat-divider"]` is ever mounted in the harness. That is correct: each day-boundary state is a slice that starts on its own day, so the timeline builder never needs to insert a divider. A recipe that needs a divider reads it at `/`, where the active thread does span days. Do not treat an empty `dayLabels` as a fixture gap.

## Known gaps and probe defects

These are measured, not inferred. Each is a **defect in a probe or an expectation in this map**, and none of them means the surface under test is broken.

- **`probe().viewer`, `openMedia()` and `closeMedia()` read `[data-component="image-dialog"]`**, the dialog's inner column. `ModalV2.Content` overwrites a `data-component` passed to it, so the handle cannot live on the modal itself. `openMedia` is async: the dialog body loads on first open.
- **`openPicker` has no target to click.** It looks for `[data-component='chat-add-reaction']`, then `.chat-add-reaction`, then the row, and `MessageRow` renders none of the first two: so the fallback click lands on a row with no add-reaction control and the picker never opens. Measured `false` with `overlay: null` on every message in the `today` state. Drive the picker by hand through `.chat-menu__more`.
- **`probe().runs` counts `data-run="start"`, which is a tail fact and not a per-run count.** `data-run` is `start` / `mid` / `bot` where `bot` means *last of its run*, so a single isolated message reports `0` and a three-message run also reports `1`. Measured on `grouped`: rows `start`/`mid`/`bot` with `runs: 1`; on `run-gap`: rows `bot`/`start`/`bot` with `runs: 1` and two rows carrying `data-gap`. **Assert run structure on `data-gap` and `padding-top`.**
- **`[data-component="chat-menu"]` matches nothing.** `MenuV2.Context.Content` overwrites the `data-component` prop with its own, so the open menu is `[data-component="menu-v2-content"]` with the class `.chat-menu` on the same element. Measured `0` and `1` respectively, with the menu visibly open.
- **The date chip follows the top visible day.** `VirtualThread` passes `dayStart={topVisibleDay() ?? dayStartOf(now())}` to `DateChip`, so the label comes from the transcript's scroll position and falls back to today only when no day is visible. Read the label and `title` off `[data-component="chat-day-chip"]`. Expect a different label for a different day state, and report a label that stays `today` as a regression.
- **`.chat-divider__label`, `[data-component="chat-image-trigger"]`, `[data-slot="chat-image"]`, `.lightbox*`, `[data-component="chat-bubble"]` and `[data-component="chat-surface"]` do not exist.** Measured `0` for each on a live harness page. The day label is `[data-component="chat-day-label"]`; the bubble is `[data-slot="bubble"]`; the media is `[data-component="chat-media"]`; the chat's picture viewer is `[data-component="image-dialog"]`; the transcript pane is `[data-component="chat-shell"]` and the stage is `[data-component="chat-stage"]`.
- **The reply jump resolves its target by text, not by id.** The quote exposes no parent id and the harness has no jump probe, so a jump recipe must match a row's `.bubble-text` against the quote's text and say in the artifact that the target was resolved by content. Do not assert a jump against a guessed id.
- **The reply *retirement* path now exists, but only in the composed app.** The composer is mounted on `/chat/<id>` and its send path calls `useApp.appendMessage`, which is what retires the unread rule. It is absent from the harness, so this recipe runs at `/chat/<id>` and not on a fixture state.