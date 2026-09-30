# App shell

A user who opens Kiko gets one page: a full-height shell holding a single conversation column, with nothing beside it and nothing above it. There is no roster, no conversation switcher, no theme control, and no client router, so this is the whole app shell and the transcript inside it has its own feature files.

## Sub-features

- `shell-mount` — mounts the Solid render tree into the document's root element, and throws if that element is missing.
- `shell-title` — identifies the app in the browser tab.
- `shell-viewport` — the shell fills the viewport height and clips its own overflow, so the transcript scrolls inside the page rather than the page scrolling.
- `shell-single-column` — the shell is a one-column flex row, and every child is allowed to shrink below its content width.
- `shell-no-chrome` — no sidebar, no top bar, no conversation switcher and no theme switcher are rendered; their absence is the correct end state, not a gap.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. There is exactly one entry point. The app has no router, so every other path 404s and that is expected rather than a bug.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.

- **Open the app.** Load the root URL the way a user's browser does. Run `page.goto("http://127.0.0.1:3001/")`, then `page.title()`. The result is `Kiko`. Read `page.evaluate(() => document.documentElement.lang)` too: it is `en`.

- **Confirm the mount point is unique.** Run `page.waitForSelector("loc=css:#root", { state: "attached" })` and `page.evaluate(() => document.querySelectorAll("#root").length)`. The result is `1` — a selector matching more than one element makes every later action ambiguous.

- **Confirm the tree mounted.** Run `page.evaluate(() => document.getElementById("root").childElementCount)`. The result is greater than `0`; a `0` means `render()` never ran, or it threw because `#root` was missing.

- **Confirm the shell fills the viewport and clips itself.** Run `page.evaluate(() => { const s = document.querySelector(".app-shell"); const cs = getComputedStyle(s); return { height: Math.round(s.getBoundingClientRect().height), viewport: window.innerHeight, overflow: cs.overflow, display: cs.display, background: cs.backgroundColor, bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }; })`. `height` equals `viewport`, `display` is `flex`, `overflow` is `hidden`, and `background` is the resolved `--bg`. A shell shorter than the viewport means the transcript is not taking the slack.

- **Confirm the shell is one column with no chrome.** Run `page.evaluate(() => { const shell = document.querySelector(".app-shell"); return { children: [...shell.children].map((c) => c.className), panes: document.querySelectorAll('[data-component="chat-shell"]').length, sidebars: document.querySelectorAll('[data-component="sidebar"], aside, nav').length, topbars: document.querySelectorAll('[data-component="chat-topbar"], [data-component="chat-switch"]').length, themeControls: document.querySelectorAll("[data-theme-id], [data-kat-theme], [role=switch]").length }; })`. The shell has exactly one child, the app pane, `panes` is `1`, and `sidebars`, `topbars` and `themeControls` are all `0`. The absence of a sidebar or a switcher is a pass; a run that reports them missing as a defect has misread the design.

- **Confirm the pane is allowed to shrink.** Run `page.evaluate(() => { const pane = document.querySelector('[data-component="chat-shell"]'); return { paneMinWidth: getComputedStyle(pane).minWidth, paneFlex: getComputedStyle(pane).flex }; })`. A pane with the default `min-width: auto` refuses to narrow below its content and overflows a narrow window instead of shrinking, so a recipe that resizes to a narrow viewport will catch it as horizontal overflow rather than as a computed style.

- **Proof.** Capture the mounted state. Run `page.snapshot()` and write it to `/tmp/kiko-verify-evidence/app-shell.snapshot.txt`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The snapshot shows the conversation column and nothing else.

## Gotchas

- **There is no client router.** `waitForURL` will never fire, and a 404 on any sub-path is expected. Only `/` is real. The chat harness at `/src/chat/harness.html` is a separate Vite page, not a route of this one.
- **Two elements once shared the class `.chat-shell`.** The app's pane and the transcript's scroller were both a bare `.chat-shell`, defined independently by `apps/web-solid/src/styles/app.css` and `apps/web-solid/src/chat/chat.css` with conflicting `overflow` and layout — the pane clips, the scroller scrolls. They are now `.app-pane` and `.chat-scroller`, and the stable handles are `[data-component="chat-shell"]` and `[data-component="chat-scroll"]`. Always disambiguate by attribute; a bare `.chat-shell` in a selector is a bug, not a shorthand.
- **`page.snapshot()` captures the current viewport only.** The transcript is virtualized and the shell is one screen tall, so `scope: "full_page"` adds nothing. Leave it off.
- **The dev server hot-reloads.** If an edit lands mid-run the page reloads under you; re-`goto` and re-snapshot rather than reading a stale snapshot as evidence.
- **`page.evaluate` has no timeout.** Keep each call bounded — one `evaluate` per assertion, not a loop that waits inside the page.
- **The app is not mounted to a real backend.** Everything rendered comes from local fixtures, so every state is reachable by URL and no proof here depends on a network call succeeding.
