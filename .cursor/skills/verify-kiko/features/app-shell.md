# App shell

A user who opens Kiko gets one page: a full-height flex row with the conversation sidebar down its left edge and the conversation column filling the rest, and nothing above either. There is no top bar, no theme control and no client router, so this is the whole app shell; the sidebar and the transcript inside it have their own feature files.

## Sub-features

- `shell-mount` — mounts the Solid render tree into the document's root element, and throws if that element is missing.
- `shell-title` — identifies the app in the browser tab.
- `shell-viewport` — the shell fills the viewport height and clips its own overflow, so the transcript scrolls inside the page rather than the page scrolling.
- `shell-two-pane` — the shell is one flex row with exactly two children, the sidebar and the transcript pane. The pane carries `min-width: 0` and is allowed to shrink below its content; the sidebar is not, because its width is the thing the user drags.
- `shell-sidebar-present` — the sidebar is mounted as the row's first child, and its presence is a pass, not a defect. See [Sidebar](./sidebar.md).
- `shell-no-chrome` — no top bar, no conversation switcher and no theme switcher are rendered; their absence is the correct end state, not a gap.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. There is exactly one entry point. The app has no router, so every other path 404s and that is expected rather than a bug.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.

- **Open the app.** Load the root URL the way a user's browser does. Run `page.goto("http://127.0.0.1:3001/")`, then `page.title()`. The result is `Kiko`. Read `page.evaluate(() => document.documentElement.lang)` too: it is `en`.

- **Confirm the mount point is unique.** Run `page.waitForSelector("loc=css:#root", { state: "attached" })` and `page.evaluate(() => document.querySelectorAll("#root").length)`. The result is `1` — a selector matching more than one element makes every later action ambiguous.

- **Confirm the tree mounted.** Run `page.evaluate(() => document.getElementById("root").childElementCount)`. The result is greater than `0`; a `0` means `render()` never ran, or it threw because `#root` was missing.

- **Confirm the shell fills the viewport and clips itself.** Run `page.evaluate(() => { const s = document.querySelector(".sidebar-shell"); const cs = getComputedStyle(s); return { height: Math.round(s.getBoundingClientRect().height), viewport: window.innerHeight, overflow: cs.overflow, display: cs.display, background: cs.backgroundColor, bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }; })`. `height` equals `viewport`, `display` is `flex`, `overflow` is `hidden`, and `background` is the resolved `--bg`. A shell shorter than the viewport means the transcript is not taking the slack. The class is `.sidebar-shell` — it is the row the app composes **and** the scope class for every rule in `apps/web-solid/src/sidebar/sidebar.css`. `.app-shell` no longer exists.

- **Confirm the shell is one row holding the sidebar beside the transcript, with no top chrome.** Run `page.evaluate(() => { const shell = document.querySelector(".sidebar-shell"); return { children: [...shell.children].map((c) => c.getAttribute("data-component") ?? c.tagName.toLowerCase()), panes: document.querySelectorAll('[data-component="chat-shell"]').length, sidebars: document.querySelectorAll('[data-component="sidebar"], aside, nav').length, topbars: document.querySelectorAll('[data-component="chat-topbar"], [data-component="chat-switch"]').length, themeControls: document.querySelectorAll("[data-theme-id], [data-kat-theme], [role=switch]").length }; })`. The shell has exactly **two** children — the `nav` rail with its `aside` panel, and the transcript pane — `panes` is `1`, `sidebars` is `2` (the `<nav>` rail and the `<aside>` conversation panel), and `topbars` and `themeControls` are `0`. The absence of a top bar or a switcher is a pass; so is the presence of the sidebar, and `sidebars` of `0` means the sidebar did not mount. A run that still expects one child is asserting a shell that no longer exists. See [Sidebar](./sidebar.md).

- **Confirm the pane is allowed to shrink.** Run `page.evaluate(() => { const pane = document.querySelector('[data-component="chat-shell"]'); return { paneMinWidth: getComputedStyle(pane).minWidth, paneFlex: getComputedStyle(pane).flex }; })`. A pane with the default `min-width: auto` refuses to narrow below its content and overflows a narrow window instead of shrinking, so a recipe that resizes to a narrow viewport will catch it as horizontal overflow rather than as a computed style.

- **Proof.** Capture the mounted state. Run `page.snapshot()` and write it to `/tmp/kiko-verify-evidence/app-shell.snapshot.txt`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The snapshot shows the sidebar on the left and the conversation column beside it — one row, two panes. A snapshot showing only the column means the sidebar did not mount.

## Gotchas

- **There is no client router.** `waitForURL` will never fire, and a 404 on any sub-path is expected. Only `/` is real. The chat harness at `/src/chat/harness.html` is a separate Vite page, not a route of this one.
- **Two elements once shared the class `.chat-shell`.** The app's pane and the transcript's scroller were both a bare `.chat-shell`, defined independently by `apps/web-solid/src/styles/app.css` and `apps/web-solid/src/chat/chat.css` with conflicting `overflow` and layout — the pane clips, the scroller scrolls. The pane is now the `data-component="chat-shell"` child of `.sidebar-shell` and the scroller is `.chat-scroller`; the stable handles are `[data-component="chat-shell"]` and `[data-component="chat-scroll"]`. Always disambiguate by attribute; a bare `.chat-shell` in a selector is a bug, not a shorthand.
- **`.app-shell` and `.app-pane` are gone.** `main.tsx` composes the sidebar and the transcript pane directly inside `.sidebar-shell`, so both of those classes resolve to `null` and a recipe that reads a computed style off either throws before it can report anything. The shell is `.sidebar-shell`, the transcript pane is `[data-component="chat-shell"]`, and the sidebar is `[data-component="sidebar"]`.
- **`page.snapshot()` captures the current viewport only.** The transcript is virtualized and the shell is one screen tall, so `scope: "full_page"` adds nothing. Leave it off.
- **The dev server hot-reloads.** If an edit lands mid-run the page reloads under you; re-`goto` and re-snapshot rather than reading a stale snapshot as evidence.
- **`page.evaluate` has no timeout.** Keep each call bounded — one `evaluate` per assertion, not a loop that waits inside the page.
- **The app is not mounted to a real backend.** Everything rendered comes from local fixtures, so every state is reachable by URL and no proof here depends on a network call succeeding.
