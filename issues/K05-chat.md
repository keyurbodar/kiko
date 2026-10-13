# K05 chat message polish

GOAL: long messages clamp cleanly, human and agent text share one pipeline, attachment rows are simple, and the thread has one date cue.

CONTEXT: `refs/reports/R2-chat-messages.md` units A, B, C and D step 1; sections 3.1 to 3.6. `issues/REDESIGN.md` item 6. Link previews are already gone; only docs and the second link pipeline remain. Do not add a favicon to links.

SCOPE: `apps/web-solid/src/chat/Collapsible.tsx`, `chat/ui/{MessageRow,RichText,Attachments,DateChip}.tsx`, `chat/rich/**`, `chat/lib/richtext/**`, `chat/VirtualThread.tsx` (day-divider and chip-hide code only), `apps/server/src/room/rich-text.ts` only if the report requires it for human messages (coordinate: K04 owns the `room-do.ts` human `rich` line; if it is not on main when you start, rely on `Message.rich` being optional and render the plain path until it is), `docs/product.md`, `docs/architecture.md`. Do not touch the composer, layout, theme or protocol event types.

ACCEPTANCE: unit A, B, C acceptance lists and D step 1 in the report, plus a masked-link warning dialog still fires through the tree path, copy serializes the tree to markdown (pure function with a round-trip test), `bun scripts/bundle-budget.ts` not larger in tiers 2 and 3, and screenshots with a long human message, a long agent message, a code block, a table, an image grid and a PDF row under `.verify-evidence/K05/`.

VERIFY: typecheck, web-solid tests, check-imports, budget, browser, one chat verify suite on your own port.
