# App shell

A user who opens Kiko gets one page: a full-height flex row with the conversation sidebar down its left edge and the conversation column filling the rest, with the composer docked below the transcript and, on chat routes, a 50px top bar above the transcript. There is no theme control in the chrome, and the router only redirects; the sidebar, the transcript and the composer inside it have their own feature files.

## Sub-features

- `shell-mount`: mounts the Solid render tree into the document's root element, and throws if that element is missing.
- `shell-title`: identifies the app in the browser tab.
- `shell-viewport`: the shell fills the viewport height and clips its own overflow, so the transcript scrolls inside the page rather than the page scrolling.
- `shell-two-pane`: the shell is one flex row with exactly two children, the sidebar and the main column (`data-component="main-column"`), which holds the top bar and the transcript pane. The pane carries `min-width: 0` and is allowed to shrink below its content; the sidebar is not, because its width is the thing the user drags.
- `shell-sidebar-present`: the sidebar is mounted as the row's first child, and its presence is a pass, not a defect. See [Sidebar](./sidebar.md).
- `shell-composer-docked`: the composer sits in flow at the bottom of the pane, inside `[data-component="composer-dock"]`, not absolutely positioned. Nothing between the dock and the viewport is a positioned ancestor, so `bottom: 0` would resolve against the window and the composer would span the whole page. See [Composer](./composer.md).
- `shell-pane-state`: the pane carries `data-reply-target` when a reply is armed and `data-range` as the virtualizer's `<start>-<end>` window, so a probe can read scroll position without re-querying rows.
- `shell-top-bar`: the 50px top bar (`[data-component="top-bar"]`) renders on chat routes only. Other sections have none. No theme switcher is rendered in the shell; the appearance setting lives in Settings.

## How to get to it (user POV)

- Open `http://localhost:<port>/`. The router sends `/` and `/chat` to the last chat, so the URL becomes `/chat/<id>`. Any unknown path redirects to `/chat`, which is expected rather than a bug.
- Resize the window narrow and the transcript column narrows with it. Below 768 px the sidebar becomes a drawer over the transcript, closed on load.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true`.
- **Use `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`.** The server binds IPv6 loopback only and `127.0.0.1` is refused. Measured, `curl` exits `7` there and answers `200` on `localhost`.
- **Every `page.goto` passes `{ waitUntil: "domcontentloaded" }` with an explicit `timeout: 60000`.** The default `load` never fires on this app because its media does not finish, so a default `goto` rejects with `PageNavigationTimeoutError` on a perfectly healthy page.

- **Open the app.** Load the root URL the way a user's browser does. Run `page.goto("http://localhost:3001/", { waitUntil: "domcontentloaded", timeout: 60000 })`, then `page.title()`. The result is `Kiko`. Read `page.evaluate(() => document.documentElement.lang)` too: it is `en`.

- **Capture what the boot threw.** Register the listener *before* navigating, then read it. Run `page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: 'window.__errs=[];addEventListener("error",e=>window.__errs.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__errs.push(String(e.reason)));' })` before the `goto`, and afterwards run `page.evaluate(() => window.__errs)`. The result is `[]`. Registering after `goto` misses every error the module graph already threw, which is exactly where a broken import lives. Note that `page.on` does not exist on this driver, so there is no other way to collect these.

- **Confirm the mount point is unique.** Run `page.waitForSelector("loc=css:#root", { state: "attached" })` and `page.evaluate(() => document.querySelectorAll("#root").length)`. The result is `1`: a selector matching more than one element makes every later action ambiguous.

- **Confirm the tree mounted.** Run `page.evaluate(() => document.getElementById("root").childElementCount)`. The result is greater than `0`; a `0` means `render()` never ran, or it threw because `#root` was missing.

- **Confirm the shell fills the viewport and clips itself.** Run `page.evaluate(() => { const s = document.querySelector(".sidebar-shell"); const cs = getComputedStyle(s); return { height: Math.round(s.getBoundingClientRect().height), viewport: window.innerHeight, overflow: cs.overflow, display: cs.display, background: cs.backgroundColor, bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }; })`. `height` equals `viewport`, `display` is `flex`, `overflow` is `hidden`, and `background` is the sidebar colour (`--shell-bg`, which is `--bg-sidebar`). `bg` is the resolved `--bg`. A shell shorter than the viewport means the transcript is not taking the slack. The class is `.sidebar-shell`. It is the row the app composes **and** the scope class for every rule in `apps/web-solid/src/sidebar/sidebar.css`.

- **Confirm the shell is one row holding the sidebar beside the main column, with the top bar above the transcript.** Run `page.evaluate(() => { const shell = document.querySelector(".sidebar-shell"); return { children: [...shell.children].map((c) => c.getAttribute("data-component") ?? c.tagName.toLowerCase()), panes: document.querySelectorAll('[data-component="chat-shell"]').length, sidebars: document.querySelectorAll('[data-component="sidebar"]').length, docks: document.querySelectorAll('[data-component="composer-dock"]').length, topbars: document.querySelectorAll('[data-component="top-bar"]').length, themeControls: document.querySelectorAll("[data-theme-id], [data-kat-theme], [role=switch]").length }; })`. The shell has exactly **two** children, the sidebar (`data-component="sidebar"`) and the main column (`data-component="main-column"`); `panes`, `sidebars` and `docks` are all `1`; `topbars` is `1` on a chat route and `themeControls` is `0`.

- **Confirm the pane is allowed to shrink.** Run `page.evaluate(() => { const pane = document.querySelector('[data-component="chat-shell"]'); return { paneMinWidth: getComputedStyle(pane).minWidth, paneFlex: getComputedStyle(pane).flex }; })`. A pane with the default `min-width: auto` refuses to narrow below its content and overflows a narrow window instead of shrinking, so a recipe that resizes to a narrow viewport will catch it as horizontal overflow rather than as a computed style.

- **Read the pane's own state attributes.** Run `page.evaluate(() => { const p = document.querySelector('[data-component="chat-shell"]'); return { replyTarget: p.getAttribute("data-reply-target"), range: p.getAttribute("data-range") }; })`. `range` matches `<start>-<end>` and tracks the virtualizer's window. This is the cheapest way to see how far the reader has scrolled without counting rows.

- **Proof.** Capture the mounted state. Run `page.snapshot()` and write it to `/tmp/kiko-verify-evidence/app-shell.snapshot.txt`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The snapshot shows the sidebar on the left and the conversation column beside it with the composer docked at the bottom: one row, two panes. A snapshot showing only the column means the sidebar did not mount.

## Gotchas

- **The router redirects.** `/` and `/chat` resume the last chat, so a `waitForURL` on `/` never fires; wait for `/chat/` instead. An unknown path goes to `/chat`.
- **`127.0.0.1` is refused; use `localhost`.** The Vite server binds the IPv6 loopback only. A recipe pointing at `127.0.0.1` fails at the connection with no page at all, which reads like a dead server rather than a wrong address.
- **The default `goto` wait state times out here.** The transcript's media never finishes loading, so `load` does not fire. The error text names `domcontentloaded` even when you did not ask for it: that is the driver's phrasing, and the navigation did commit. Pass `{ waitUntil: "domcontentloaded", timeout: 60000 }` and then wait on the condition you care about.
- **`page.on` does not exist.** Console and uncaught-error capture goes through `page.cdp("Page.addScriptToEvaluateOnNewDocument", …)` registered before navigation; see the recipe above.
- **Two elements once shared the class `.chat-shell`.** The app's pane and the transcript's scroller were both a bare `.chat-shell`, defined independently with conflicting `overflow` and layout: the pane clips, the scroller scrolls. The pane is now the `data-component="chat-shell"` element under `.sidebar-shell` and the scroller is `[data-component="chat-scroll"]`. Always disambiguate by attribute; a bare `.chat-shell` in a selector is a bug, not a shorthand.
- **`.app-shell` and `.app-pane` are gone.** `shell.tsx` composes the sidebar and the main column directly inside `.sidebar-shell`, so both of those classes resolve to `null` and a recipe that reads a computed style off either throws before it can report anything. The shell is `.sidebar-shell`, the transcript pane is `[data-component="chat-shell"]`, and the sidebar is `[data-component="sidebar"]`.
- **`page.snapshot()` captures the current viewport only.** The transcript is virtualized and the shell is one screen tall, so `scope: "full_page"` adds nothing. Leave it off.
- **The dev server hot-reloads.** If an edit lands mid-run the page reloads under you; re-`goto` and re-snapshot rather than reading a stale snapshot as evidence.
- **`page.evaluate` has no timeout.** Keep each call bounded: one `evaluate` per assertion, not a loop that waits inside the page.
- **The app talks to the dev Worker.** `/api/auth/dev/session` mints a real owner session and `/` renders that owner's rooms over the wire, so a missing backend shows as an empty shell rather than fixture content. For a backend-free run, `VITE_KIKO_SYNC=mock` swaps in `sync/mock-room.ts`.