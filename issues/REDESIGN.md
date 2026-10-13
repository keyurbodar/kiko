# Kiko redesign program

Coordinator decisions, made from research reports R1 to R8 (kept in `refs/reports/`, untracked). Workers read this file after `STANDING.md`. Where a report and this file disagree, this file wins.

## Goal

Kiko has its own identity: calm, modern, minimal, fast. T3 Code level interaction quality. Bubble chat stays. One design system, one package per concern, no duplicated UI code.

## Decisions

1. **Name.** The product is Kiko. Packages are `@kiko/*`. The built-in chief agent displays as Kiko. Its slug stays `"yuki"` so stored chats, routines, souls and extension scopes keep working. The IndexedDB name `yuki:warm` stays. The session cookie is renamed (one sign-out is accepted).
2. **Theme.** Keep the palette model in `apps/web-solid/src/theme/palette.ts` (two inputs per appearance, one accent, neutrals as ink shares). Move it into `packages/theme` (`@kiko/theme`). Collapse the token sources: `palette.ts` owns semantic colors, `kat.css` keeps fonts, type scale, radii, icon sizes and one first-paint fallback. Add named scales: radii xs 4, sm 6, md 10, lg 14, bubble 16, pill; icons xs 12, sm 14, md 16, lg 20; type 11, 12, 13, 14, 16. No density setting. Port T3's VS Code theme import and Open VSX search without Effect, using `culori` and `crypto.subtle`, as a lazy chunk.
3. **Avatars.** Vendor `yukiusagi` as `packages/avatar` (`@kiko/avatar`) with exports renamed. Kiko defaults pin charm, outfit, pattern to none and mood to calm. Choices are stored as a sparse `avatars` record in the look (version 3), converted once from the old `birds` record. The picker is a plain dialog with no animation. Delete snow, hoarfrost, moments and the animated mascot chrome.
4. **Layout.** Three columns on Corvu `@corvu/resizable`: sidebar (chat list or settings nav), chat, right panel. No horizontal tabs anywhere: delete the chat tab strip, the right-panel tabs, the file tabs and the settings tab row. The right panel is stacked Kobalte Collapsible sections: Context, Agents, Tasks, Files. One open file at a time. Single-letter section hints only when focus is outside text fields and no overlay is open. Sidebar toggle is Mod+\ because Mod+B is bold in the composer.
5. **Composer.** Tiptap core plus individual extensions (no starter kit, no `@tiptap/react`, no `@tiptap/markdown`) mounted into the existing composer element from a lazy module. The stored draft and the sent text are markdown. The server parses human messages into the rich tree like agent messages. Pictures are a 40 px row with hover-only remove. Other files are inline chips. Delete `snowball`. Composer, bubbles and sidebars share one type token set.
6. **Chat.** Keep bubbles and grouping. Collapse long bodies at 176 px with a 28 px fade and a visible "Show full message" text button. One message text pipeline (server tree) for humans and agents. Links are plain underlined text, no favicon, no card. One date cue (the sticky chip). Typed system events on system messages: delegated, subagent (private), routine, agent message, activity.
7. **Agent activity.** Replace the typing-only indicator with a typed `ActivityModel` derived from wire frames: idle, writing, tool, waiting on agent, failed, background workers. A compact live row above the composer with a working Stop button (the stub at `composer.tsx:182` is a bug). An ask-the-human card floats over the composer. No approval cards: Kiko has no approval gate.
8. **Files.** Keep the existing kind table, lazy viewers and 1 MB read cap. Add the `diff` kind, BOM strip and cell cap for CSV and TSV, a shared full-size file dialog, and one icon table keyed by kind (Hugeicons). Keep the file-type sprite for tree rows, 24 px rows.
9. **Controls.** One primitive per job from Kobalte, Corvu and solid-primitives, wrapped once in `packages/ui`: Select, Combobox, Switch, Slider, SegmentedControl, RadioGroup, Popover, Toast, Skeleton, Tabs (extensions page only). `@solid-primitives/storage` `makePersisted` replaces hand-rolled localStorage. Delete unused `ButtonV2`, `IconButtonV2`, `KeybindV2`, the second icon component and `experiments/`.
10. **Product gaps.** Skills page lists the built-in skills (needs a server route). Workers and reminders get a surface. A failed load shows an error with retry, not an empty list. Loading shows a skeleton.
11. **Code style.** No code comments except a non-obvious why. Sentence-case strings. Hugeicons only.
12. **Verification.** Fast checks only, under 5 minutes. Real browser checks through the `verify-kiko` skill or `refs/agent-browser`, with real model keys from `apps/server/.dev.vars`. No new slow test suites.

## Units

Landing is local (`issues/bin/land.sh`, no remote). One writer per worktree.

| Unit | Title | Depends on |
| --- | --- | --- |
| K00 | Rename yuki to kiko | none, lands alone first |
| K01 | `@kiko/theme` package and token collapse | K00 |
| K02 | `@kiko/avatar` package | K00 |
| K03 | Layout: Corvu panels, no tabs, stacked right panel, keyboard map | K00 |
| K04 | Composer on Tiptap, attachments, drafts, human rich text | K00 |
| K05 | Chat: collapse, one text pipeline, attachments, one date cue | K00 |
| K06 | Protocol and server: typed activity, work frames, system events, ask_human, skills route | K00 |
| K07 | Avatar integration, picker, mascot deletion, look v3 | K01, K02 |
| K08 | Client activity row, ask card, system events, tasks and workers surface | K04, K05, K06 |
| K09 | File viewing upgrades | K03 |
| K10 | Kobalte consolidation, toast, dead UI exports | K03 |
| K11 | Product gaps: reminders, errors, skeletons, skills page | K03, K06 |
| K12 | Open VSX theme import | K01 |
| K13 | Literal color, size and radius sweep and `check-tokens` | K01, K03, K04, K05, K10 |
| K14 | Verification skill, fast gate, docs | all |

Wave 1 after K00: K01, K02, K03, K04, K05, K06.
