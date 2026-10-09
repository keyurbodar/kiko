# Files panel

The chat's right panel, Files tab: t3code's file tabs, the file header, the viewers, and the tree as an explorer. Source: `apps/web-solid/src/files/` (`pane.tsx`, `chrome.tsx`, `breadcrumbs.tsx`, `viewer.tsx`, `viewers/*`, `editor.tsx`) and `apps/web-solid/src/chat/info/state.ts` (tabs).

## Behaviors

- `file-tabs` — `[data-component="file-tabs"]` (`role=tablist`) holds one `[data-component="file-tab"][data-path=<path>]` per open file; the active one has `data-active`. Its name is a `role=tab` button; every tab shows `[data-action="close-tab"]`. A middle click (`auxclick`, button 1) closes a tab. Closing the active tab activates its right neighbour, else its left.
- `file-tab-keys` — Alt+W closes the active file tab and Alt+Shift+T reopens the last closed one, while the panel is open on Files. Mod+W and Mod+Shift+T stay the chat's close and reopen. Escape closes the panel, unless a dialog or menu is open; the tabs survive it and a reload (`localStorage["yuki:file-tabs"]`).
- `file-width` — with tabs open the panel's inline width is `min(540px, 100%)` by default (`[data-component="info-panel"]`), 360 to 70 percent of the window when dragged.
- `file-header` — `[data-component="file-header"]`: `[data-component="file-breadcrumbs"]`, then `[data-action]` buttons `toggle-rendered`, `toggle-wrap`, `copy-file`, `download-file` (a link, label "Save file"), `toggle-explorer`, `close-file`. Labels are tooltips and `aria-label`s: "Show rendered markdown" / "Show markdown source", "Show table" / "Show source", "Show rendered page" / "Show HTML source", "Enable word wrap" / "Disable word wrap", "Copy contents" then "Copied".
- `file-crumbs` — each folder crumb is `[data-component="file-crumb"]` with `aria-label="Browse <folder>"`. It opens a `role=menu` of that folder: a folder item steps in (the menu stays open, "Back to <parent>" steps out), a file item opens it as a tab.
- `file-explorer` — `[data-component="file-explorer"]` is the tree. With no tab it fills the tab; with tabs it is a column at the right, hidden when `toggle-explorer` is off (`localStorage["yuki:file-explorer-open"]`).
- `file-viewers` — `[data-component="file-viewer"][data-kind]`. Text kinds show `[data-component="file-editor"]` (CodeMirror, line numbers, editable). Rendered: `file-markdown`, `file-table` (at most 100 rows and 30 columns, with a `file-notice`), `file-html` (an iframe with `sandbox="allow-scripts allow-forms allow-popups"` on a blob URL). Media: `file-image` (inline `img`), `file-pdf`, `file-video`, `file-audio` (native elements). Anything else: `file-no-preview` with a Save file link.
- `file-limits` — a text file past 1 MB shows `[data-component="file-notice"]` "Preview limited to the first 1 MB of a N byte file." and the editor has `data-truncated` and `contenteditable="false"`. A zero byte in the first 8 KB shows `[data-component="file-failure"]` "This file contains binary data and cannot be shown as text."; bytes that are not UTF-8 show "This file is not UTF-8 text. Open it in another app to view its contents."
- `image-dialog-zoom` — the chat's image dialog. `[data-component="image-dialog-viewport"]` carries `data-zoom` and gets focus on open. A wheel zooms around the pointer, a click or Enter toggles 1 and 2, `+` `-` `0` zoom, a mouse drag pans when zoomed, the arrow keys pan when zoomed and move between pictures when fitted.

## Recipe

1. Open `http://localhost:5173/chat/<id>` in `agent-browser --session <session>`. Make test files from the page with `fetch("/api/files/<roomId>?path=<path>", { method: "PUT", headers: { "content-type": <type>, "x-yuki-if-sha256": "none" }, body })`.
2. Press Mod+Shift+E for Files. Click tree rows (`[data-component=file-explorer] [role=treeitem]`) to open tabs, then read `[data-component=file-tab]` paths and `data-active`.
3. Click header actions by `[data-component=file-header] [data-action=…]` and read `aria-label`, `aria-pressed`, and the viewer's `data-component`.
4. Open a crumb menu with a real click (`agent-browser click "[aria-label='Browse <folder>']"`), then click items by ref from `snapshot -i`. A synthetic `click()` on the trigger does not open it.

## Gotchas

- Importing `/src/chat/info/state.ts` from an `eval` loads a second copy of the module. Drive tabs through the UI.
- `agent-browser mouse wheel` did not reach the dialog in one run; a dispatched `WheelEvent` with `clientX`/`clientY` on the viewport did.
- `MenuV2.Content` overwrites `data-component`, so read the crumb menu as `[role=menu]`.
