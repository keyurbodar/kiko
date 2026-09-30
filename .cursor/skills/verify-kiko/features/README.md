# Kiko verification map

This directory is the maintained source for verifying the user-facing behavior of Kiko. Read the index before driving the app, then use the matching feature file as the recipe.

The map reflects what exists **today**. Kiko is a dark app laid out in one row: a sidebar rail-and-panel down the left edge, a bubble-styled transcript filling the rest of the viewport, a composer docked below it, and one token layer behind all of it. There is no top bar, no router, and no theme switch. Where a recipe depends on a module that has not landed, the file says so and gives the reason — a gap is recorded, never papered over with an invented selector.

## Baseline preconditions

- **Use `http://localhost:<port>/`, never `http://127.0.0.1:<port>/`.** The Vite server binds the IPv6 loopback only. Measured: `curl` to `127.0.0.1:3017` exits `7` (connection refused) and to `localhost:3017` answers `200`. Every URL in this map uses `localhost`; one that uses `127.0.0.1` fails at the connection, not at the assertion.
- **Always pass `{ waitUntil: "domcontentloaded" }` to `page.goto`.** The transcript's media never finishes loading, so the `load` event does not arrive and the default times out on a healthy app. Pair it with an explicit `timeout: 60000` — `domcontentloaded` alone has still timed out on a cold Vite module graph — then `waitForFunction` on the condition you care about.
- **`page.on` does not exist** (`typeof page.on === "undefined"`). To capture console errors and uncaught exceptions, inject listeners before the app boots with `await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source })`, then read the array with `page.evaluate`. Registering it after `goto` misses every error the module graph already threw. See the Drive section in `../SKILL.md` for the exact snippet.
- **`openMenu` and `openPicker` return what happened, they do not guarantee it.** `openMenu` dispatches a real `contextmenu` and then tests `[role='menu'], [data-component*='menu']`, so it returns `true` and `probe().overlay` reads `"menu"` even though `[data-component="chat-menu"]` is `0` — the menu's content element carries `data-component="menu-v2-content"` instead, because `MenuV2.Content` overwrites the prop. **Read the boolean, then read the menu by `.chat-menu` or `[data-component="menu-v2-content"]`.**
- **`openPicker` returned `false` on every message tried** in the `today` state, with `emoji-picker` absent. It looks for `[data-component='chat-add-reaction']`, then `.chat-add-reaction`, then falls back to the row — and `MessageRow` renders none of them. The picker is reachable by hand: open the menu, then click `.chat-menu__more`. Report an `openPicker` of `false` as a finding about the probe, not about the picker.
- Launch the dev server per `../SKILL.md` **Launch** and keep `/tmp/kiko-verify-evidence/vite.pid` in place.
- Port 3001 unless a sibling Kiko checkout already owns it; then a free port, used consistently in every later step.
- `../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- Never drive an instance this run did not start. A port that answers but is not owned by your pid is another checkout's app.

## Driving conventions

- The harness is `ego-browser nodejs`. There is no Playwright and no Puppeteer here; a script that imports `chromium` from Playwright fails.
- One TaskSpace per goal. Print `space.id` and pass it back via `await taskSpace(<id>)` in later rounds; every invocation is a fresh Node process.
- Page globals do not exist in the Node script. Put `window`/`document` access inside `page.evaluate()`.
- Colour is read with `getComputedStyle`, never with `document.documentElement.style`. The token layer is stylesheet rules now, so the inline style object is empty by design and reading it reports a palette that is actually there.
- **There is no `chat.css`.** The chat slice is inline Tailwind utilities on the component that renders the element, plus the token layer. `apps/web-solid/src/styles/` contains exactly one file, `app.css`, which is a `@layer` order declaration and four `@import` lines. **A `.chat-*` class is a QA handle, not a style hook** — many exist only so a probe can find the element, and several components say so in their own source comments (`.chat-chip-anchor` "is a handle, not a style", `.chat-chip` "is a QA handle, not a style", the `harness-*` set survives "because a named node is still easier to find in devtools"). Assert computed values; never conclude a value holds "because the class is applied". The only project-authored stylesheets left are `sidebar/sidebar.css`, `composer/composer.css` and `chat/media/mediaViewer.css`, none of which reaches a message bubble.
- The vendored v2 component set is repointed at the kat palette and sits in `@layer v2`, below `utilities`. A chat menu asking for `p-2`, `rounded-[calc(20px*var(--brm))]` and `min-w-[200px]` wins against the vendored `2px` / `6px` because of that layer order, and an unlayered rule would beat every utility regardless of specificity. See [Kat token layer](./kat-tokens.md).
- The transcript is a bubble column inside a virtualized scroller, not a list of text rows. There is no hover action cluster and no inline reply line. The avatar rail is a separate matter: the sidebar's rail is real and carries icons rather than avatars, and it has its own file — see [Sidebar](./sidebar.md).
- **An unlayered rule silently beats every utility, and margin was the casualty once already.** A bare `* { margin: 0 }` in `packages/ui/src/styles/kat.css` beat Tailwind's `@layer utilities` and killed every margin utility in the app: `mx-auto` computed to `0px` and the 768px transcript column sat pinned to the left edge with every width reading correctly. It is now inside `@layer base`. **Assert the column's centring by absolute position, not by the token** — see [Kat token layer](./kat-tokens.md).
- Drive the chat slice through its harness page, `http://localhost:<port>/src/chat/harness.html?state=<slug>`, and use `window.__chat` for state changes and counts. The composed app at `/` is the only entry point with no router behind it, it is the **only** place the composer exists, and it is the right place for a proof about the page as a user gets it.
- Treat every command as literal. Keep the port and paths exactly as written.
- Do not edit a source file to make an assertion pass. A failing check is a finding to report.
- `bun test` resolves `solid-js` to its server build, where `createMemo` never re-runs. A unit test that derives state passes on a stale value, so anything derived belongs in these browser recipes rather than in a `bun test`.

## Proof and skip reporting

- Evidence goes to `/tmp/kiko-verify-evidence/`, and it must still be there after cleanup. The artifact names are listed in `../SKILL.md` **Evidence**.
- Capture the action and the resulting state, not only a final screenshot.
- Assert from the script's own output — the `console.log` value is the doc.
- A rule that must be *absent* — no borders, no animation, no uppercase body — is proven by reading computed style over every candidate element and logging the match count next to the violation count. A count of zero violations over a selector that matched nothing proves nothing.
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

- [Kat token layer](./kat-tokens.md) — the one stylesheet behind every colour, type step and corner radius: the roles resolve, the Tailwind bridge works, the four self-hosted fonts actually load, and the palette is dark by design with no light variant to hunt for.
- [App shell](./app-shell.md) — the mounted page: the title, the unique root, and the full-height flex row that holds the sidebar beside the transcript pane and the composer dock; the top bar and theme switcher still correctly do not exist.
- [Chat bubbles](./chat-bubbles.md) — the visual contract of the column: the 768px centred measure, the 80% fit-content cap, the single 18px radius with no run tail, run collapse and break, the bare jumbo emoji sizes, the sticky lowercase day chip and its calendar jump, plus the no-border, no-animation and lowercase-chrome probes. Every value is a Tailwind utility on `apps/web-solid/src/chat/ui/*.tsx`, and the bubble primitives are reached by `[data-slot="bubble"]` / `[data-slot="bubble-content"]`.
- [Chat interactions](./chat-interactions.md) — what a reader can do to a message: the right-click menu on both sides, the left-only swipe gesture, reaction badges, the reply quote and its jump, the unread rule, the emoji picker, and the typing bubble.
- [Rich text](./rich-text.md) — what a message body does with the runs inside it: urls become anchors, a mention and a hashtag stay prose with more weight, sentence furniture is trimmed off a url, a scheme-less host is gated on a real TLD, and a homograph host keeps its text and loses its href behind a confirm dialog.
- [Message media and the viewer](./chat-images.md) — a single item fitted into a box, an album laid out by count, the video poster with its duration badge, and the full-screen viewer a media cell opens, with its zoom controls and swipe navigation. Handles are `[data-component="chat-media"]`, `chat-media-cell`, `chat-media-duration` and `.media-viewer`.
- [Sidebar](./sidebar.md) — the conversation column's left edge: the five rail tabs and the panel they select, collapsing and coming back, drag-resize with its 200/420 clamps, the pinned grid and how it reflows, row unread states, the hover preview, and the right-click menu whose items mutate real state. Handles are `[data-component="sidebar"]`, `sidebar-rail`, `sidebar-rail-tab`, `sidebar-row`, `sidebar-pin-tile`, `sidebar-unread-count`, `sidebar-resize`, `sidebar-add`, `sidebar-chats`, `sidebar-panel-empty` and `hover-card-v2-content`.
- [Composer](./composer.md) — the dock below the transcript: the prompt input, the send path that appends to the store, the reply bar a swipe or a quote arms, and the scroll-to-latest circle. The composer exists **only in the composed app at `/`** — the harness mounts `MessageList` alone.

## Fixture states

`FIXTURE_STATES` in `apps/web-solid/src/lib/fixtures.ts` is the record of chat slug to messages, and `window.__chat.states()` returns the same thirty keys at runtime. Every slug returns a non-empty message list, and an unknown slug falls back to `today` — but the harness's own state readout says so: `[data-component="harness-state"]` renders `unknown state: <slug>`, so a typo is visible on the page rather than silent.

| Slug | State |
| --- | --- |
| `grouped` | three consecutive agent messages, one run |
| `run-gap` | a run broken by a gap longer than the 300s grouping window |
| `run-break-reply` | a run broken because the next message replies to something else |
| `long` | a long multi-paragraph body, so the 80% cap binds |
| `jumbo-single` | one jumbo-sized pure-emoji body |
| `jumbo-group` | a run of jumbo emoji |
| `jumbo-prose` | a jumbo run that also contains prose |
| `link` | a bare URL, rendered as a link only |
| `link-card` | a URL that earns a webpage card below the bubble |
| `reply-text` | a reply to a text message |
| `reply-image` | a reply to an image message, so the quote carries a thumbnail |
| `album-2` / `album-3` / `album-4` / `album-5` | the album layouter at four counts; two and three are the shapes a symmetric grid cannot express, four is the one it can |
| `album-pano` | the panorama branch, the other complex layouter |
| `media-only` | a single photo with no body at all |
| `photo-caption` | the same photo with a caption |
| `video` / `video-caption` / `video-portrait` | a clip with no body, with one, and the portrait clip whose box is bounded by height |
| `media-card` | media and a webpage card in one row |
| `rich-text` | every run the body parser has to tell apart on one line |
| `reactions` | a cluster: one chip the viewer has pressed beside a counted chip they are not part of |
| `edited` | the edited marker on a body that was not rewritten |
| `pinned` | a pinned message, plus the reply that follows it |
| `three-days-ago` / `yesterday` / `today` | the day boundaries, for the date chip |
| `unread` | an unread division with a rule before the first unread incoming message, and rows above **and** below it |

Load one with `?state=<slug>`, or move between them in a round with `page.evaluate((slug) => window.__chat.setState(slug), "<slug>")`. Assert `probe().state` and `[data-component="harness-state"]` before measuring.

**No harness state spans two calendar days**, so `probe().dayLabels` is `[]` in every one of them and no `[data-component="chat-divider"]` is ever mounted in the harness. That is correct: each day-boundary state is a slice that starts on its own day, so the timeline builder never needs to insert a divider. A recipe that needs a divider reads it at `/`, where the active thread does span days. Do not treat an empty `dayLabels` as a fixture gap.

## Known gaps and probe defects

These are measured, not inferred. Each is a **defect in a probe or an expectation in this map**, and none of them means the surface under test is broken.

- **`probe().viewer`, `openMedia()` and `closeMedia()` look for `[data-component="media-viewer"]`, which the viewer does not render.** The real dialog is a Kobalte modal carrying `data-component="modal-v2-content"` and the classes `.media-viewer` / `.media-viewer--photo`. Measured on the composed app after a real click: the component selector is `0`, `.media-viewer` is `1`, `[role=dialog]` is `1`, `document.getElementById("root").getAttribute("aria-hidden")` is `"true"` and `document.body` has `overflow: hidden`. The viewer works; the probe's success test does not. **Assert the viewer by `.media-viewer` or `[role=dialog]`.**
- **`openPicker` has no target to click.** It looks for `[data-component='chat-add-reaction']`, then `.chat-add-reaction`, then the row, and `MessageRow` renders none of the first two — so the fallback click lands on a row with no add-reaction control and the picker never opens. Measured `false` with `overlay: null` on every message in the `today` state. Drive the picker by hand through `.chat-menu__more`.
- **`probe().runs` counts `data-run="start"`, which is a tail fact and not a per-run count.** `data-run` is `start` / `mid` / `bot` where `bot` means *last of its run*, so a single isolated message reports `0` and a three-message run also reports `1`. Measured on `grouped`: rows `start`/`mid`/`bot` with `runs: 1`; on `run-gap`: rows `bot`/`start`/`bot` with `runs: 1` and two rows carrying `data-gap`. **Assert run structure on `data-gap` and `padding-top`.**
- **`[data-component="chat-menu"]` matches nothing.** `MenuV2.Context.Content` overwrites the `data-component` prop with its own, so the open menu is `[data-component="menu-v2-content"]` with the class `.chat-menu` on the same element. Measured `0` and `1` respectively, with the menu visibly open.
- **The date chip is wired to today, not to the visible day.** `VirtualThread` renders `<DateChip dayStart={dayStartOf(now())} now={now()} visible={dateChipVisible()} />` — `dayStart` is derived from the clock, while the `topVisibleDay` memo that decides *visibility* is computed beside it and never passed down. So the chip always reads `today`: measured in the `three-days-ago` and `yesterday` states as well as `today`, with `[data-component="chat-day-chip"]` reporting `today` in all three. **Assert the chip's label and `title` off the element, expect the label to track the day, and report a permanent `today` as this wiring defect rather than as a fixture problem.** The chip's visibility and the calendar still work.
- **`.chat-divider__label`, `[data-component="chat-image-trigger"]`, `[data-slot="chat-image"]`, `.lightbox*`, `[data-component="chat-bubble"]` and `[data-component="chat-surface"]` do not exist.** Measured `0` for each on a live harness page. The day label is `[data-component="chat-day-label"]`; the bubble is `[data-slot="bubble"]`; the media is `[data-component="chat-media"]`; the viewer is `.media-viewer`; the transcript pane is `[data-component="chat-shell"]` and the stage is `[data-component="chat-stage"]`.
- **The reply jump resolves its target by text, not by id.** The quote exposes no parent id and the harness has no jump probe, so a jump recipe must match a row's `.chat-text` against the quote's text and say in the artifact that the target was resolved by content. Do not assert a jump against a guessed id.
- **The reply *retirement* path now exists, but only at `/`.** The composer is mounted in the composed app and its send path calls `useApp.appendMessage`, which is what retires the unread rule. It is absent from the harness, so this recipe runs at `/` and not on a fixture state.
