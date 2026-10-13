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
