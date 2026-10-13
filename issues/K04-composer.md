# K04 composer on Tiptap

GOAL: a composer where formatting keys, markdown input rules, paste, drag and drop, attachments and drafts all work smoothly, and human messages render their formatting.

CONTEXT: `refs/reports/R3-composer.md` (units U1 to U5, section 3). `issues/REDESIGN.md` item 5. Use `@tiptap/core`, `@tiptap/pm` and individual extensions only, exact versions on the 3.31.x line. The rich module is lazy (tier 3). Add it to TIER3 in `scripts/bundle-budget.ts` and re-record that tier with a stated reason; tier 2 must get smaller (snowball removed).

SCOPE: `apps/web-solid/src/composer/**`, `apps/web-solid/src/warm/drafts.ts(+test)`, new `composer/rich/**`, `apps/web-solid/src/app/routes/chat.tsx` (only the Snowball mount removal), `scripts/bundle-budget.ts`, `apps/web-solid/package.json`, `apps/server/src/room/room-do.ts` and `apps/server/src/room/log.ts` (human messages get `rich: parseRichText(text)`, edit path too, plus a server test that fails if it is dropped). No theme or layout files.

ACCEPTANCE: the five unit lists in the report, plus:
- Cmd/Ctrl+B, I, Shift+X, E, Shift+8, Shift+7, Shift+B, Alt+C and K work and are covered by a table test of the keymap.
- Pictures: 40 px row, hover or focus remove, ring progress. Files: inline chips with middle-truncated names. No corner X badge, no 64 px tiles.
- Reply bar is one quiet line, same font token as the field.
- Draft markdown, reply target and attachments survive reload; main warm DB SCHEMA_VERSION unchanged.
- Serializer round-trips every node and mark against the server parser (test per node).
- Drag a file from the desktop onto the composer in a real browser; paste an image; paste long text.
- Real model run: send a formatted message to a real agent with the dev keys and screenshot the bubble.
- No `animate(`, `transition` or `animation` in `composer/`.

VERIFY: typecheck, web-solid tests, the one server test file, bundle budget, browser checks with screenshots under `.verify-evidence/K04/`.

## Report

Partial. Two acceptance items are open (Mod+K, tier 2 size). Details below.

What was broken, and why (fixed in this pass):
- The text sat under a second, empty plain field, and the placeholder showed over the typed text. The Tiptap bind threw a stack overflow before `setRich` ran, so the plain field never hid. The loop came from `setEditable`, which emitted an update that fed the bind effect back into itself. Fix: `setEditable` runs only when the value changes and without emitting, and the plain field is unmounted once Tiptap is up.
- Pictures were 40 px already, but the X was visible on every tile. The remove rule used `hover: none`, which headless Chrome matches. It now uses `pointer: coarse`.
- The reply bar used the accent colour and bold for the role. It is now muted, with a neutral rule.

Before and after screenshots are in `.verify-evidence/K04/` (`before-chat.png`, `with-attachments.png`, `composer-fixed.png`, `reply-bar.png`, `after-reload.png`, `paste.png`, `drop-and-link.png`, `link.png`). Those are not committed (the folder is ignored).

Open:
- Mod+K does not open the link input. `palette.open` in `apps/web-solid/src/commands/kat-commands.ts` is a global Mod+K shortcut, and it wins over the composer. This is a fork: the composer's link key should win inside the field, and the palette stays on Mod+K elsewhere, or the palette moves. Not changed here, because that file is outside this unit.
- Tier 2 is 181528 bytes gzip, up 961 bytes from the recorded 180567. The brief asks for it to get smaller. Not fixed in this pass. Within the 5 percent tolerance, so the budget passes.
- The keymap table test covers every chord in the brief except Mod+K, which is a link-form action in `editor.ts`, not a table command.
- The desktop drag was simulated with synthetic `DragEvent`s on `document` and the composer box. A real OS file drag was not run.
- Chips inserted on restore land at the end of the draft, not where they were.

Discoveries:
- A synthetic Enter in the composer sends the message (correct), so newlines in tests need Shift+Enter.
- Headless Chrome matches `hover: none`, so media queries on that alone show touch UI in tests.

Verified in this pass (commands and results):
- `bun run --cwd apps/web-solid typecheck` ran `tsc --noEmit` with no errors.
- `bun test src/composer src/warm` in apps/web-solid: 84 pass, 0 fail.
- `bun run --cwd apps/server test -- room-log`: 14 pass, 0 fail.
- `bun run --cwd apps/web-solid build` then `bun scripts/bundle-budget.ts`: tier 1 ok (1973 of 2092), tier 2 ok (181528 of 189595), tier 3 ok (239167 of 251125), tier 4 ok (26812 of 28461).
- `bun scripts/check-imports.ts`: imports ok.
- `bun scripts/check-rules.ts`: check-rules ok.
- `bun scripts/check-exports.ts`: check-exports ok, 205 files.
- `bunx biome check` on the changed server files and bundle-budget: no errors.
- Real model: the formatted message "Check **this** and _that_" was sent to Kiko with two pictures and a PDF, the bubble shows bold and italic, and Kiko replied in the same chat.
- No `animate(`, `transition` or `animation` in `composer/` (grep).

Server edit path: `log.ts` no longer returns early on same-text edits when a `rich` tree is passed. It returns early on same text instead. That keeps unchanged edits from emitting events, because the socket now always passes a tree.

Stopped: my dev servers (ports 5174 and 5274). No process of mine is running.
