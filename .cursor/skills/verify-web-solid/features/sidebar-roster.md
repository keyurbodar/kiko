# Roster sidebar

The conversation list: pinned shelf, groups, the rest, a collapsed rail, search, and a
right-click menu. Owned by the `sidebar` slice at `apps/web-solid/src/sidebar/`; the composed
app mounts it from `src/main.tsx` (owned by `main`), so proofs run against the slice harness.

## Sub-features

- **Rows** — two-line card: blobatar avatar with a presence dot, name, relative time, preview,
  unread dot. Groups render a three-member avatar stack and member names instead of a preview.
- **Pinned shelf** — pinned bots sort to the top under a `Pinned` header carrying a count.
- **Search** — filters on name and preview, groups first then bots. Clear button when non-empty.
- **Rail** — collapsed column of avatars with tooltips; `e` toggles, and the header button.
- **Row context menu** — right-click opens `Open · Details · Channels · Memory · Tools · Pin · Delete`.
- **Create menu** — the header `+` offers `New agent` / `New group` when the host wires those props.
- **Keyboard** — `ArrowUp`/`ArrowDown`/`j`/`k`/`Home`/`End` move the active row and move focus,
  `Enter` opens it, `Escape` clears the search.
- **Empty states** — `No bots match` when a query matches nothing, `No bots yet` when the roster
  is empty.

## How to get to it (user POV)

Open **http://localhost:3001/src/sidebar/harness.html**. Flags address every state:

| URL | State |
| --- | --- |
| `harness.html` | fixtures as they ship: pinned, unread, all four presences |
| `?rail=1` | rail collapsed |
| `?pinned=1` | no pinned bots, so no shelf header |
| `?unread=1` | nothing unread |
| `?empty=1` | empty roster |
| `?scale=2000` | 2000 synthetic rows, for the filter benchmark |

## Driving it with ego-browser

```js
const task = await taskSpace("sidebar verification");
const page = task.page("p1");
await page.goto("http://localhost:3001/src/sidebar/harness.html");
await page.waitForTimeout(2000);

const state = await page.evaluate(() => ({
  rows: window.__sidebar.rows(),
  names: window.__sidebar.names(),
  headers: [...document.querySelectorAll('[data-slot="sidebar-section-header"]')].map((n) => n.textContent),
}));

await page.fill('[data-slot="text-input-v2-input"]', "sidebar");
await page.click("#sidebar-row-grace", { button: "right" });
const menu = await page.evaluate(() =>
  [...document.querySelectorAll('[data-component="menu-v2-content"] [role="menuitem"]')].map((n) => n.textContent),
);
```

`window.__sidebar` exposes read probes (`rows`, `names`, `unread`, `presence`, `active`, `empty`,
`query`, `actionLog`) and two store writes that take the real reactive path — `setUnread(id, n)`
and `setPresence(id, p)` — plus `watch()` / `unwatch()` which count DOM mutations inside the
list, and `benchFilter(query, runs)` which times the filter alone.

## Gotchas

- **Timing a keystroke.** Measure with `performance.now()` around the synchronous dispatch, not
  to the next `requestAnimationFrame` — a headless page throttles rAF to ~1 Hz and every
  keystroke reads as ~1000 ms. Baseline with virtua doing the windowing: median 3.7 ms at 2000
  rows, 14.8 ms at 20000, with filter-only at 1.1 ms and 12.2 ms respectively.
- **The search field is deliberately flat.** No background, border, ring or transition on rest,
  hover or focus — TextInputV2's own gradient, outline and box-shadow are reset with the
  `background` shorthand (setting only `background-color` leaves its gradient painted). Do not
  "fix" this into a visible focus ring.
- **Nothing animates.** Row hover, menus and tooltips are instant: `sidebar.css` and the
  `[data-portal-owner="sidebar"]` markers kill transitions and animations in the portalled menu
  and tooltip too.
- **Menus portal outside the aside.** Scope menu selectors by `[role="menuitem"]`, never by a
  sidebar ancestor.
- **A presence or unread write must not re-render the list.** `window.__sidebar.watch()` then
  `setPresence(id, …)` reports mutations on that row only — `data-presence` plus the avatar's
  own pose custom properties, which is how the blobatar changes expression in place. Row order
  and row identity must be unchanged; if the count scales with the roster, `orderRoster`'s
  field contract has been broken. An unread write that changes no visible state mutates nothing.
