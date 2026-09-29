# App shell

A user who opens Kiko gets a single page that mounts, resolves its theme, and renders. Today that page is intentionally empty: the chat transcript has not landed. This feature covers the shell that every later slice plugs into.

## Sub-features

- `shell-mount` mounts the Solid render tree into the document's root element.
- `shell-title` identifies the app in the browser tab.
- `shell-provider-tree` renders inside `ThemeProvider` so theme context is available to children.
- `shell-empty-surface` renders no chat UI yet, which is the current correct end state.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. There is exactly one entry point; the app has no router and no navigation.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true`.

- **Open the app.** Load the root URL. Run `page.goto("http://127.0.0.1:3001/")`, then `page.title()`. The result is `Kiko`.
- **Confirm the mount point.** Run `page.waitForSelector("loc=css:#root", { state: "attached" })` and `page.evaluate(() => document.querySelectorAll("#root").length)`. The result is `1` — a selector that matched more than one element would make every later action ambiguous.
- **Confirm the tree mounted.** Read the root's children. Run `page.evaluate(() => document.getElementById("root").childElementCount)`. The result is greater than `0`; a `0` means `render()` never ran.
- **Confirm the empty surface.** Read the visible text. Run `page.evaluate(() => document.getElementById("root").innerText.trim())`. The result is the empty string, because the shell renders an empty `div` inside `ThemeProvider`.
- **Proof.** Capture the mounted state. Run `page.snapshot()` and write it to `/tmp/kiko-verify-evidence/app-shell.snapshot.txt`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The snapshot shows a themed page with no conversation content.

## Gotchas

- There is no client router, so a `waitForURL` will never fire and a 404 on any sub-path is expected, not a bug. Only `/` is real.
- The rendered body is deliberately empty. A snapshot containing message text means chat UI landed and this file's `shell-empty-surface` sub-feature is now wrong — update it rather than treating the non-empty page as a failure.
- `page.snapshot()` captures the current viewport only. The shell is short enough that `scope: "full_page"` changes nothing, so leave it off.
- The dev server hot-reloads. If an edit lands mid-run, the page reloads under you; re-`goto` and re-snapshot rather than reading a stale snapshot as evidence.
- `page.evaluate` has no timeout. Keep each call bounded — a single `evaluate` per assertion, not a loop that waits inside the page.
