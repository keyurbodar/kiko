---
name: verify-kiko
description: "Drive the Kiko web app (SolidJS + Vite) in a real browser to prove what a user sees, and capture evidence. Use for 'verify the app', 'prove this change in the browser', 'check the Kiko UI', or before claiming a web-solid slice works."
---

> **Owner rule.** Never use `ego-browser`. Drive the app with `agent-browser --session <name>` (its own Chromium). The `ego-browser` sections below are kept only for what they check, not how they drive.

# Verify Kiko

Kiko is a SolidJS + Vite chat app at `apps/web-solid`. The only surface a user touches is a web UI, so verification means launching the Vite dev server and driving it with `ego-browser`, a Chromium driver available in this environment.

There is **no Playwright, no Puppeteer, and no Chrome.app** on this machine. `import { chromium } from "playwright"` fails. Use `ego-browser nodejs` as the harness, exactly as the Drive section shows.

Every check below is read-only except the launch itself. Never edit a source file to make a check pass.

**Use `http://localhost:<port>/`, never `http://127.0.0.1:<port>/`.** The Vite dev server binds the IPv6 loopback only, so `127.0.0.1` is refused outright. Measured on this machine with `curl -sf -o /dev/null -w '%{http_code}'`: `localhost` answers `200` and `127.0.0.1` exits `7` (connection refused). Every recipe in this skill and in `features/` uses `localhost` for that reason, and a recipe that reaches for `127.0.0.1` fails at the connection, not at the assertion.

Colour comes from one stylesheet, `packages/ui/src/styles/kat.css`, pulled in by `apps/web-solid/src/styles/app.css`. kat.css has a light scale and a dark scale. The appearance setting (**Mode**: System, Light or Dark, in `src/theme/appearance.tsx`) picks one, and `src/theme/apply.ts` writes it to `data-appearance` and the `dark` class on `<html>`. The default is System, so read `data-appearance` before asserting a scheme. It also has a **sidebar**: a conversation column down the left edge of the signed-in app, with its own feature file at [Sidebar](./features/sidebar.md).

**There is no `chat.css` in the chat slice.** It was deleted with the previous implementation. Styling is inline Tailwind utilities on the component that renders the element, plus the token layer, plus a few component stylesheets imported beside the component. `apps/web-solid/src/styles/` holds `app.css`, which declares the `@layer` order, imports kat and the icon styles, and has two small rules, and `motion.css`. The bubble shape is in `apps/web-solid/src/chat/ui/bubble.css`, imported by `bubble.tsx`. Other component stylesheets include `sidebar/sidebar.css`, `composer/composer.css` and `chat/rich/rich.css`. **A `.chat-*` class name is a QA handle, not a style hook**. Many of them exist only so a probe can find the element, and several components say so in their own source comments. Assert computed values; never conclude a value holds "because the class is applied".

## Launch

From the repo root:

```bash
KIKO_PORT=3017
mkdir -p /tmp/kiko-verify-evidence
cd apps/web-solid
nohup bunx vite --port "$KIKO_PORT" --strictPort > /tmp/kiko-verify-evidence/vite.log 2>&1 &
for _ in $(seq 1 30); do
  lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t 2>/dev/null > /tmp/kiko-verify-evidence/vite.pid && break
  sleep 0.5
done
```

`nohup` matters because the dev server otherwise dies with the shell that launched it. Capture the pid by asking the *port* who owns it, never with `echo $!`: a backgrounded `bunx` records a wrapper pid that is not the listener, and some non-interactive shells drop `$!` entirely. The loop retries until the listener exists, so the pid file is never left empty. `--strictPort` makes a busy port fail loudly instead of silently moving to 3018, which would leave Doctor asserting against someone else's server.

Confirm the recorded pid is really the listener before driving anything:

```bash
KIKO_PORT=3017
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: pid $PID is gone"; exit 1; }
lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t | grep -qx "$PID" && echo "pid $PID owns $KIKO_PORT" || echo "MISMATCH"
```

**Port 3001 is often already owned by a sibling Kiko checkout.** Check before launching:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

If that prints a row, pick a free port and use that value for `KIKO_PORT` in every later block. Do not kill the process holding 3001: it belongs to another checkout. Find a free port with:

```bash
for p in 3017 3021 3044; do lsof -ti tcp:$p >/dev/null 2>&1 || echo "$p free"; done
```

Vite on this checkout needs roughly six seconds before the `Local:` line appears, so allow for that before concluding the launch failed.

Ready when both hold:

- `/tmp/kiko-verify-evidence/vite.log` contains a `Local:   http://localhost:<port>/` line.
- The root URL serves the app:

```bash
KIKO_PORT=3017
curl -sf "http://localhost:${KIKO_PORT}/" | grep -q '<div id="root">' && echo ready
```

### The Worker, for the signed-in shell

The Vite server alone serves the sign-in screen. Doctor's shell checks and every recipe that drives the composed app need a signed-in session, which needs the Worker. Vite proxies `/api` to port 8787 unless `KIKO_SERVER_PORT` says otherwise, so start the Worker on a free port and launch Vite with `KIKO_SERVER_PORT` set to that port, for example `KIKO_SERVER_PORT=8799 nohup bunx vite ...` in the Launch block.

The Worker serves the client from `apps/web-solid/dist` (`apps/server/wrangler.jsonc`, `assets.directory`). A fresh worktree has that folder empty, so build the client first. Use an absolute path for `<dir>`:

```bash
bun run --cwd apps/web-solid build
(cd apps/server && nohup bunx wrangler dev --port 8799 --persist-to /tmp/kiko-verify-state > /tmp/kiko-verify-evidence/worker.log 2>&1 &)
for _ in $(seq 1 60); do
  lsof -nP -iTCP:8799 -sTCP:LISTEN -t 2>/dev/null > /tmp/kiko-verify-evidence/worker.pid && break
  sleep 0.5
done
```

The loop records the Worker's pid the same way Vite's is recorded, by asking the port who owns it. Cleanup stops only that pid.

## Doctor

One read-only sequence answering "is this instance worth driving?": the process you started is alive, it and not a stray checkout owns the port, the port serves the app, the app mounted, and the kat token layer resolved.

```bash
KIKO_PORT=3017
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: vite pid $PID is not running"; exit 1; }
lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t | grep -qx "$PID" || { echo "FAIL: port $KIKO_PORT is not owned by pid $PID"; exit 1; }
curl -sf "http://localhost:$KIKO_PORT/" | grep -q '<div id="root">' || { echo "FAIL: port $KIKO_PORT does not serve the app"; exit 1; }
ego-browser nodejs <<EOF 2>&1 | tee /tmp/kiko-verify-evidence/doctor.txt
const port = $KIKO_PORT;
const ROLES = [
  "--bg", "--bg-subtle", "--surface-raised", "--menu-bg",
  "--text", "--text-muted", "--text-faint",
  "--assistant-bubble", "--user-bubble", "--user-bubble-text",
  "--accent", "--accent-fill", "--danger", "--success",
  "--font-base", "--line-height", "--radius-bubble",
  // `--radius-sm` is deliberately NOT asserted here. It is declared inside
  // Tailwind's `@theme` block, which the compiler emits as its own `:root`
  // rule, so a read on the document element returns `""` for it while
  // `--radius-bubble` returns `18px` on the same read. Asserting it non-empty
  // here fails against a correct stylesheet. See features/kat-tokens.md.
  "--content-max-w", "--brm", "--hue",
];
const task = await taskSpace("kiko verify doctor");
const page = task.page("p1");
await page.goto("http://localhost:" + port + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  () => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() !== "",
  undefined,
  { timeout: 15_000 },
);
const roles = await page.evaluate((names) => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const name of names) out[name] = cs.getPropertyValue(name).trim();
  return out;
}, ROLES);
const page1 = await page.evaluate(() => ({
  title: document.title,
  rootChildren: document.getElementById("root").childElementCount,
  shell: document.querySelectorAll(".sidebar-shell").length,
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  appearance: document.documentElement.dataset.appearance ?? null,
  bodyFontSize: getComputedStyle(document.body).fontSize,
  // The two deleted theme engines. Both must stay gone.
  inlineKikoVars: [...document.documentElement.style].filter((n) => n.startsWith("--kiko-")).length,
  themeId: document.documentElement.dataset.themeId ?? null,
}));
const font = await page.evaluate(() => ({
  ui: getComputedStyle(document.body).fontFamily.slice(0, 60),
  mono: document.fonts.check("14px 'Fantasque Sans Mono'"),
  faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status),
}));
const empty = Object.entries(roles).filter(([, v]) => v === "");
const ok =
  empty.length === 0 &&
  page1.rootChildren > 0 &&
  page1.shell === 1 &&
  (page1.appearance === "light" || page1.appearance === "dark") &&
  page1.colorScheme === page1.appearance &&
  page1.inlineKikoVars === 0 &&
  page1.themeId === null;
console.log(JSON.stringify({ port, roles, ...page1, font, emptyRoles: empty, ok }));
await task.finish({ keep: [] });
if (!ok) process.exit(1);
EOF
```

`ego-browser` writes its result to **stderr**, not stdout. The `2>&1` before the pipe is what makes `doctor.txt` non-empty; without it `tee` captures nothing and leaves a zero-byte file that looks like a pass.

**Editing `apps/web-solid/vite.config.ts` requires killing and relaunching this dev server.** A running Vite does not always pick a config change up on its own. There are no link previews any more (removed 2026-10-09), so no endpoint in that file serves one.

The heredoc delimiter is unquoted so the shell substitutes `$KIKO_PORT` into the script. `ego-browser nodejs` does **not** inherit the parent environment: `process.env.KIKO_PORT` is `null` inside the script, and a `page.goto` built from it fails with `Cannot navigate to invalid URL`. Read that error as a port that never reached the script, not as a bad URL. For the same reason keep backticks and `${}` out of these scripts so the shell does not eat them.

`bodyFontSize` reads `14px`. The 14px face is on `body`, not `:root`: the root stays at the browser default so Tailwind's rem spacing utilities are not rescaled.

- The chat fixture harness (`src/chat/harness.html`) was removed in 2026-11; every recipe runs against the composed app at `/`, signed in with `/api/auth/dev/session`.

## Drive

`ego-browser nodejs` runs your script in Node.js. Page globals such as `window` and `document` do not exist there; browser-side code goes inside `page.evaluate()`. One TaskSpace per goal: print its `spaceId` and reuse it in later rounds. Every invocation is a fresh Node process, so the space id must be carried forward by hand. Use an unquoted heredoc for the same reason as in Doctor, and keep backticks and `${}` out of these scripts so the shell does not expand them.

`page.evaluate(fn, arg)` takes one JSON-serializable argument. Pass one object, not a second positional value.

### Two ego-browser facts that cost real time on this app

**1. `page.on` does not exist.** `typeof page.on` is `undefined` on this build: there is no event-emitter surface on a Page, so a script written Playwright-style hangs or throws the moment it tries `page.on("console", …)`. `page.events()` exists, but it drains a buffer of events the driver already observed rather than letting you subscribe. To capture console output and uncaught exceptions, install listeners **before the app boots** over CDP, then read the buffer afterwards:

```js
await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push("error: " + (e.message || String(e.error))));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + String(e.reason)));
  `,
});
await page.goto("http://localhost:" + port + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
// ... drive ...
const errs = await page.evaluate(() => window.__errs);
```

The script is evaluated on every new document, so it must be registered **before** `goto`: registering it afterwards misses every error the module graph already threw, which is exactly the window where a broken import lives. Always log the array, including when it is empty: an empty list is the evidence that a state rendered without a runtime error.

**2. `page.goto` with the default `waitUntil: "load"` times out on this app.** The transcript's media never finishes loading, so the `load` event does not fire within the driver's 15s default and `goto` rejects with `PageNavigationTimeoutError: page.goto timed out after 15000ms waiting for domcontentloaded; navigation committed`. Note the message names `domcontentloaded` even when you did not ask for it: that is the driver's phrasing, not a report that your option was ignored; the navigation did commit. **Every `goto` in this skill and in `features/` passes `{ waitUntil: "domcontentloaded" }`**, and a recipe that omits it will appear to time out on a perfectly healthy app. `domcontentloaded` alone has still timed out on a cold Vite module graph, so pass an explicit `timeout: 60000` as well and then `waitForFunction` on the condition you actually care about.

### One entry point

- **Composed app.** `http://localhost:<port>/`. What a user gets: sidebar, top bar, router, transcript and composer together. Signed in, `/` redirects to `/chat/<id>` (`src/app/routes.tsx`, `Resume`). Needs a session: open `/api/auth/dev/session?name=<suite>` once to mint a dev owner token (the redirect puts it in the hash and the app stores it), then `/`. The old fixture harness page and its `window.__chat` probes are gone; drive state the way a user does, through the UI.

```bash
KIKO_PORT=3017
ego-browser nodejs <<EOF
const port = $KIKO_PORT;
const task = await taskSpace("kiko chat");
const page = task.page("p1");
await page.goto("http://localhost:" + port + "/api/auth/dev/session?name=verify", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.goto("http://localhost:" + port + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => document.querySelector("[data-component=chat-shell]"), undefined, { timeout: 15_000 });
console.log({ taskSpaceId: task.spaceId, page: page.label });
console.log(await page.snapshot());
await task.finish({ keep: [] });
EOF
```

### Probing the composed app

The `window.__chat` harness probes are gone with the fixture page. Drive state the way a user does: type into `[data-component="prompt-input"]`, right-click a `[data-component="chat-row"]`, hover for the row actions, and read the DOM the recipes name. State that the fixture table used to fabricate — an unread rule, a day divider, a run of grouped messages — is produced by sending or seeding through the dev session's room.

Measurements that still hold from the fixture days, because they are DOM facts, not probe facts:

- `rows` are `[data-component="chat-vrow"]` elements **in the DOM**, the viewport window, not the message total.
- `data-run` on a row is `start` / `mid` / `bot` where `bot` means *last of its run*. A single isolated message reports `bot`. **Assert run structure on `data-gap` and `padding-top`, not on run counts.**
- The open context menu is `[data-component="menu-v2-content"]` with the class `.chat-menu`; `[data-component="chat-menu"]` matches nothing, because `MenuV2.Context.Content` overwrites the prop.
- The date chip label is read off `[data-component="chat-day-chip"]`, the button, never a divider label.
- `[data-component="image-dialog"]` is the dialog's inner column: `ModalV2.Content` overwrites a `data-component` passed to it.
- The emoji picker is `[data-component="emoji-picker"]`, reached in the composed app through a row's context menu `.chat-menu__more` or the hover actions' `[data-action="more-emoji"]`.

### Selectors you can rely on

These were read out of a live page on both entry points, not inferred from source.

**Chat:**

- `loc=css:#root`: the mount point from `apps/web-solid/index.html`.
- `loc=css:.sidebar-shell`: the full-height flex row the app composes, and the class every rule in `apps/web-solid/src/sidebar/sidebar.css` is scoped under. Its children are the sidebar and `main-column`, which holds the top bar and the `main-row` the route renders into. It is **not** `.chat-shell`.
- `loc=css:html`: carries `class="dark"` and `color-scheme: dark` from `index.html` and the kat base layer.
- `loc=css:[data-component="chat-shell"]`: the composed app's chat pane, rendered inside `main-row` beside the sidebar. It holds the transcript and the composer dock.
- `loc=css:[data-component="chat-stage"]`: the positioned sibling of the scroller that hosts the date chip, the jump pill and the scroll fades, so those do not scroll away.
- `loc=css:[data-component="chat-scroll"]`: the scroller, also `[data-virtual-scroll]`. `window.scrollTo` moves nothing; write `scrollTop` on this element.
- `loc=css:[data-component="chat-column"]`: the centred content column, also `[data-virtual-column]`.
- `loc=css:[data-component="chat-vrow"]`: one virtualized row.
- `loc=css:[data-component="chat-row"]`: one message row, carrying `data-message-id`, `data-side="user|bot"`, `data-run="start|mid|bot"`, `data-gap` on a run start, and `data-replying` on the armed reply target.
- `loc=css:[data-slot="bubble"]`: the positioned parent of a bubble, carrying `data-variant="default|secondary|ghost"`, `data-align="start|end"` and `data-position="only|first|middle|last"`. It has no padding, no fill and no radius of its own. **The sender-side corners tighten to `--bubble-joint` (6px, set in `chat/ui/bubble.css`) on a grouped run**: measured `18/18/18/6` first, `6/18/18/6` middle, `6/18/18/18` last. `data-run` still reports `start|mid|bot` for compatibility but only `data-position` describes the shape.
- `loc=css:[data-slot="bubble-content"]`: the painted, clipping surface. **Read padding, radius, fill and font size here**, never off the parent.
- `loc=css:[data-slot="bubble-reactions"]`: the absolutely positioned reaction row.
- `loc=css:[data-component="chat-divider"]`: a day-divider row, holding `[data-component="chat-day-label"]` and `[data-component="chat-day-time"]`. **There is no `.chat-divider__label`.**
- `loc=css:[data-component="chat-date-chip"]`: the floating day chip's anchor, also `.chat-chip-anchor`; carries `data-visible` and `data-open`.
- `loc=css:[data-component="chat-day-chip"]`: the chip's `<button>` trigger, also `.chat-chip`, carrying `aria-expanded` and a `title` with the full timestamp. **This is the element to read the chip's label from**; `probe().dateChip` reads it.
- `loc=css:.chat-calendar`: the month grid the chip opens, with `.chat-calendar__day` cells and a `.chat-calendar__title` that swaps days for months.
- `loc=css:[data-component="chat-unread-rule"]`: the new-messages rule.
- `loc=css:[data-component="chat-quote"]`: the reply quote, with `.chat-quote__label`, `.chat-quote__text` and an optional `.chat-quote__thumb`.
- `loc=css:[data-component="chat-attachments"]`: one message's attachments, inside its bubble above the text.
- `loc=css:[data-component="chat-attachment-image"]`: one picture tile, a `<button aria-label="Preview <name>">` in a `grid max-w-[210px] grid-cols-2 gap-2`; a lone tile has `col-span-2`.
- `loc=css:[data-component="chat-attachment-file"]`: one file row: icon, name, eye (`aria-label="Preview <name>"`) and a download link (`[data-action="download"]`, `download` attribute).
- `loc=css:[data-component="chat-masked-link"]`: a homograph host: text kept, `href` dropped, `role="link"`, and a confirm dialog on click.
There is **no `chat-row-time`** and no hover-revealed timestamp: text bubbles show no time at all.
- `loc=css:[data-component="chat-actions"]`: a row's hover actions (`[data-action="react"]`, `reply`, `more`), shown on row hover or focus on a pointer device only. There is no swipe to reply.
- `loc=css:[data-component="reaction-popover"]`: the quick reactions the react button opens; `[data-action="more-emoji"]` swaps in `[data-component="emoji-picker"]`.
- `loc=css:[data-component="emoji-shortcodes"]`: the composer's `:shortcode` list, one `[data-component="emoji-shortcode"]` row per match.
- `loc=css:[data-component="chat-typing-row"]`: the in-list typing row.
- `loc=css:[data-component="chat-fades"]` / `chat-fade-top` / `chat-fade-bottom`: the scrims on the stage.
- The jump-to-latest control is in the composer, not the transcript: `[data-component="composer-scroll-down"]` (see **Composer**).
- `loc=css:[data-component="chat-empty"]`: the empty-thread state: the dim kiko bird with a heart, no text.
- `loc=css:.menu-v2-content`: **the** handle for a Kobalte menu's content element. `MenuV2.Context.Content` overwrites any `data-component` passed to it with its own. Measured: the message menu is open with `[data-component="chat-menu"]` at `0` and `[data-component="menu-v2-content"]` at `1`, while the class `.chat-menu` is present on the same element. So **scope the menu by `.chat-menu` or `[data-component="menu-v2-content"]`; `[data-component="chat-menu"]` matches nothing.** Read its `[data-component="menu-v2-item"]` children for the action list.
- `loc=css:[data-component="image-dialog"]`: the image dialog's column (picture, close button, caption `[data-component="image-dialog-caption"]`), inside a Kobalte modal. The files tab draws a picture inline (`[data-component="file-image"]`); see `features/files-panel.md`.

**Composer** (composed app only): `[data-component="composer-dock"]`, `composer-scroll-down`, `composer-reply-bar` (classes `.reply-bar`, `.reply-bar-jump`), `composer-attachment` (a thumbnail with `data-image`, or a file row), `composer-drop-overlay` (while files are dragged over the page), `[data-component="prompt-input"]`, `prompt-input-box`, `prompt-input-v2`.

**Sidebar:** `[data-component="sidebar"]`, `sidebar-row`, `sidebar-pin-tile`, `sidebar-unread-count`, `sidebar-resize`, `sidebar-add`, `sidebar-chats`, `sidebar-empty`, and `[data-component="hover-card-v2-content"]`.

**Prefer the `data-component` attribute over the class.** Two stylesheets once both defined a bare `.chat-shell` for different elements (the app's pane and the transcript's scroller) with conflicting `overflow` and layout. The pane is `[data-component="chat-shell"]` inside `.sidebar-shell` and the scroller is `[data-component="chat-scroll"]`, and the attribute is the handle that stays stable across that rename.

Selectors to avoid: a `data-theme-id`, a `data-theme`, a `--kiko-*` variable, a `data-continuation` attribute and a `chat-actionbar` are all things this app no longer renders. A grep of `apps/web-solid/src` and `packages/ui/src` finds none of them. A `data-component` handed to `MenuV2.Content` as a prop is likewise not a handle.

The transcript is virtualized with `virtua`, so the DOM holds only the visible rows. `document.querySelectorAll("[data-component=chat-vrow]").length` tracks the viewport, not the message count, and an element captured before a scroll can be detached by the time you act on it. Re-query immediately before every action.

## Evidence

Proof artifacts go under `/tmp/kiko-verify-evidence/`, which survives cleanup. The paths this skill and the feature map write:

- `/tmp/kiko-verify-evidence/vite.log`: the dev server log for the run.
- `/tmp/kiko-verify-evidence/vite.pid`: the listener pid, deleted by Cleanup.
- `/tmp/kiko-verify-evidence/doctor.txt`: the Doctor JSON line.
- `/tmp/kiko-verify-evidence/kat-tokens.json`: every role read off `getComputedStyle`, with its resolved value.
- `/tmp/kiko-verify-evidence/font-load.json`: the loaded `FontFace` set and the `document.fonts.check` results.
- `/tmp/kiko-verify-evidence/app-shell.snapshot.txt` and `app-shell.png`: the mounted page.
- `/tmp/kiko-verify-evidence/chat-bubbles.json` and `chat-bubbles.png`: column width, bubble widths, run facts, corner radii, and the jumbo scale.
- `/tmp/kiko-verify-evidence/day-chip.json`: the date-chip label per fixture day state.
- `/tmp/kiko-verify-evidence/lowercase-chrome.json`: computed `text-transform` for chrome labels and message bodies.
- `/tmp/kiko-verify-evidence/no-border.json`: computed `border-width` across every bubble, chip, menu and card.
- `/tmp/kiko-verify-evidence/no-animation.json`: computed `transition-duration` across those same elements, with the three permitted exceptions named.
- `/tmp/kiko-verify-evidence/chat-menu.json`: the right-click menu's item list for a viewer's message and for an agent's, with each `openMenu` return value.
- `/tmp/kiko-verify-evidence/reply-jump.json`: quote line count, quote height, and the scroll delta after the jump.
- `/tmp/kiko-verify-evidence/unread-rule.json`: the unread rule's index among rows, before and after sending.
- `/tmp/kiko-verify-evidence/reactions.json`: badge geometry and the toggle result.
- `/tmp/kiko-verify-evidence/typing.json`: the typing bubble's dot count and the `aria-live` label.
- `/tmp/kiko-verify-evidence/picker.json`: the picker's search result count and its shortcode footer.
- `/tmp/kiko-verify-evidence/media.json`: picture tile rects, file rows, and the image dialog's open, step and close state.
- `/tmp/kiko-verify-evidence/rich-text.json`: which runs became anchors, which stayed prose, and the homograph flag.
- `/tmp/kiko-verify-evidence/sidebar.json` and `sidebar.png`: the rail, panel and tile/row geometry, the pinned grid's column count at two panel widths, and the before/after pairs for the row menu's `pin`, `mark as read` and `mark as unread` items.

Standards:

- Exercise the real user path. Proving the token layer means loading `http://localhost:<port>/` the way a user's browser does and reading what the page actually applied: not importing the stylesheet into a scratch script.
- Capture the action and the resulting state. A screenshot alone is not proof; the read is the assertion and the screenshot is context.
- Assertions live in the script's own output, not in comments: `console.log` the value you checked.
- A rule that must be *absent* (no borders, no animation, no uppercase body) is proven by reading every candidate element's computed style and logging the list that violates it. Logging a count of `0` over a selector that matched nothing proves nothing; log the match count next to the violation count.
- Write artifacts from inside the script, with Node's `fs`, so the file is produced by the same run that asserted it:

```bash
KIKO_PORT=3017
ego-browser nodejs <<EOF
const { writeFile } = await import("node:fs/promises");
const port = $KIKO_PORT;
const task = await taskSpace("kiko verify kat tokens");
const page = task.page("p1");
await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: 'window.__errs=[];addEventListener("error",e=>window.__errs.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__errs.push(String(e.reason)));',
});
await page.goto("http://localhost:" + port + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() !== "", undefined, { timeout: 15000 });
const roles = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const names = ["--bg", "--text", "--user-bubble", "--assistant-bubble", "--accent", "--font-base", "--radius-bubble", "--content-max-w"];
  const out = {};
  for (const name of names) out[name] = cs.getPropertyValue(name).trim();
  return out;
});
const font = await page.evaluate(() => ({
  inter: document.fonts.check("14px InterVariable"),
  faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status),
}));
const errs = await page.evaluate(() => window.__errs ?? []);
await writeFile("/tmp/kiko-verify-evidence/kat-tokens.json", JSON.stringify(roles, null, 2));
await writeFile("/tmp/kiko-verify-evidence/font-load.json", JSON.stringify(font, null, 2));
const snapshot = await page.snapshot();
await writeFile("/tmp/kiko-verify-evidence/app-shell.snapshot.txt", snapshot);
await page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" });
console.log({ taskSpaceId: task.spaceId, roles, font, errs });
await task.finish({ keep: [] });
if (Object.values(roles).some((v) => v === "")) process.exit(1);
EOF
```

## Cleanup

Tear down only what this run started. Read the recorded pid; never kill by process name, and never kill the process on 3001 that you did not launch.

```bash
for PIDFILE in /tmp/kiko-verify-evidence/vite.pid /tmp/kiko-verify-evidence/worker.pid; do
  [ -f "$PIDFILE" ] || continue
  PID=$(cat "$PIDFILE")
  kill "$PID" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$PID" 2>/dev/null
  rm -f "$PIDFILE"
done
```

Do not delete `/tmp/kiko-verify-evidence/`. Evidence outlives the run; the pid file does not. Confirm what survived:

```bash
ls -l /tmp/kiko-verify-evidence
```

## Helpers

This skill ships no helper scripts. Every command it contains is copy-pasteable as written, which is deliberate: the whole harness is `ego-browser nodejs`, and a wrapper would only hide the TaskSpace lifecycle and the pid bookkeeping that Cleanup depends on.

There is no second skill for this app. The former `verify-web-solid` skill was a near-duplicate that documented a roster sidebar the app does not have, and it was deleted; `features/` under this skill is the only map.