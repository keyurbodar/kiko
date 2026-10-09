# Sidebar

A user who opens Yuki sees the conversation list before they see any conversation: a narrow rail of icons down the far left, a panel beside it holding the pinned threads as a grid and the rest as a list, and a 3px handle on the panel's right edge they can drag. Everything here is chrome around the transcript, and the transcript has its own files.

## Sub-features

- `sidebar-rail` — a 60px `<nav>` of five icon buttons, one per panel, carrying `data-panel` and `data-active`.
- `sidebar-panel` — the panel is an `<aside>` carrying `data-panel` and `data-collapsed`, and shows one of a conversation list or a "not built" line.
- `sidebar-chats` — the active panel's body holds the pinned grid and the row list.
- `sidebar-pin-grid` — pinned threads render as tiles above the rows.
- `sidebar-rows` — each conversation is a row carrying `data-chat-id`, `data-active` and `data-unread`.
- `sidebar-unread-count` — an unread thread carries a count in its trailing column.
- `sidebar-resize` — a `role="separator"` handle with `aria-valuenow` / `aria-valuemin` / `aria-valuemax` of 200 and 420, and it stays mounted while the panel is collapsed, which is what makes the collapse reversible.
- `sidebar-collapse` — the panel collapses to zero width from three separate user paths: the rail's active tab, the `+` menu's `toggle sidebar`, and a drag past the minimum.
- `sidebar-add-menu` — the `+` in the panel header opens a menu with exactly one item, `toggle sidebar`.
- `sidebar-panel-empty` — the four rail panels with no content render a lowercase "not built" line.
- `sidebar-hover-card` — a row or a tile opens a preview card carrying the thread's agent, description and last message.
- `sidebar-typing` — a thread whose agent is working shows the typing wave, and it is the sidebar's one permitted animation.

## How to get to it (user POV)

- Open `http://localhost:<port>/`. The sidebar is already there; there is nothing to open.
- Click a rail icon to switch panels. Four of them say they are not built.
- Click the `+` in the panel header and choose `toggle sidebar`, or click the active rail icon again, or drag the right-edge handle all the way left — three ways to collapse it, and three to bring it back.
- Drag the handle left and right to resize the panel between its two stops.
- Hover a conversation row or a pinned tile to get a preview card.
- Right-click a row for its menu.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/yuki-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- **Every recipe here is a composed-app recipe.** The chat harness mounts `MessageList` alone, so `[data-component="sidebar"]` is `0` there — measured on a harness page.
- **Use `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`.** The server binds IPv6 loopback only; `curl` to `127.0.0.1:3017` exits `7` (connection refused) while `localhost:3017` answers `200`.
- **Every `page.goto` passes `{ waitUntil: "domcontentloaded", timeout: 60000 }`.** The transcript's media never finishes loading, so the default `load` wait never fires and the driver's default deadline rejects on a healthy page.

Selectors this feature relies on:

- `.sidebar-shell` — the full-height flex row the app composes; **every rule in `apps/web-solid/src/sidebar/sidebar.css` is scoped under it**, and its two children are the sidebar and the transcript pane. The sidebar is the app's only remaining project-authored stylesheet, and the transcript has none.
- `[data-component="sidebar"]` — the `<aside>` panel, carrying `data-panel` and `data-collapsed`.
- `[data-component="sidebar-rail"]` — the `<nav>`.
- `[data-component="sidebar-rail-tab"]` — one rail button, carrying `data-panel` and `data-active`.
- `[data-component="sidebar-row"]` — one conversation row, carrying `data-chat-id`, `data-active` and `data-unread`.
- `[data-component="sidebar-pin-tile"]` — one pinned tile, carrying `data-chat-id` and `data-active`.
- `[data-component="sidebar-unread-count"]` — the count in a row's trailing column.
- `[data-component="sidebar-resize"]` — the handle.
- `[data-component="sidebar-add"]` — the `+`; `aria-label` is `sidebar options`.
- `[data-component="sidebar-chats"]` — the chats panel body.
- `[data-component="sidebar-panel-empty"]` — the "not built" line.
- `[data-component="hover-card-v2-content"]` — the preview card.
- `[data-component="menu-v2-content"]` — the `+` menu's content. **`[data-component="sidebar-add-menu"]` does not exist.**

- **Confirm the rail is five panels and exactly one is active.** Observe: one `data-active`, four not.
  - Load `/`, then run `page.evaluate(() => { const s = document.querySelector('[data-component="sidebar"]'); const rail = document.querySelector('[data-component="sidebar-rail"]'); const r = document.querySelector('[data-component="sidebar-resize"]'); return { sidebarTag: s.tagName, panel: s.getAttribute("data-panel"), collapsed: s.getAttribute("data-collapsed"), panelWidth: Math.round(s.getBoundingClientRect().width), railTag: rail.tagName, railWidth: Math.round(rail.getBoundingClientRect().width), tabs: [...document.querySelectorAll('[data-component="sidebar-rail-tab"]')].map((t) => ({ panel: t.getAttribute("data-panel"), active: t.getAttribute("data-active") })), resize: { role: r.getAttribute("role"), now: r.getAttribute("aria-valuenow"), min: r.getAttribute("aria-valuemin"), max: r.getAttribute("aria-valuemax"), label: r.getAttribute("aria-label") } }; })`.
  - **Measured:** the panel is an `ASIDE` with `data-panel="chats"`, no `data-collapsed`, at `280px` wide; the rail is a `NAV` at `60px`; the five tabs are `chats` (active), `terminal`, `code`, `browser`, `settings`; and the handle is a `separator` labelled `resize sidebar` with `aria-valuenow="280"`, `aria-valuemin="200"` and `aria-valuemax="420"`. **Assert the handle's `aria-valuenow` against the panel's own measured width** — that is what proves the two are the same thing, and it is the cheapest live check that the clamp is wired at all.
  - A panel wider than 420px, or a `min` that is not 200, is a defect: those are the two stops a drag has to respect.

- **Switch panels and read the "not built" line.** Observe: an unbuilt panel says so rather than rendering empty.
  - Click `[data-component="sidebar-rail-tab"][data-panel="terminal"]`, wait ~400ms, and run `page.evaluate(() => ({ panel: document.querySelector('[data-component="sidebar"]').getAttribute("data-panel"), empty: document.querySelectorAll('[data-component="sidebar-panel-empty"]').length, text: document.querySelector('[data-component="sidebar-panel-empty"]')?.textContent?.trim() }))`.
  - **Measured:** `panel` becomes `terminal`, `empty` is `1`, and the line reads **`the terminal panel is not built`** — lowercase, and naming the panel. Four of the five panels are in this state, so assert it on a second one as well rather than treating the first as a one-off.

- **The chats panel holds a pinned grid above the rows.** Observe: tiles and rows are different elements.
  - Click back to `chats`, then run `page.evaluate(() => ({ tiles: [...document.querySelectorAll('[data-component="sidebar-pin-tile"]')].map((t) => ({ id: t.getAttribute("data-chat-id"), active: t.getAttribute("data-active") })), rows: [...document.querySelectorAll('[data-component="sidebar-row"]')].map((r) => ({ id: r.getAttribute("data-chat-id"), active: r.getAttribute("data-active"), unread: r.getAttribute("data-unread") })), counts: [...document.querySelectorAll('[data-component="sidebar-unread-count"]')].map((c) => c.textContent.trim()), chatsBody: document.querySelectorAll('[data-component="sidebar-chats"]').length, addLabel: document.querySelector('[data-component="sidebar-add"]')?.getAttribute("aria-label") }))`.
  - **Measured:** two tiles (`ada` active, `grace`), four rows (`ada` active, `grace` unread, `alan` unread, `katherine` neither), two unread counts reading **`4`** and **`1`**, one `sidebar-chats` body, and the `+` labelled `sidebar options`.
  - **Assert `data-active` on both a tile and a row, and that they agree.** A tile and its row both claiming `ada` is the invariant; two elements claiming different active threads is a defect. `data-unread` is the empty string, not `"true"` — read it as `row.getAttribute("data-unread") !== null` rather than comparing to a string.
  - The counts come from the fixture, so a run that changed the store will see different numbers. Compare the count element's text against the roster's own `unread` value rather than against a literal.

- **Three collapse paths, one state.** Observe: the panel reaches zero width by any of three routes and comes back by any of them.
  - **Path one, the rail:** `page.evaluate(() => document.querySelector("[data-component='sidebar-rail-tab'][data-panel='chats']").click())`, wait ~500ms, and read `page.evaluate(() => { const s = document.querySelector('[data-component="sidebar"]'); return { collapsed: s.getAttribute("data-collapsed"), width: Math.round(s.getBoundingClientRect().width), sidebarStillMounted: !!s, resizeStillMounted: !!document.querySelector('[data-component="sidebar-resize"]'), rowsStillMounted: document.querySelectorAll('[data-component="sidebar-row"]').length }; })`.
  - **Measured:** `collapsed` becomes `""`, `width` becomes `0`, and — this is the part that matters — **the panel, the handle and all four rows are still mounted.** A collapsed panel that unmounts its contents cannot be reopened without a refetch, and the handle in particular must stay mounted for the collapse to be reversible. **Assert the handle is still there, not just that the width is zero.**
  - **Path two, the menu:** click `[data-component="sidebar-add"]` and read `page.evaluate(() => ({ menus: document.querySelectorAll("[role=menu]").length, items: [...document.querySelectorAll("[data-component='menu-v2-item']")].map((b) => b.textContent.trim()) }))`. **Measured: exactly one menu item, `toggle sidebar`.** A menu with more than one item, or with a differently-cased label, is a defect. Close with `Escape` before the next path.
  - **Path three, the drag:** a `page.mouse` drag of the handle past the minimum. Record where it lands and that it reaches the same collapsed state.
  - Bring it back by clicking the rail's active tab again and re-read: `data-collapsed` is gone and the width is back at 280. **All three paths must agree on the resulting state**, and the count of routes is itself the assertion — a run that proves one and assumes the other two has proved a third of the feature.

- **The `+` menu is a Kobalte menu, so it is selected by its own component attribute.** Observe: the menu exists and carries exactly one item.
  - Read it with `[data-component="menu-v2-content"]` or `[role="menu"]`, **never by a `sidebar-add-menu` attribute, which does not exist.** `MenuV2.Content` overwrites any `data-component` handed to it as a prop, which is the same trap as the message menu's — see [Chat interactions](./chat-interactions.md).

- **Hovering a row or a tile opens a preview card.** Observe: the card names the thread's agent and shows its last message.
  - Hover `[data-component="sidebar-pin-tile"]` with `page.hover(...)`, wait ~800ms, and read `page.evaluate(() => ({ cards: document.querySelectorAll("[data-component='hover-card-v2-content']").length, text: document.querySelector("[data-component='hover-card-v2-content']")?.textContent?.trim() }))`.
  - **Measured: one card**, reading `Ada` / `idle` / `Systems engineer. Concise, allergic to hand-waving.` / `Ada` / `On release, after …` — the agent's name, its presence, its description, and the last message. **Assert all three facts are present**, because a card that renders the name and nothing else is a card that answered none of the questions the hover was for.
  - Repeat on a `[data-component="sidebar-row"]` and confirm the card appears for a row that is not a tile. **A card on tiles but not on rows is a real gap**, since the row list is the longer of the two.
  - The card portals outside the panel, so scope it by its own attribute and never by a row ancestor. Move the pointer away and confirm it closes.

- **Right-click a row for its menu.** Observe: a menu opens with items that change real state.
  - Dispatch `contextmenu` on `[data-component="sidebar-row"]` — `page.evaluate(() => { const r = document.querySelector('[data-component="sidebar-row"]'); r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); })` — wait ~600ms, and read the items with `[data-component="menu-v2-content"]` / `[data-component="menu-v2-item"]`. Record the item list and the row's `data-unread` and `data-active` before and after each mutating item, and write the pairs to `/tmp/yuki-verify-evidence/sidebar.json`.
  - **A menu item that leaves the row's state unchanged is a defect, not a no-op to accept** — the same rule the message menu follows by omitting an item it cannot honour.

- **Nothing in the sidebar animates except the typing wave, and nothing in it draws a border.** Observe: the only motion is the three dots of a typing row.
  - Run one `page.evaluate` over every element inside `[data-component="sidebar"]`, collecting any with a non-`none` `animation-name` or a non-zero `transition-duration`, and any with a non-zero `border-width`. **Measured: the only three hits are `.typing-dot` with `animation-name: sidebar-typing-dot`, one per dot in the typing row, and the border list is empty.** Log `{ matchCount, violations, allowed }` so a fourth animation or a first border is visible rather than filtered away.
  - The chat transcript's own no-animation probe in [Chat bubbles](./chat-bubbles.md) is scoped to the transcript and **must not include the sidebar** — a sidebar element in that violation list means the scope leaked.

- **Proof.** Write the rail, panel and tile/row geometry, the handle's three `aria-valuenow`/`min`/`max` values, the before/after pairs for the row menu's items, and the animation and border sweeps to `/tmp/yuki-verify-evidence/sidebar.json`, and take `/tmp/yuki-verify-evidence/sidebar.png`.

## Gotchas

- **The sidebar exists only in the composed app.** Measured on a harness page: `[data-component="sidebar"]` is `0`. Every recipe here is a `/` recipe, and the chat harness is the wrong entry point for all of them.
- **The panel's class is `panel`, and the row is a `div` — not `aside` and not a `li`.** The `<aside>` is the panel wrapper; its class list is `panel`. A recipe that reaches for `nav aside li` finds the panel and nothing else. Scope by `data-component`.
- **A collapsed panel is `0px` wide, not unmounted.** Measured: `data-collapsed` is the empty string, the width is `0`, and the panel, the handle and all four rows are still in the DOM. **Assert the handle is still mounted** — that is what makes the collapse reversible — and do not report "the rows are still there" as a bug.
- **The handle is `role="separator"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`,** measured at `280` / `200` / `420`, and labelled `resize sidebar`. Assert the `valuenow` against the panel's own measured width; that pairing is the live proof the clamp is wired, and it moves as you drag.
- **`data-active` and `data-unread` are the empty string, not `"true"`.** Read them with `getAttribute(...) !== null` or compare against `""`. A recipe asserting `=== "true"` fails against a correct component.
- **A tile and its row both carry the active thread.** Assert they agree: a tile and its row naming the same `data-chat-id` is the invariant.
- **`[data-component="sidebar-add-menu"]` does not exist.** The `+`'s menu is a Kobalte menu and carries `data-component="menu-v2-content"`, because `MenuV2.Content` overwrites the prop. Same trap as the message menu.
- **The `+` is labelled `sidebar options`, not `add`.** And its menu holds exactly one item, `toggle sidebar` — it is a collapse control that happens to live under a `+`, not a menu for adding anything.
- **The hover card portals outside the panel.** Scope it by `[data-component="hover-card-v2-content"]`, never by a row ancestor, and give it ~800ms — it is a delayed hover, not an instant one, so a read immediately after the pointer lands sees nothing.
- **The sidebar's one permitted animation is the typing wave**, `animation-name: sidebar-typing-dot` on the three `.typing-dot` elements of a typing row — measured, and nothing else in the sidebar carries an `animation-name` or a non-zero `transition-duration`. Everything else easing is a defect.
- **The chat transcript's no-animation probe is scoped to the transcript and excludes the sidebar.** The sidebar mounts only at `/` and the chat fixtures drive the harness, so a sidebar element in that violation list means the scope leaked.
- **`.sidebar-shell` is the scope class for the whole stylesheet.** It is the flex row `main.tsx` composes and the ancestor every rule in `sidebar/sidebar.css` hangs under, and its two children are the sidebar and the transcript pane. The transcript has no stylesheet of its own, so a value the sidebar does not set is a Tailwind utility on the chat component — see [Chat bubbles](./chat-bubbles.md).
- **A written `scrollTop` is not a user scroll.** Where a recipe is about scroll-derived state, use `page.mouse.wheel` over `[data-component="chat-scroll"]`, and confirm the move with the pane's `data-range` attribute.
