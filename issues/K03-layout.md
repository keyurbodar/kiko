# K03 layout without tabs

GOAL: three Corvu panels (sidebar, chat, right panel), no horizontal tabs anywhere, right panel as stacked sections, one keyboard map.

CONTEXT: `refs/reports/R4-layout.md` (all units 1 to 5, sections 3.1 to 3.7). `issues/REDESIGN.md` item 4. Deviation from the report: the sidebar toggle chord is Mod+\ (not Mod+B), because Mod+B is bold in the composer. Resolve the report's open questions as: right panel closed by default as today, phones keep the overlay.

SCOPE: `apps/web-solid/src/app/**`, `sidebar/**`, `settings/settings-shell.tsx`, `settings/sections.ts(+test)`, `chat/info/**` (panel, state, sections), `files/tree.tsx`, `files/tree.css`, `files/pane.tsx` (tabs only), `commands/**`, `apps/web-solid/package.json` (add `@corvu/resizable` at the version the report names, remove `@solid-primitives/pointer` if unused). Do not touch composer, chat transcript or theme tokens.

ACCEPTANCE: the five unit acceptance lists in the report, plus:
- No chat, panel, file or settings tab row remains. The extensions page keeps its tab row for K10 to migrate.
- Right panel sections: Context, Agents, Tasks, Files, each a Kobalte Collapsible; letter hints F, A, T, C obey the typing-context rule; opening a file shows it in Files with a back arrow.
- Widths persist; the chat column never falls under 360 px.
- 0 ms motion on open, close and resize.
- Tree rows measure 24 px in the browser.
- Browser check at 1440, 1024, 768 and 375 px widths, screenshots under `.verify-evidence/K03/`.

VERIFY: typecheck, web-solid tests, check-imports, a real browser drag of both handles.
