---
name: verify-kiko
description: "Drive the Kiko web app (SolidJS + Vite) in a real browser to prove what a user sees, and capture evidence. Use for 'verify the app', 'prove this change in the browser', 'check the Kiko UI', or before claiming a web-solid slice works."
---

# Verify Kiko

Kiko is a SolidJS + Vite chat app at `apps/web-solid`. The only surface a user touches is a web UI, so verification means launching the Vite dev server and driving it with `ego-browser`, a Chromium driver available in this environment.

There is **no Playwright, no Puppeteer, and no Chrome.app** on this machine. `import { chromium } from "playwright"` fails. Use `ego-browser nodejs` as the harness, exactly as the Drive section shows.

Every check below is read-only except the launch itself. Never edit a source file to make a check pass.

Colour comes from one stylesheet, `packages/ui/src/styles/kat.css`, pulled in by `apps/web-solid/src/styles/app.css`. The app has **no theme switch and no light mode** — a run that goes looking for either is hunting a bug that is not there. It does have a **sidebar**: a rail-and-panel conversation column down the left edge of `/`, with its own feature file at [Sidebar](./features/sidebar.md).

## Launch

From the repo root:

```bash
KIKO_PORT=3001
mkdir -p /tmp/kiko-verify-evidence
cd apps/web-solid
nohup bunx vite --port "$KIKO_PORT" --strictPort > /tmp/kiko-verify-evidence/vite.log 2>&1 &
for _ in $(seq 1 30); do
  lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t 2>/dev/null > /tmp/kiko-verify-evidence/vite.pid && break
  sleep 0.5
done
```

`nohup` matters because the dev server otherwise dies with the shell that launched it. Capture the pid by asking the *port* who owns it, never with `echo $!` — a backgrounded `bunx` records a wrapper pid that is not the listener, and some non-interactive shells drop `$!` entirely. The loop retries until the listener exists, so the pid file is never left empty. `--strictPort` makes a busy port fail loudly instead of silently moving to 3002, which would leave Doctor asserting against someone else's server.

Confirm the recorded pid is really the listener before driving anything:

```bash
KIKO_PORT=3001
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: pid $PID is gone"; exit 1; }
lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t | grep -qx "$PID" && echo "pid $PID owns $KIKO_PORT" || echo "MISMATCH"
```

**Port 3001 is often already owned by a sibling Kiko checkout.** Check before launching:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

If that prints a row, pick a free port and use that value for `KIKO_PORT` in every later block. Do not kill the process holding 3001 — it belongs to another checkout. Find a free port with:

```bash
for p in 3017 3021 3044; do lsof -ti tcp:$p >/dev/null 2>&1 || echo "$p free"; done
```

Vite on this checkout needs roughly six seconds before the `Local:` line appears, so allow for that before concluding the launch failed.

Ready when both hold:

- `/tmp/kiko-verify-evidence/vite.log` contains a `Local:   http://localhost:<port>/` line.
- The root URL serves the app:

```bash
KIKO_PORT=3001
curl -sf "http://127.0.0.1:${KIKO_PORT}/" | grep -q '<div id="root">' && echo ready
```

## Doctor

One read-only sequence answering "is this instance worth driving?" — the process you started is alive, it and not a stray checkout owns the port, the port serves the app, the app mounted, and the kat token layer resolved.

```bash
KIKO_PORT=3001
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: vite pid $PID is not running"; exit 1; }
lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t | grep -qx "$PID" || { echo "FAIL: port $KIKO_PORT is not owned by pid $PID"; exit 1; }
curl -sf "http://127.0.0.1:$KIKO_PORT/" | grep -q '<div id="root">' || { echo "FAIL: port $KIKO_PORT does not serve the app"; exit 1; }
ego-browser nodejs <<EOF 2>&1 | tee /tmp/kiko-verify-evidence/doctor.txt
const port = $KIKO_PORT;
const ROLES = [
  "--bg", "--bg-subtle", "--surface-raised", "--menu-bg",
  "--text", "--text-muted", "--text-faint",
  "--assistant-bubble", "--user-bubble", "--user-bubble-text",
  "--accent", "--accent-fill", "--danger", "--success",
  "--font-base", "--line-height", "--radius-bubble", "--radius-sm",
  "--content-max-w", "--brm", "--hue",
];
const task = await taskSpace("kiko verify doctor");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/");
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
  bodyFontSize: getComputedStyle(document.body).fontSize,
  // The two deleted theme engines. Both must stay gone.
  inlineKikoVars: [...document.documentElement.style].filter((n) => n.startsWith("--kiko-")).length,
  themeId: document.documentElement.dataset.themeId ?? null,
}));
const font = await page.evaluate(() => ({
  inter: document.fonts.check("14px InterVariable"),
  mono: document.fonts.check("14px 'Fantasque Sans Mono'"),
  faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status),
}));
const harness = await page.fetch("/src/chat/harness.html");
const empty = Object.entries(roles).filter(([, v]) => v === "");
const ok =
  empty.length === 0 &&
  page1.rootChildren > 0 &&
  page1.shell === 1 &&
  page1.colorScheme === "dark" &&
  page1.inlineKikoVars === 0 &&
  page1.themeId === null;
console.log(JSON.stringify({ port, roles, ...page1, font, harnessStatus: harness.status, emptyRoles: empty, ok }));
await task.finish({ keep: [] });
if (!ok) process.exit(1);
EOF
```

`ego-browser` writes its result to **stderr**, not stdout. The `2>&1` before the pipe is what makes `doctor.txt` non-empty; without it `tee` captures nothing and leaves a zero-byte file that looks like a pass.

The heredoc delimiter is unquoted so the shell substitutes `$KIKO_PORT` into the script. `ego-browser nodejs` does **not** inherit the parent environment: `process.env.KIKO_PORT` is `null` inside the script, and a `page.goto` built from it fails with `Cannot navigate to invalid URL`. Read that error as a port that never reached the script, not as a bad URL. For the same reason keep backticks and `${}` out of these scripts so the shell does not eat them.
| Probe | Argument | What it does |
| --- | --- | --- |
| `setState(slug)` | one of the fixture slugs below | Loads that fixture state and re-renders the transcript |
| `setTyping(names)` | array of names, `[]` to clear | Puts those senders into the typing state, or clears it |
| `openMenu(messageId)` | a message id | Right-clicks that message for real, opening the same menu a user gets |
| `openPicker(messageId)` | a message id | Opens the emoji picker anchored to that message |
| `setReplyTarget(messageId)` | a message id | Arms a reply so the next send quotes that message |
| `probe()` | none | Returns `{ state, rows, bubbles, dateChip, dayLabels, unreadRule, runs, typing, overlay, replyTarget, tokens }` |
| `states()` | none | The fixture slugs the harness accepts, as shipped |
| `now()` | none | The harness's notion of now, for the day-chip and unread rules |
| `state()` | none | The current fixture slug |
| `messages` | — | The current state's message array |
| `threadState` | — | The last `{ scrollOffset, scrollSize, viewportSize, rangeStart, rangeEnd }` the transcript reported |
| `viewerId` | — | The id the composer speaks for, so a probe can tell own rows from the agent's |

`probe()` is the intended way to assert counts without depending on a class name the map and the component might spell differently. `rows` is the number of `[data-component="chat-vrow"]` elements **in the DOM**, which is the viewport and not the message total; `bubbles` is the number carrying `data-message-id`; `dateChip` is the chip's label or `null`; `dayLabels` is every divider label, so a multi-day state is one read; `unreadRule` is `[data-component="chat-unread-rule"]` being present; `runs` counts `data-run="start"`; `typing` is `.chat-typing-row` being present; `overlay` is which overlay the harness last asked to open; `replyTarget` is the armed reply id or `null`; `tokens` holds the resolved `--user-bubble`, `--assistant-bubble`, `--font-base` and `--radius-bubble` values. Read the DOM for anything geometric.

`setState`, `setTyping` and `setReplyTarget` return the value they resolved to, so a caller can assert the result in the same round. `openMenu` and `openPicker` return a boolean saying whether a dialog actually opened — read it, because a stale overlay left on screen makes a no-op look like an open menu.

**The harness has never been run in a real browser.** It is verified by typecheck and by unit tests over `FIXTURE_STATES`; no live render of any state has been confirmed. Treat "every state renders without a runtime error" as unproven and treat the first successful load as the proof. `openMenu` and `openPicker` are the sharpest case: they dispatch real events and then report whether a portalled dialog appeared, so their return value is an **observation, not a guarantee**. A `false` is a finding to report, never an assertion to satisfy by retrying.

The harness also takes the state in the URL, which is the cheaper way to start a round: `http://127.0.0.1:<port>/src/chat/harness.html?state=unread`. An unknown or missing slug falls back to `today`, so a typo silently proves the wrong state — read `probe().state` and `probe().dateChip` before measuring. `?typing=ada,grace` starts a round with those senders already typing, which saves a probe when the typing row is the only thing under test.

`bodyFontSize` reads `14px`. The 14px face is on `body`, not `:root` — the root stays at the browser default so Tailwind's rem spacing utilities are not rescaled.

- `harnessStatus` is `200`. The chat harness is the entry point for every feature recipe; without it the composed app still boots but the transcript fixtures are unreachable. A non-200 here means the chat slice is not on disk, so the chat recipes are pending, not failing.

## Drive

`ego-browser nodejs` runs your script in Node.js. Page globals such as `window` and `document` do not exist there; browser-side code goes inside `page.evaluate()`. One TaskSpace per goal — print its `spaceId` and reuse it in later rounds. Every invocation is a fresh Node process, so the space id must be carried forward by hand. Use an unquoted heredoc for the same reason as in Doctor, and keep backticks and `${}` out of these scripts so the shell does not expand them.

`page.evaluate(fn, arg)` takes one JSON-serializable argument. Pass one object, not a second positional value.

### Two entry points

- **Composed app** — `http://127.0.0.1:<port>/`. What a user gets, and the only entry point with no router behind it.
- **Chat harness** — `http://127.0.0.1:<port>/src/chat/harness.html`. The chat slice's own page, with every fixture state addressable and probes on `window.__chat`.

```bash
KIKO_PORT=3001
ego-browser nodejs <<EOF
const port = $KIKO_PORT;
const task = await taskSpace("kiko chat");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/src/chat/harness.html");
await page.waitForFunction(() => typeof window.__chat === "object", undefined, { timeout: 15_000 });
const probe = await page.evaluate(() => window.__chat.probe());
console.log({ taskSpaceId: task.spaceId, page: page.label, probe });
console.log(await page.snapshot());
await task.finish({ keep: [] });
EOF
```

### `window.__chat` probes

Every setter drives the same reactive path a user action takes. None is a test-only branch.

| Probe | Argument | What it does |
| --- | --- | --- |
| `setState(slug)` | one of the fixture slugs below | Loads that fixture state and re-renders the transcript |
| `setTyping(names)` | array of names, `[]` to clear | Puts those senders into the typing state, or clears it |
| `openMenu(messageId)` | a message id | Right-clicks that message for real, opening the same menu a user gets |
| `openPicker(messageId)` | a message id | Opens the emoji picker anchored to that message |
| `setReplyTarget(messageId)` | a message id | Arms a reply so the next send quotes that message |
| `probe()` | none | Returns row count, the visible date-chip label, unread-rule presence, run count, and the resolved `--user-bubble`, `--assistant-bubble`, `--font-base` and `--radius-bubble` values |

Fixture slugs accepted by `setState`, in the order they are worth visiting:

| Slug | State |
| --- | --- |
| `grouped` | a collapsed run of consecutive messages from one sender |
| `run-gap` | a run broken by a long quiet stretch |
| `run-break-reply` | a run broken because the next message replies to something else |
| `long` | a long multi-paragraph body |
| `jumbo-single` | one jumbo-sized pure-emoji body |
| `jumbo-group` | a run of jumbo emoji |
| `jumbo-prose` | a jumbo run that also contains prose |
| `link` | a bare URL, rendered as a link only |
| `link-card` | a URL that earns a link card |
| `reply-text` | a reply to a text message |
| `reply-image` | a reply to an image message, so the quote carries a thumbnail |
| `reactions` | messages carrying reaction badges |
| `edited` | a message marked as edited |
| `pinned` | a pinned message |
| `three-days-ago` / `yesterday` / `today` | the day boundaries, for the date chip |
| `unread` | an unread division with a rule before the first unread incoming message |

The slugs come from `FIXTURE_STATES` in `apps/web-solid/src/lib/fixtures.ts`. A slug that `setState` rejects is a fixture gap to report, not a typo to work around by picking another state.

Selectors you can rely on:

- `loc=css:#root` — the mount point from `apps/web-solid/index.html`.
- `loc=css:.sidebar-shell` — the full-height flex row the app composes, and the class every rule in `apps/web-solid/src/sidebar/sidebar.css` is scoped under. Its children are the sidebar and the chat pane. It is **not** `.chat-shell`.
- `loc=css:html` — carries `class="dark"` and `color-scheme: dark` from `index.html` and the kat base layer.
- `loc=css:[data-component="chat-shell"]` — the composed app's chat pane, the shrinkable flex child of `.sidebar-shell` that sits beside the sidebar. It holds the transcript and the composer dock.
- `loc=css:[data-component="chat-surface"]` — the transcript root, which owns the scroller and the column.
- `loc=css:[data-component="chat-scroll"]` — the scroller, `.chat-scroller`. `window.scrollTo` moves nothing; write `scrollTop` on this element.
- `loc=css:.chat-stage` — the positioned sibling of the scroller that hosts the jump pill and the scroll fades, so those do not scroll away.
- `loc=css:.chat-column` — the centred 768px content column, also `[data-virtual-column]`.
- `loc=css:[data-component="chat-vrow"]` — one virtualized row.
- `loc=css:.chat-row` — one message row, also `[data-component="chat-row"]`, carrying `data-message-id`, `data-side`, `data-run` and `data-gap`.
- `loc=css:.chat-bubble` — the message bubble inside a row, always paired with `--user` or `--bot`.
- `loc=css:.chat-divider` — a day-divider row, with `.chat-divider__label` and `.chat-divider__time`.
- `loc=css:[data-component="chat-date-chip"]` — the floating day chip's anchor, with `.chat-chip` as the trigger.
- `loc=css:[data-component="chat-unread-rule"]` — the new-messages rule.
- `loc=css:[data-component="chat-image-trigger"]` — the `<button>` wrapping a message image, carrying `aria-label="Open image: <alt>"`. Its child `<img>` is `[data-slot="chat-image"]`; clicking the button opens the `.lightbox` viewer.
- `loc=css:[data-component="sidebar"]` — the `<aside>` conversation panel, carrying `data-panel`, `data-collapsed` and `data-resizing`.
- `loc=css:[data-component="sidebar-rail-tab"]` — one rail button, carrying `data-panel` (one of `chats`, `terminal`, `code`, `browser`, `settings`) and `data-active`.
- `loc=css:[data-component="sidebar-row"]` — one conversation row, carrying `data-chat-id`, `data-active` and `data-unread`.
- `loc=css:[data-component="sidebar-pin-tile"]` — one pinned tile, carrying the same three attributes.
- `loc=css:[data-component="sidebar-unread-count"]` — the unread number in a row's trailing column.
- `loc=css:[data-component="sidebar-resize"]` — the 3px resize handle, `role="separator"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. It stays mounted while the panel is collapsed, which is what makes the collapse reversible.
- `loc=css:[data-component="sidebar-add"]` — the `+` in the panel header; its menu carries exactly one item, `toggle sidebar`.
- `loc=css:[data-component="sidebar-chats"]` — the chats panel body.
- `loc=css:[data-component="sidebar-panel-empty"]` — the "not built" line shown for the rail panels this app has no content for.
- `loc=css:[data-component="hover-card-v2-content"]` — the hover preview card the rows and the pinned tiles open.
- `loc=css:[data-component="menu-v2-content"]` — **the** handle for a Kobalte menu's content element. `MenuV2.Context.Content` overwrites any `data-component` passed to it with its own, so a menu handle supplied as a prop never reaches the DOM; select the menu by this attribute and read its `[data-component="menu-v2-item"]` children.

**Prefer the `data-component` attribute over the class.** Two stylesheets once both defined a bare `.chat-shell` for different elements — the app's pane and the transcript's scroller — with conflicting `overflow` and layout. The pane is now `[data-component="chat-shell"]` inside `.sidebar-shell` and the scroller is `.chat-scroller`, and the attribute is the handle that stays stable across that rename.

Selectors to avoid: any top bar, theme switcher, or router query. None exists. A `data-theme-id`, a `data-theme`, a `--kiko-*` variable, a `data-continuation` attribute and a `chat-actionbar` are all things this app no longer renders. A `data-component` handed to `MenuV2.Content` as a prop is likewise not a handle — see the `menu-v2-content` bullet above.

The transcript is virtualized with `virtua`, so the DOM holds only the visible rows. `document.querySelectorAll("[data-component=chat-vrow]").length` tracks the viewport, not the message count, and an element captured before a scroll can be detached by the time you act on it. Re-query immediately before every action.

## Evidence

Proof artifacts go under `/tmp/kiko-verify-evidence/`, which survives cleanup. The paths this skill and the feature map write:

- `/tmp/kiko-verify-evidence/vite.log` — the dev server log for the run.
- `/tmp/kiko-verify-evidence/vite.pid` — the listener pid, deleted by Cleanup.
- `/tmp/kiko-verify-evidence/doctor.txt` — the Doctor JSON line.
- `/tmp/kiko-verify-evidence/kat-tokens.json` — every role read off `getComputedStyle`, with its resolved value.
- `/tmp/kiko-verify-evidence/font-load.json` — the loaded `FontFace` set and the `document.fonts.check` results.
- `/tmp/kiko-verify-evidence/app-shell.snapshot.txt` and `app-shell.png` — the mounted page.
- `/tmp/kiko-verify-evidence/chat-bubbles.json` and `chat-bubbles.png` — column width, bubble widths, run facts, tail-corner corner radii, and the jumbo scale.
- `/tmp/kiko-verify-evidence/day-chip.json` — the date-chip label per fixture day state.
- `/tmp/kiko-verify-evidence/lowercase-chrome.json` — computed `text-transform` for chrome labels and message bodies.
- `/tmp/kiko-verify-evidence/no-border.json` — computed `border-width` across every bubble, chip, menu and card.
- `/tmp/kiko-verify-evidence/no-animation.json` — computed `transition-duration` across those same elements, with the three permitted exceptions named.
- `/tmp/kiko-verify-evidence/chat-menu.json` — the right-click menu's item list for a viewer's message and for an agent's.
- `/tmp/kiko-verify-evidence/reply-jump.json` — quote line count, quote height, and the scroll delta after the jump.
- `/tmp/kiko-verify-evidence/unread-rule.json` — the unread rule's index among rows, before and after sending.
- `/tmp/kiko-verify-evidence/reactions.json` — badge geometry and the toggle result.
- `/tmp/kiko-verify-evidence/typing.json` — the typing bubble's dot count and the `aria-live` label.
- `/tmp/kiko-verify-evidence/picker.json` — the picker's search result count and its shortcode footer.
- `/tmp/kiko-verify-evidence/sidebar.json` and `sidebar.png` — the rail, panel and tile/row geometry, the pinned grid's column count at two panel widths, and the before/after pairs for the row menu's `pin`, `mark as read` and `mark as unread` items.

Standards:

- Exercise the real user path. Proving the token layer means loading `http://127.0.0.1:<port>/` the way a user's browser does and reading what the page actually applied — not importing the stylesheet into a scratch script.
- Capture the action and the resulting state. A screenshot alone is not proof; the read is the assertion and the screenshot is context.
- Assertions live in the script's own output, not in comments: `console.log` the value you checked.
- A rule that must be *absent* — no borders, no animation, no uppercase body — is proven by reading every candidate element's computed style and logging the list that violates it. Logging a count of `0` over a selector that matched nothing proves nothing; log the match count next to the violation count.
- Write artifacts from inside the script, with Node's `fs`, so the file is produced by the same run that asserted it:

```bash
KIKO_PORT=3001
ego-browser nodejs <<EOF
const { writeFile } = await import("node:fs/promises");
const port = $KIKO_PORT;
const task = await taskSpace("kiko verify kat tokens");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/");
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
await writeFile("/tmp/kiko-verify-evidence/kat-tokens.json", JSON.stringify(roles, null, 2));
await writeFile("/tmp/kiko-verify-evidence/font-load.json", JSON.stringify(font, null, 2));
const snapshot = await page.snapshot();
await writeFile("/tmp/kiko-verify-evidence/app-shell.snapshot.txt", snapshot);
await page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" });
console.log({ taskSpaceId: task.spaceId, roles, font });
await task.finish({ keep: [] });
if (Object.values(roles).some((v) => v === "")) process.exit(1);
EOF
```

## Cleanup

Tear down only what this run started. Read the recorded pid; never kill by process name, and never kill the process on 3001 that you did not launch.

```bash
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill "$PID" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
kill -9 "$PID" 2>/dev/null
rm -f /tmp/kiko-verify-evidence/vite.pid
```

Do not delete `/tmp/kiko-verify-evidence/`. Evidence outlives the run; the pid file does not. Confirm what survived:

```bash
ls -l /tmp/kiko-verify-evidence
```

## Helpers

This skill ships no helper scripts. Every command it contains is copy-pasteable as written, which is deliberate: the whole harness is `ego-browser nodejs`, and a wrapper would only hide the TaskSpace lifecycle and the pid bookkeeping that Cleanup depends on.

There is no second skill for this app. The former `verify-web-solid` skill was a near-duplicate that documented a roster sidebar the app does not have, and it was deleted; `features/` under this skill is the only map.
