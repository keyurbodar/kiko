---
name: verify-yuki
description: "Drive the Yuki web app (SolidJS + Vite) in a real browser to prove what a user sees, and capture evidence. Use for 'verify the app', 'prove this change in the browser', 'check the Yuki UI', or before claiming a web-solid slice works."
---

> **Owner rule.** Never use `ego-browser`. Drive the app with `agent-browser --session <name>` (its own Chromium). The `ego-browser` sections below are kept only for what they check, not how they drive.

# Verify Yuki

Yuki is a SolidJS + Vite chat app at `apps/web-solid`. The only surface a user touches is a web UI, so verification means launching the Vite dev server and driving it with `ego-browser`, a Chromium driver available in this environment.

There is **no Playwright, no Puppeteer, and no Chrome.app** on this machine. `import { chromium } from "playwright"` fails. Use `ego-browser nodejs` as the harness, exactly as the Drive section shows.

Every check below is read-only except the launch itself. Never edit a source file to make a check pass.

**Use `http://localhost:<port>/`, never `http://127.0.0.1:<port>/`.** The Vite dev server binds the IPv6 loopback only, so `127.0.0.1` is refused outright. Measured on this machine with `curl -sf -o /dev/null -w '%{http_code}'`: `localhost` answers `200` and `127.0.0.1` exits `7` (connection refused). Every recipe in this skill and in `features/` uses `localhost` for that reason, and a recipe that reaches for `127.0.0.1` fails at the connection, not at the assertion.

Colour comes from one stylesheet, `packages/ui/src/styles/kat.css`, pulled in by `apps/web-solid/src/styles/app.css`. kat.css has a light scale and a dark scale. The appearance setting (**Mode**: System, Light or Dark, in `src/theme/appearance.tsx`) picks one, and `src/theme/apply.ts` writes it to `data-appearance` and the `dark` class on `<html>`. The default is System, so read `data-appearance` before asserting a scheme. It also has a **sidebar**: a conversation column down the left edge of the signed-in app, with its own feature file at [Sidebar](./features/sidebar.md).

**There is no `chat.css` in the chat slice.** It was deleted with the previous implementation. Styling is inline Tailwind utilities on the component that renders the element, plus the token layer, plus a few component stylesheets imported beside the component. `apps/web-solid/src/styles/` holds `app.css`, which declares the `@layer` order, imports kat and the icon styles, and has two small rules, and `motion.css`. The bubble shape is in `apps/web-solid/src/chat/ui/bubble.css`, imported by `bubble.tsx`. Other component stylesheets include `sidebar/sidebar.css`, `composer/composer.css` and `chat/rich/rich.css`. **A `.chat-*` class name is a QA handle, not a style hook**. Many of them exist only so a probe can find the element, and several components say so in their own source comments. Assert computed values; never conclude a value holds "because the class is applied".

## Launch

From the repo root:

```bash
YUKI_PORT=3017
mkdir -p /tmp/yuki-verify-evidence
cd apps/web-solid
nohup bunx vite --port "$YUKI_PORT" --strictPort > /tmp/yuki-verify-evidence/vite.log 2>&1 &
for _ in $(seq 1 30); do
  lsof -nP -iTCP:"$YUKI_PORT" -sTCP:LISTEN -t 2>/dev/null > /tmp/yuki-verify-evidence/vite.pid && break
  sleep 0.5
done
```

`nohup` matters because the dev server otherwise dies with the shell that launched it. Capture the pid by asking the *port* who owns it, never with `echo $!`: a backgrounded `bunx` records a wrapper pid that is not the listener, and some non-interactive shells drop `$!` entirely. The loop retries until the listener exists, so the pid file is never left empty. `--strictPort` makes a busy port fail loudly instead of silently moving to 3018, which would leave Doctor asserting against someone else's server.

Confirm the recorded pid is really the listener before driving anything:

```bash
YUKI_PORT=3017
PID=$(cat /tmp/yuki-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: pid $PID is gone"; exit 1; }
lsof -nP -iTCP:"$YUKI_PORT" -sTCP:LISTEN -t | grep -qx "$PID" && echo "pid $PID owns $YUKI_PORT" || echo "MISMATCH"
```

**Port 3001 is often already owned by a sibling Yuki checkout.** Check before launching:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

If that prints a row, pick a free port and use that value for `YUKI_PORT` in every later block. Do not kill the process holding 3001: it belongs to another checkout. Find a free port with:

```bash
for p in 3017 3021 3044; do lsof -ti tcp:$p >/dev/null 2>&1 || echo "$p free"; done
```

Vite on this checkout needs roughly six seconds before the `Local:` line appears, so allow for that before concluding the launch failed.

Ready when both hold:

- `/tmp/yuki-verify-evidence/vite.log` contains a `Local:   http://localhost:<port>/` line.
- The root URL serves the app:

```bash
YUKI_PORT=3017
curl -sf "http://localhost:${YUKI_PORT}/" | grep -q '<div id="root">' && echo ready
```

### The Worker, for the signed-in shell

The Vite server alone serves the sign-in screen. Doctor's shell checks and every recipe that drives the composed app need a signed-in session, which needs the Worker. Vite proxies `/api` to port 8787 unless `YUKI_SERVER_PORT` says otherwise, so start the Worker on a free port and launch Vite with `YUKI_SERVER_PORT` set to that port, for example `YUKI_SERVER_PORT=8799 nohup bunx vite ...` in the Launch block.

The Worker serves the client from `apps/web-solid/dist` (`apps/server/wrangler.jsonc`, `assets.directory`). A fresh worktree has that folder empty, so build the client first. Use an absolute path for `<dir>`:

```bash
bun run --cwd apps/web-solid build
(cd apps/server && nohup bunx wrangler dev --port 8799 --persist-to /tmp/yuki-verify-state > /tmp/yuki-verify-evidence/worker.log 2>&1 &)
for _ in $(seq 1 60); do
  lsof -nP -iTCP:8799 -sTCP:LISTEN -t 2>/dev/null > /tmp/yuki-verify-evidence/worker.pid && break
  sleep 0.5
done
```

The loop records the Worker's pid the same way Vite's is recorded, by asking the port who owns it. Cleanup stops only that pid.

## Doctor

One read-only sequence answering "is this instance worth driving?": the process you started is alive, it and not a stray checkout owns the port, the port serves the app, the app mounted, and the kat token layer resolved.

```bash
YUKI_PORT=3017
PID=$(cat /tmp/yuki-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: vite pid $PID is not running"; exit 1; }
lsof -nP -iTCP:"$YUKI_PORT" -sTCP:LISTEN -t | grep -qx "$PID" || { echo "FAIL: port $YUKI_PORT is not owned by pid $PID"; exit 1; }
curl -sf "http://localhost:$YUKI_PORT/" | grep -q '<div id="root">' || { echo "FAIL: port $YUKI_PORT does not serve the app"; exit 1; }
ego-browser nodejs <<EOF 2>&1 | tee /tmp/yuki-verify-evidence/doctor.txt
const port = $YUKI_PORT;
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
const task = await taskSpace("yuki verify doctor");
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
  inlineYukiVars: [...document.documentElement.style].filter((n) => n.startsWith("--yuki-")).length,
  themeId: document.documentElement.dataset.themeId ?? null,
}));
const font = await page.evaluate(() => ({
  ui: getComputedStyle(document.body).fontFamily.slice(0, 60),
  mono: document.fonts.check("14px 'Fantasque Sans Mono'"),
  faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status),
}));
const harness = await page.fetch("/src/chat/harness.html");
const empty = Object.entries(roles).filter(([, v]) => v === "");
const ok =
  empty.length === 0 &&
  page1.rootChildren > 0 &&
  page1.shell === 1 &&
  (page1.appearance === "light" || page1.appearance === "dark") &&
  page1.colorScheme === page1.appearance &&
  page1.inlineYukiVars === 0 &&
  page1.themeId === null;
console.log(JSON.stringify({ port, roles, ...page1, font, harnessStatus: harness.status, emptyRoles: empty, ok }));
await task.finish({ keep: [] });
if (!ok) process.exit(1);
EOF
```

`ego-browser` writes its result to **stderr**, not stdout. The `2>&1` before the pipe is what makes `doctor.txt` non-empty; without it `tee` captures nothing and leaves a zero-byte file that looks like a pass.

**Editing `apps/web-solid/vite.config.ts` requires killing and relaunching this dev server.** A running Vite does not always pick a config change up on its own. There are no link previews any more (removed 2026-10-09), so no endpoint in that file serves one.

The heredoc delimiter is unquoted so the shell substitutes `$YUKI_PORT` into the script. `ego-browser nodejs` does **not** inherit the parent environment: `process.env.YUKI_PORT` is `null` inside the script, and a `page.goto` built from it fails with `Cannot navigate to invalid URL`. Read that error as a port that never reached the script, not as a bad URL. For the same reason keep backticks and `${}` out of these scripts so the shell does not eat them.

`bodyFontSize` reads `14px`. The 14px face is on `body`, not `:root`: the root stays at the browser default so Tailwind's rem spacing utilities are not rescaled.

- `harnessStatus` is `200`. The chat harness is the entry point for every chat feature recipe; without it the composed app still boots but the transcript fixtures are unreachable. A non-200 here means the chat slice is not on disk, so the chat recipes are pending, not failing.

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
await page.goto("http://localhost:" + port + "/src/chat/harness.html", { waitUntil: "domcontentloaded", timeout: 60000 });
// ... drive ...
const errs = await page.evaluate(() => window.__errs);
```

The script is evaluated on every new document, so it must be registered **before** `goto`: registering it afterwards misses every error the module graph already threw, which is exactly the window where a broken import lives. Always log the array, including when it is empty: an empty list is the evidence that a state rendered without a runtime error.

**2. `page.goto` with the default `waitUntil: "load"` times out on this app.** The transcript's media never finishes loading, so the `load` event does not fire within the driver's 15s default and `goto` rejects with `PageNavigationTimeoutError: page.goto timed out after 15000ms waiting for domcontentloaded; navigation committed`. Note the message names `domcontentloaded` even when you did not ask for it: that is the driver's phrasing, not a report that your option was ignored; the navigation did commit. **Every `goto` in this skill and in `features/` passes `{ waitUntil: "domcontentloaded" }`**, and a recipe that omits it will appear to time out on a perfectly healthy app. `domcontentloaded` alone has still timed out on a cold Vite module graph, so pass an explicit `timeout: 60000` as well and then `waitForFunction` on the condition you actually care about.

### Two entry points

- **Composed app.** `http://localhost:<port>/`. What a user gets, and the only entry point with the sidebar, the top bar, the router and the composer together. Signed in, `/` redirects to `/chat/<id>` (`src/app/routes.tsx`, `Resume`). It composes the sidebar, the transcript **and the composer**: `[data-component="composer-dock"]` is present on `/chat/<id>`, rendered by `src/app/routes/chat.tsx`, and is the only place it exists. Needs a signed-in session (see Launch).
- **Chat harness.** `http://localhost:<port>/src/chat/harness.html`. The chat slice's own page, with every fixture state addressable and probes on `window.__chat`. It mounts `MessageList` alone and needs no session: **no composer, no sidebar, no top bar and no send path.** A recipe that needs one of those is a composed-app recipe.

```bash
YUKI_PORT=3017
ego-browser nodejs <<EOF
const port = $YUKI_PORT;
const task = await taskSpace("yuki chat");
const page = task.page("p1");
await page.goto("http://localhost:" + port + "/src/chat/harness.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => typeof window.__chat === "object", undefined, { timeout: 15_000 });
const probe = await page.evaluate(() => window.__chat.probe());
console.log({ taskSpaceId: task.spaceId, page: page.label, probe });
console.log(await page.snapshot());
await task.finish({ keep: [] });
EOF
```

### `window.__chat` probes

Every setter drives the same reactive path a user action takes. None is a test-only branch. This is the full surface, read out of `apps/web-solid/src/chat/harness.tsx`: `Object.keys(window.__chat)` returns exactly these thirteen names.

| Probe | Argument | What it does |
| --- | --- | --- |
| `states()` | none | The fixture slugs the harness accepts, as shipped |
| `setState(slug)` | one of the fixture slugs below | Loads that fixture state and re-renders the transcript. Returns the slug it resolved to |
| `setTyping(names)` | array of names, `[]` to clear | Puts those senders into the typing state, or clears it. Returns the array it resolved to |
| `setReplyTarget(messageId)` | a message id, or `null` | Arms a reply so the next send quotes that message. Returns the id or `null` |
| `openMenu(messageId)` | a message id | Dispatches a real `contextmenu` on that row. Returns whether a menu appeared |
| `openPicker(messageId)` | a message id | Dispatches `pointerdown`+`pointerup`+`click` on the row's add-reaction control. Returns whether a picker appeared |
| `openMedia(messageId, index = 0)` | a message id and a picture index | Clicks that picture tile. Async: resolves to whether the image dialog appeared within a second (its body loads on first open) |
| `closeMedia()` | none | Dispatches `Escape` on the document. Returns whether the image dialog went away |
| `probe()` | none | Returns the whole observation object, below |
| `state()` | none | The current fixture slug |
| `messages` | none | The current state's message array |
| `threadState` | none | The last `{ scrollOffset, scrollSize, viewportSize, rangeStart, rangeEnd }` the transcript reported |
| `viewerId` | none | The id the composer speaks for, so a probe can tell own rows from the agent's |

There is **no `now()` probe.** An earlier version of this map listed one; it does not exist, and `typeof window.__chat.now` is `undefined`. Read the clock through `getComputedStyle` on the rendered chip instead.

`probe()` returns `{ state, rows, bubbles, dateChip, dayLabels, unreadRule, runs, typing, overlay, replyTarget, images, files, viewer, tokens }`:

- `rows`: `[data-component="chat-vrow"]` **in the DOM**, which is the viewport and not the message total.
- `bubbles`: elements carrying `data-message-id`.
- `dateChip`: the chip trigger's own text, or `null`. Read the **button** (`[data-component="chat-day-chip"]`), not a divider label, which is not inside it.
- `dayLabels`: every `[data-component="chat-day-label"]` in the DOM. **It is `[]` for every harness fixture state**, because no single state spans two calendar days: each day-boundary state is a slice that starts on its own day, so `buildTimelineItems` never inserts a divider. A recipe that needs a divider has to read it at `/`, where the active thread does span days. This is not a broken probe: measured `[]` in `three-days-ago`, `yesterday`, `today`, `unread` and `media-card`, and the source comment in `harness.tsx` records that a previous read targeted a `chat-divider__label` class the transcript never renders, which made `dayLabels` silently empty for exactly this reason.
- `unreadRule`: `[data-component="chat-unread-rule"]` is present.
- `runs`: bubbles whose `data-run` is **`"start"`**. Note this is a tail fact, not a per-run count: `data-run` is `start` / `mid` / `bot` where `bot` means *last of its run*. A three-message run reports `1`; a run of two reports `1`; a single isolated message reports `0`, because a lone message is both start and end and resolves to `bot`. **Assert run structure on `data-gap` and `padding-top`, not on `runs`**. Measured: `grouped` reports `runs: 1` with rows `start`/`mid`/`bot`, and a three-row `run-gap` also reports `runs: 1` with rows `bot`/`start`/`bot` and two rows carrying `data-gap`.
- `typing`: `[data-component="chat-typing-row"]` is present.
- `overlay`: `"menu"`, `"picker"` or `null`.
- `replyTarget`: the armed reply id or `null`.
- `images`: `[data-component="chat-attachment-image"]` picture tiles in the DOM, across every message.
- `files`: `[data-component="chat-attachment-file"]` file rows in the DOM, across every message.
- `viewer`: `true` while `[data-component="image-dialog"]` is mounted. That handle is on the dialog's inner column, because `ModalV2.Content` overwrites a `data-component` passed to it.
- `tokens`: the resolved `--user-bubble`, `--assistant-bubble`, `--font-base` and `--radius-bubble`. Measured on the harness after the Sakura theme: `oklch(0.51 0.062 356)`, `oklch(0.278 0 6)`, `14px`, `18px`. Structural backgrounds are chroma 0; mauve appears only on the own bubble and accent marks.

`setState`, `setTyping` and `setReplyTarget` return the value they resolved to, so a caller can assert the result in the same round. `openMenu`, `openPicker`, `openMedia` and `closeMedia` return a boolean saying whether a dialog actually opened: read it, because a stale overlay left on screen makes a no-op look like an open menu. `openMenu` returning `true` is an **observation, not a guarantee**: it tests `[role='menu'], [data-component*='menu']`, which matches the menu's `menu-v2-content`. Measured on `today`: `openMenu` returns `true` for `a-35`, `a-36` and `a-37` with `probe().overlay === "menu"`, but `[data-component="chat-menu"]` is `0` even while the menu is open. See the selector note below.

`openPicker` opens the menu, clicks `.chat-menu__more`, and waits up to 5s for `[data-component='emoji-picker']`. The picker is yuki's own component in the light DOM, drawing system emoji glyphs. On a pointer device the same picker is also reached from a row's hover actions: hover `[data-action="react"]`, then click the popover's `[data-action="more-emoji"]`.

The harness also takes the state in the URL, which is the cheaper way to start a round: `http://localhost:<port>/src/chat/harness.html?state=unread`. An unknown slug falls back to `today` **and says so in the page's own state readout.** `[data-component="harness-state"]` renders `Unknown state: <slug>`, so a typo is visible on the page rather than silent. Read `probe().state` and `[data-component="harness-state"]` before measuring. `?typing=ada,grace` starts a round with those senders already typing.

The harness chrome itself is `harness-root`, `harness-bar`, `harness-title`, `harness-state`, `harness-spacer` and `harness-hint`. It used to be a stylesheet; it is now inline utilities, and the class names survive only so a node is easy to find in devtools. None of those strings selects a descendant.

### Fixture slugs

`Object.keys(FIXTURE_STATES)` returns exactly these thirty-six, and this list is authoritative: read it from `apps/web-solid/src/lib/fixtures.ts` or call `window.__chat.states()`.

| Slug | State |
| --- | --- |
| `read-more` | a 3,000 character body between short rows, clamped until expanded |
| `pause-gap` | a pause over an hour inside one day, which draws a divider; ten minutes does not |
| `grouped` | three consecutive agent messages, one run |
| `run-gap` | a run broken by a gap longer than the 300s window |
| `run-break-reply` | a run broken because the next message replies to something else |
| `long` | a long multi-paragraph body, so the 80% cap binds |
| `jumbo-single` | one jumbo-sized pure-emoji body |
| `jumbo-group` | a run of jumbo emoji |
| `jumbo-prose` | a jumbo run that also contains prose |
| `link` | links in the body: the text draws them and nothing else |
| `reply-text` | a reply to a text message |
| `reply-image` | a reply to a message with a picture, so the quote carries a thumbnail |
| `grid-2` / `grid-3` / `grid-4` / `grid-5` | the picture grid at four counts; an odd count leaves one tile on the last row |
| `grid-shapes` | a pano, a square and a portrait, all cropped to the same 4:3 tile |
| `picture-only` | a single picture with no body at all; it spans both columns |
| `picture-caption` | one picture with a line of text under it |
| `video` | clips, which are file rows like any other file |
| `picture-link` | a picture and a link in one message |
| `rich-text` | every run the body parser has to tell apart on one line |
| `reactions` | a cluster: one chip the viewer has pressed beside a counted chip they are not part of |
| `edited` | the edited marker on a body that was not rewritten |
| `pinned` | a pinned message, plus the reply that follows it |
| `three-days-ago` / `yesterday` / `today` | the day boundaries, for the date chip |
| `unread` | an unread division with a rule before the first unread incoming message, and rows above **and** below it |
| `file-single` / `file-group` | one PDF with a caption; three files on an old agent message plus a docx from the viewer |
| `user-grid-3` / `user-grid-2-reply` / `user-picture` | the viewer's own pictures, pictures sent as a reply, and a lone picture |
| `link-only` | messages that are only a link; they draw as ordinary bubbles |
| `grouped-own` | three consecutive viewer messages in one run (ids `run-01`..`run-05`), then a two-message agent run |

A slug that `setState` rejects is a fixture gap to report, not a typo to work around by picking another state.

### Selectors you can rely on

These were read out of a live page on both entry points, not inferred from source.

**Chat:**

- `loc=css:#root`: the mount point from `apps/web-solid/index.html`.
- `loc=css:.sidebar-shell`: the full-height flex row the app composes, and the class every rule in `apps/web-solid/src/sidebar/sidebar.css` is scoped under. Its children are the sidebar and `main-column`, which holds the top bar and the `main-row` the route renders into. It is **not** `.chat-shell`.
- `loc=css:html`: carries `class="dark"` and `color-scheme: dark` from `index.html` and the kat base layer.
- `loc=css:[data-component="chat-shell"]`: the composed app's chat pane, rendered inside `main-row` beside the sidebar. It holds the transcript and the composer dock. **Not present in the harness.**
- `loc=css:[data-component="chat-stage"]`: the positioned sibling of the scroller that hosts the date chip, the jump pill and the scroll fades, so those do not scroll away.
- `loc=css:[data-component="chat-scroll"]`: the scroller, also `[data-virtual-scroll]`. `window.scrollTo` moves nothing; write `scrollTop` on this element.
- `loc=css:[data-component="chat-column"]`: the centred content column, also `[data-virtual-column]`.
- `loc=css:[data-component="chat-vrow"]`: one virtualized row.
- `loc=css:[data-component="chat-row"]`: one message row, carrying `data-message-id`, `data-side="user|bot"`, `data-run="start|mid|bot"`, `data-gap` on a run start, and `data-replying` on the armed reply target.
- `loc=css:[data-slot="bubble"]`: the positioned parent of a bubble, carrying `data-variant="default|secondary|ghost"`, `data-align="start|end"` and `data-position="only|first|middle|last"`. It has no padding, no fill and no radius of its own. **The sender-side corners tighten to `--bubble-joint` (6px, set in `chat/ui/bubble.css`) on a grouped run**: measured on harness `grouped`, first is `18/18/18/6`, middle is `6/18/18/6`, last is `6/18/18/18`. `data-run` still reports `start|mid|bot` for compatibility but only `data-position` describes the shape.
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
- `loc=css:[data-component="chat-empty"]`: the empty-thread state: the dim yuki bird with a heart, no text.
- `loc=css:.menu-v2-content`: **the** handle for a Kobalte menu's content element. `MenuV2.Context.Content` overwrites any `data-component` passed to it with its own. Measured: the message menu is open with `[data-component="chat-menu"]` at `0` and `[data-component="menu-v2-content"]` at `1`, while the class `.chat-menu` is present on the same element. So **scope the menu by `.chat-menu` or `[data-component="menu-v2-content"]`; `[data-component="chat-menu"]` matches nothing.** Read its `[data-component="menu-v2-item"]` children for the action list.
- `loc=css:[data-component="image-dialog"]`: the image dialog's column (picture, close button, caption `[data-component="image-dialog-caption"]`), inside a Kobalte modal. The files tab draws a picture inline (`[data-component="file-image"]`); see `features/files-panel.md`.

**Composer** (composed app only): `[data-component="composer-dock"]`, `composer-scroll-down`, `composer-reply-bar` (classes `.reply-bar`, `.reply-bar-jump`), `composer-attachment` (a thumbnail with `data-image`, or a file row), `composer-drop-overlay` (while files are dragged over the page), `[data-component="prompt-input"]`, `prompt-input-box`, `prompt-input-v2`.

**Sidebar:** `[data-component="sidebar"]`, `sidebar-row`, `sidebar-pin-tile`, `sidebar-unread-count`, `sidebar-resize`, `sidebar-add`, `sidebar-chats`, `sidebar-empty`, and `[data-component="hover-card-v2-content"]`.

**Prefer the `data-component` attribute over the class.** Two stylesheets once both defined a bare `.chat-shell` for different elements (the app's pane and the transcript's scroller) with conflicting `overflow` and layout. The pane is `[data-component="chat-shell"]` inside `.sidebar-shell` and the scroller is `[data-component="chat-scroll"]`, and the attribute is the handle that stays stable across that rename.

Selectors to avoid: a `data-theme-id`, a `data-theme`, a `--yuki-*` variable, a `data-continuation` attribute and a `chat-actionbar` are all things this app no longer renders. A grep of `apps/web-solid/src` and `packages/ui/src` finds none of them. A `data-component` handed to `MenuV2.Content` as a prop is likewise not a handle.

The transcript is virtualized with `virtua`, so the DOM holds only the visible rows. `document.querySelectorAll("[data-component=chat-vrow]").length` tracks the viewport, not the message count, and an element captured before a scroll can be detached by the time you act on it. Re-query immediately before every action.

## Evidence

Proof artifacts go under `/tmp/yuki-verify-evidence/`, which survives cleanup. The paths this skill and the feature map write:

- `/tmp/yuki-verify-evidence/vite.log`: the dev server log for the run.
- `/tmp/yuki-verify-evidence/vite.pid`: the listener pid, deleted by Cleanup.
- `/tmp/yuki-verify-evidence/doctor.txt`: the Doctor JSON line.
- `/tmp/yuki-verify-evidence/kat-tokens.json`: every role read off `getComputedStyle`, with its resolved value.
- `/tmp/yuki-verify-evidence/font-load.json`: the loaded `FontFace` set and the `document.fonts.check` results.
- `/tmp/yuki-verify-evidence/app-shell.snapshot.txt` and `app-shell.png`: the mounted page.
- `/tmp/yuki-verify-evidence/chat-bubbles.json` and `chat-bubbles.png`: column width, bubble widths, run facts, corner radii, and the jumbo scale.
- `/tmp/yuki-verify-evidence/day-chip.json`: the date-chip label per fixture day state.
- `/tmp/yuki-verify-evidence/lowercase-chrome.json`: computed `text-transform` for chrome labels and message bodies.
- `/tmp/yuki-verify-evidence/no-border.json`: computed `border-width` across every bubble, chip, menu and card.
- `/tmp/yuki-verify-evidence/no-animation.json`: computed `transition-duration` across those same elements, with the three permitted exceptions named.
- `/tmp/yuki-verify-evidence/chat-menu.json`: the right-click menu's item list for a viewer's message and for an agent's, with each `openMenu` return value.
- `/tmp/yuki-verify-evidence/reply-jump.json`: quote line count, quote height, and the scroll delta after the jump.
- `/tmp/yuki-verify-evidence/unread-rule.json`: the unread rule's index among rows, before and after sending.
- `/tmp/yuki-verify-evidence/reactions.json`: badge geometry and the toggle result.
- `/tmp/yuki-verify-evidence/typing.json`: the typing bubble's dot count and the `aria-live` label.
- `/tmp/yuki-verify-evidence/picker.json`: the picker's search result count and its shortcode footer.
- `/tmp/yuki-verify-evidence/media.json`: picture tile rects, file rows, and the image dialog's open, step and close state.
- `/tmp/yuki-verify-evidence/rich-text.json`: which runs became anchors, which stayed prose, and the homograph flag.
- `/tmp/yuki-verify-evidence/sidebar.json` and `sidebar.png`: the rail, panel and tile/row geometry, the pinned grid's column count at two panel widths, and the before/after pairs for the row menu's `pin`, `mark as read` and `mark as unread` items.

Standards:

- Exercise the real user path. Proving the token layer means loading `http://localhost:<port>/` the way a user's browser does and reading what the page actually applied: not importing the stylesheet into a scratch script.
- Capture the action and the resulting state. A screenshot alone is not proof; the read is the assertion and the screenshot is context.
- Assertions live in the script's own output, not in comments: `console.log` the value you checked.
- A rule that must be *absent* (no borders, no animation, no uppercase body) is proven by reading every candidate element's computed style and logging the list that violates it. Logging a count of `0` over a selector that matched nothing proves nothing; log the match count next to the violation count.
- Write artifacts from inside the script, with Node's `fs`, so the file is produced by the same run that asserted it:

```bash
YUKI_PORT=3017
ego-browser nodejs <<EOF
const { writeFile } = await import("node:fs/promises");
const port = $YUKI_PORT;
const task = await taskSpace("yuki verify kat tokens");
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
await writeFile("/tmp/yuki-verify-evidence/kat-tokens.json", JSON.stringify(roles, null, 2));
await writeFile("/tmp/yuki-verify-evidence/font-load.json", JSON.stringify(font, null, 2));
const snapshot = await page.snapshot();
await writeFile("/tmp/yuki-verify-evidence/app-shell.snapshot.txt", snapshot);
await page.screenshot({ path: "/tmp/yuki-verify-evidence/app-shell.png" });
console.log({ taskSpaceId: task.spaceId, roles, font, errs });
await task.finish({ keep: [] });
if (Object.values(roles).some((v) => v === "")) process.exit(1);
EOF
```

## Cleanup

Tear down only what this run started. Read the recorded pid; never kill by process name, and never kill the process on 3001 that you did not launch.

```bash
for PIDFILE in /tmp/yuki-verify-evidence/vite.pid /tmp/yuki-verify-evidence/worker.pid; do
  [ -f "$PIDFILE" ] || continue
  PID=$(cat "$PIDFILE")
  kill "$PID" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$PID" 2>/dev/null
  rm -f "$PIDFILE"
done
```

Do not delete `/tmp/yuki-verify-evidence/`. Evidence outlives the run; the pid file does not. Confirm what survived:

```bash
ls -l /tmp/yuki-verify-evidence
```

## Helpers

This skill ships no helper scripts. Every command it contains is copy-pasteable as written, which is deliberate: the whole harness is `ego-browser nodejs`, and a wrapper would only hide the TaskSpace lifecycle and the pid bookkeeping that Cleanup depends on.

There is no second skill for this app. The former `verify-web-solid` skill was a near-duplicate that documented a roster sidebar the app does not have, and it was deleted; `features/` under this skill is the only map.