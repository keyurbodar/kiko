---
name: verify-web-solid
description: Drive the Kiko Solid app in a real browser to prove a UI change under apps/web-solid or packages/ui. Use whenever a change touches the renderer and needs runtime proof, not just a typecheck.
---

# verify-web-solid

Kiko's frontend is `apps/web-solid` (Solid + Vite). It renders from local fixtures — no
backend, no network, no auth — so every state is reachable by URL and every proof is
repeatable. `apps/web` is the frozen React app kept as reference; never drive it.

Slices own one directory each (`src/<slice>/**`) and ship a harness page so the slice can be
seen before `src/main.tsx` composes it. The composed app is composed on `main`; until then a
slice is verified through its own harness.

## Launch

```bash
cd apps/web-solid && bun run dev
```

Vite serves on **http://localhost:3001**. Ready when the log prints `Local:` and the port
answers; do not sleep-and-hope.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
```

Teardown is stopping that process. Never kill by name — stop the one you started.

## Doctor

Run this before believing a page is broken:

```bash
curl -s -o /dev/null -w "root:%{http_code} harness:%{http_code}\n" http://localhost:3001/ \
  http://localhost:3001/src/sidebar/harness.html
```

Then, in the page, confirm two things that silently break every slice:

```js
document.documentElement.dataset.theme              // expect a theme id, e.g. "oc-2"
getComputedStyle(document.documentElement)
  .getPropertyValue("--kiko-sidebar").trim()        // expect a colour, NOT ""
```

An empty `--kiko-*` means the T3 role layer was never applied and every token utility
computes to nothing — the UI renders structurally correct and colourless. The writer is
`applyThemePalette` in `packages/ui/src/app-theme/apply.ts`; a harness must call it (the
sidebar harness does). If both are fine and the page is still wrong, it is your change.

## Drive

The browser is [ego-browser](skill://ego-browser): one task space per goal, `page.evaluate`
for in-page work, `page.screenshot` for the visual.

**Slice harnesses.** One per slice, `<slice>.html` + `<slice>.tsx` under `src/<slice>/`, both
owned by that slice. Currently: `/src/sidebar/harness.html`. The harness:

- takes URL flags so every state is addressable;
- exposes `window.__sidebar` with read-only probes and store writes that drive the real
  reactive path (never a test-only setter);
- imports the slice stylesheet, because `main.tsx` is the only thing that pulls it in for the
  composed app.

Sidebar flags: `?rail=1` collapsed rail · `?pinned=1` drop pinned · `?unread=1` clear unread ·
`?empty=1` no roster · `?scale=N` synthesise N rows for the filter benchmark.

Stable handles — prefer these over text or coordinates:

| Handle | Element |
| --- | --- |
| `[data-component="sidebar"]` | the aside; `data-collapsed` is `"true"`/`"false"` |
| `[data-component="sidebar-row"]` | a row; `data-active`, `data-unread`, `data-presence` |
| `#sidebar-row-<id>` | one row by thread id |
| `[data-slot="sidebar-section-header"]` | a section header |
| `[data-slot="sidebar-row-name"]` / `-preview` / `-time` / `-unread` | row internals |
| `[data-component="sidebar-rail-item"]` | a rail entry |
| `[data-slot="text-input-v2-input"]` | the search field |
| `[data-component="menu-v2-content"]` | an open menu; items are `[role="menuitem"]` |

Menu and tooltip content portal outside the aside, so scope selectors by
`[role="menuitem"]`, not by a sidebar ancestor.

## Evidence

Proofs go in `artifacts/` (gitignored) as `artifacts/<slice>/NN-name.png`, plus the printed
values that back them. `artifacts/` survives cleanup — a cleanup that eats the proof failed.

Standards:

- Drive the real path. `window.__sidebar.setUnread` writes the Solid store, which is the same
  path a live update takes — not an internal setter.
- Capture the action **and** the resulting state. A screenshot of a menu means nothing without
  the item list read from the DOM in the same run.
- Verify the side effect, not just the pixels: row count, DOM mutations, focus, the store value.
- Measure performance with `performance.now()` around a synchronous event dispatch. Never time
  to the next `requestAnimationFrame`: a headless page throttles rAF to ~1 Hz and every
  keystroke will look like it costs a second.

## Cleanup

Stop the dev server you started. Leave `artifacts/`. If a browser task space was opened, close
it with `finish({ keep: [] })` once the proof is saved.
