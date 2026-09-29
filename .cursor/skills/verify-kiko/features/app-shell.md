# App shell

A user who opens Kiko gets a single page that mounts, resolves its theme, and renders a top bar over the chat transcript. This feature covers the shell itself: the mount point, the document title, and the provider tree every slice plugs into. The transcript it hosts has its own feature file.

## Sub-features

- `shell-mount` mounts the Solid render tree into the document's root element.
- `shell-title` identifies the app in the browser tab.
- `shell-provider-tree` renders inside `ThemeProvider` so theme context is available to children.
- `shell-topbar` renders the open conversation's title and its message count above the transcript.
- `shell-conversation-switcher` renders one button per conversation, with the open one marked `aria-pressed="true"`. This is scaffolding standing in until the roster sidebar lands.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. There is exactly one entry point; the app has no router and no navigation.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true`.

- **Open the app.** Load the root URL. Run `page.goto("http://127.0.0.1:3001/")`, then `page.title()`. The result is `Kiko`.
- **Confirm the mount point.** Run `page.waitForSelector("loc=css:#root", { state: "attached" })` and `page.evaluate(() => document.querySelectorAll("#root").length)`. The result is `1` — a selector that matched more than one element would make every later action ambiguous.
- **Confirm the tree mounted.** Read the root's children. Run `page.evaluate(() => document.getElementById("root").childElementCount)`. The result is greater than `0`; a `0` means `render()` never ran.
- **Confirm the top bar and its switcher.** Run `page.evaluate(() => { const bar = document.querySelector('[data-component=chat-topbar]'); return { title: bar?.querySelector('.chat-topbar__title')?.textContent, buttons: document.querySelectorAll('[data-component=chat-switch] button').length, pressed: document.querySelectorAll('[data-component=chat-switch] button[aria-pressed="true"]').length }; })`. The title is non-empty, the button count equals the conversation count in the fixtures, and exactly one is pressed.
- **Proof.** Capture the mounted state. Run `page.snapshot()` and write it to `/tmp/kiko-verify-evidence/app-shell.snapshot.txt`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The snapshot shows the top bar above a transcript column.

## Gotchas

- There is no client router, so a `waitForURL` will never fire and a 404 on any sub-path is expected, not a bug. Only `/` is real.
- The switcher is unscoped scaffolding. It owns `main.tsx` until the roster sidebar lands, and `main.tsx` is the file that work will rewrite.
- `page.snapshot()` captures the current viewport only. The shell is short enough that `scope: "full_page"` changes nothing, so leave it off.
- The dev server hot-reloads. If an edit lands mid-run, the page reloads under you; re-`goto` and re-snapshot rather than reading a stale snapshot as evidence.
- `page.evaluate` has no timeout. Keep each call bounded — a single `evaluate` per assertion, not a loop that waits inside the page.
