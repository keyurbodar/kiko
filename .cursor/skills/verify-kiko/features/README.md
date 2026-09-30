# Kiko verification map

This directory is the maintained source for verifying the user-facing behavior of Kiko. Read the index before driving the app, then use the matching feature file as the recipe.

The map reflects what exists **today**. Kiko is a single dark conversation column: one bubble-styled transcript, one token layer, no sidebar, no top bar, no router, no theme switch. Where a recipe depends on a module that has not landed, the file says so and gives the reason — a gap is recorded, never papered over with an invented selector.

## Baseline preconditions

- **The chat harness has never been run in a real browser.** It is verified by typecheck and by unit tests over `FIXTURE_STATES`; nobody has confirmed a live render of any state. Treat "every state renders without a runtime error" as **unproven**. Before marking any DOM recipe green, load `http://127.0.0.1:<port>/src/chat/harness.html?state=unread` once, confirm it mounts and `probe()` returns a populated object, and treat a blank or throwing page as the finding it is.
- `openMenu` and `openPicker` dispatch real `contextmenu` and `pointerdown`+`pointerup`+`click` events, then report whether a portalled dialog actually appeared. **Read the boolean; do not assert `true`.** A `false` means no dialog opened — that is a finding to report, because the wiring is unproven rather than guaranteed.
- Launch the dev server per `../SKILL.md` **Launch** and keep `/tmp/kiko-verify-evidence/vite.pid` in place.
- Port 3001 unless a sibling Kiko checkout already owns it; then a free port, used consistently in every later step.
- `../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- Never drive an instance this run did not start. A port that answers but is not owned by your pid is another checkout's app.

## Driving conventions

- The harness is `ego-browser nodejs`. There is no Playwright and no Puppeteer here; a script that imports `chromium` from Playwright fails.
- One TaskSpace per goal. Print `space.id` and pass it back via `await taskSpace(<id>)` in later rounds; every invocation is a fresh Node process.
- Page globals do not exist in the Node script. Put `window`/`document` access inside `page.evaluate()`.
- Colour is read with `getComputedStyle`, never with `document.documentElement.style`. The token layer is stylesheet rules now, so the inline style object is empty by design and reading it reports a palette that is actually there.
- The transcript is a bubble column inside a virtualized scroller, not a list of text rows. There is no avatar rail, no hover action cluster, and no inline reply line — those were the previous design and none of them exist.
- Drive the chat slice through its harness page, `http://127.0.0.1:<port>/src/chat/harness.html?state=<slug>`, and use `window.__chat` for state changes and counts. The composed app at `/` is the only entry point with no router behind it, and it is the right place for a proof about the page as a user gets it.
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
- [App shell](./app-shell.md) — the mounted page: the title, the unique root, the full-height single-column shell, and the sidebar, top bar and theme switcher that correctly do not exist.
- [Chat bubbles](./chat-bubbles.md) — the visual contract of the column: the 768px centred measure, the 80% fit-content cap, the run's tail corner, run collapse and break, jumbo emoji sizing, the lowercase day chip and its calendar jump, plus the no-border, no-animation and lowercase-chrome probes.
- [Chat interactions](./chat-interactions.md) — what a reader can do to a message: the right-click menu on both sides, the swipe gesture, reaction badges, the reply quote and its jump, the unread rule, the emoji picker, and the typing bubble.

## Fixture states

`FIXTURE_STATES` in `apps/web-solid/src/lib/fixtures.ts` is the record of chat slug to messages. Every slug returns a non-empty message list, and an unknown slug falls back to `today`, so a typo silently proves the wrong state rather than failing.

| Slug | State |
| --- | --- |
| `grouped` | a collapsed run of consecutive messages from one sender |
| `run-gap` | a run broken by a gap longer than the 300s grouping window |
| `run-break-reply` | a run broken because the next message replies to something else |
| `long` | a long multi-paragraph body, so the 80% cap binds |
| `jumbo-single` | one jumbo-sized pure-emoji body |
| `jumbo-group` | a run of jumbo emoji |
| `jumbo-prose` | a jumbo run that also contains prose |
| `link` | a bare URL, rendered as a link only |
| `link-card` | a URL that earns a link card below the bubble |
| `reply-text` | a reply to a text message |
| `reply-image` | a reply to an image message, so the quote carries a thumbnail |
| `reactions` | messages carrying reaction badges |
| `edited` | a message marked as edited |
| `pinned` | a pinned message |
| `three-days-ago` / `yesterday` / `today` | the day boundaries, for the date chip |
| `unread` | an unread division with a rule before the first unread incoming message |

Load one with `?state=<slug>`, or move between them in a round with `page.evaluate((slug) => window.__chat.setState(slug), "<slug>")`. Assert `probe().dateChip` before measuring after a switch.

## Known gaps

**Every handle in the map is settled except two recipes, and both are blocked on a send path.** The unread rule's *retirement* needs the viewer to send a message; the harness has no `send` probe and the composer is not mounted in the chat surface, so no user path exists. The reply *jump* target is resolved by matching the parent's text, because the quote exposes no parent id and the harness has no jump probe. Both recipes are written and say so in place; do not fake either through a private store or a guessed id. Everything else — the row, bubble, quote, divider, unread rule, date chip, calendar, swipe, menu, reactions, picker and typing row — is driven directly by its `data-component` attribute.

**The composer slice is not mounted.** `apps/web-solid/src/composer/` exists with its own components, but `src/main.tsx` composes the chat pane only, so the composer has no user entry point and no recipe. Add a feature file when a harness or a mount makes it reachable.

**The vendored v2 component set is not repointed at the kat palette.** `packages/ui/src/styles/kat.css` re-points the `--v2-*` roles inside an `html[data-kat-theme]` block, and nothing in the app sets that attribute. A v2 component therefore renders its own default ramp. This is a real product gap, recorded here rather than asserted as themed — see [Kat token layer](./kat-tokens.md).
