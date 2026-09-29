---
name: verify-kiko
description: "Drive the Kiko web app (SolidJS + Vite) in a real browser to prove what a user sees, and capture evidence. Use for 'verify the app', 'prove this change in the browser', 'check the Kiko UI', or before claiming a web-solid slice works."
---

# Verify Kiko

Kiko is a SolidJS + Vite chat app at `apps/web-solid`. The only surface a user touches is a web UI, so verification means launching the Vite dev server and driving it with `ego-browser`, a Chromium driver available in this environment.

There is **no Playwright, no Puppeteer, and no Chrome.app** on this machine. `import { chromium } from "playwright"` fails. Use `ego-browser nodejs` as the harness, exactly as the Drive section shows.

Every check below is read-only except the launch itself. Never edit a source file to make a check pass.

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

One read-only sequence answering "is this instance worth driving?" — the process you started is alive, it and not a stray checkout owns the port, the port serves the app, and the two theme facts hold in a real browser.
```bash
KIKO_PORT=3001
PID=$(cat /tmp/kiko-verify-evidence/vite.pid)
kill -0 "$PID" || { echo "FAIL: vite pid $PID is not running"; exit 1; }
lsof -nP -iTCP:"$KIKO_PORT" -sTCP:LISTEN -t | grep -qx "$PID" || { echo "FAIL: port $KIKO_PORT is not owned by pid $PID"; exit 1; }
curl -sf "http://127.0.0.1:$KIKO_PORT/" | grep -q '<div id="root">' || { echo "FAIL: port $KIKO_PORT does not serve the app"; exit 1; }
ego-browser nodejs <<EOF 2>&1 | tee /tmp/kiko-verify-evidence/doctor.txt
const port = $KIKO_PORT;
const task = await taskSpace("kiko verify doctor");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/");
const fact = await page.evaluate(() => ({
  messageSurface: document.documentElement.style.getPropertyValue("--kiko-message-surface"),
  themeId: document.documentElement.dataset.themeId ?? null,
}));
const kikoTokens = await page.evaluate(() =>
  [...document.documentElement.style].filter((name) => name.startsWith("--kiko-")).length);
const ok = fact.messageSurface !== "" && fact.themeId === "whirl";
console.log(JSON.stringify({ port, ...fact, kikoTokens, ok }));
await task.finish({ keep: [] });
if (!ok) process.exit(1);
EOF
```

`ego-browser` writes its result to **stderr**, not stdout. The `2>&1` before the pipe is what makes `doctor.txt` non-empty; without it `tee` captures nothing and leaves a zero-byte file that looks like a pass.

The heredoc delimiter is unquoted so the shell substitutes `$KIKO_PORT` into the script. `ego-browser nodejs` does **not** inherit the parent environment: `process.env.KIKO_PORT` is `null` inside the script, and a `page.goto` built from it fails with `Cannot navigate to invalid URL`. Read that error as a port that never reached the script, not as a bad URL.

Read the trailing `ok` field. `ok: true` means both theme assertions passed: `--kiko-message-surface` is non-empty and `document.documentElement.dataset.themeId` is `"whirl"`. `kikoTokens` should be `57` — the Whirl palette is written as inline custom properties on `<html>` by `applyThemePalette(WHIRL_THEME)` in `apps/web-solid/src/main.tsx`. Treat a different count as drift to report, not a reason to change the assertion.

## Drive

`ego-browser nodejs` runs your script in Node.js. Page globals such as `window` and `document` do not exist there; browser-side code goes inside `page.evaluate()`. One TaskSpace per goal — print its `spaceId` and reuse it in later rounds. Every invocation is a fresh Node process, so the space id must be carried forward by hand. Use an unquoted heredoc for the same reason as in Doctor, and keep backticks and `${}` out of these scripts so the shell does not expand them.

```bash
KIKO_PORT=3001
ego-browser nodejs <<EOF
const port = $KIKO_PORT;
const task = await taskSpace("kiko verify theme tokens");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/");
await page.waitForFunction(
  () => document.documentElement.style.getPropertyValue("--kiko-message-surface") !== "",
  undefined,
  { timeout: 15_000 },
);
const tokens = await page.evaluate(() => {
  const style = document.documentElement.style;
  const out = {};
  for (const name of style) if (name.startsWith("--kiko-")) out[name] = style.getPropertyValue(name);
  return out;
});
console.log({ taskSpaceId: task.spaceId, page: page.label, tokenCount: Object.keys(tokens).length });
console.log(await page.snapshot());
await task.finish({ keep: [] });
EOF
```

Selectors you can rely on today:

- `loc=css:#root` — the mount point from `apps/web-solid/index.html`.
- `loc=css:html[data-theme-id="whirl"]` — the app-theme palette applied. `applyThemePalette` writes `root.dataset.themeId`. Do not confuse it with `html[data-theme]`, which is a *different* key written by the opencode `ThemeProvider` in `packages/ui/src/theme/context.tsx`; both exist at once and neither implies the other.
- `loc=css:html.dark` — `WHIRL_THEME.appearance` is `"dark"`, so the root carries the `dark` class.
- `loc=css:[data-kiko-*]` — any `data-` handle a later slice adds to a chat run.

Selectors to avoid: there is no chat surface yet, so any `text=`, ARIA role, or conversation selector will not match. That is a known gap, recorded in `features/README.md`.

The page is currently near-empty: `main.tsx` renders `<ThemeProvider><div /></ThemeProvider>`. A snapshot is short and shows an empty root under a themed page. That is the correct end state for this PR — a snapshot containing message text means something rendered that this PR should not have added.

## Evidence

Proof artifacts go under `/tmp/kiko-verify-evidence/`, which survives cleanup. The paths this skill names:

- `/tmp/kiko-verify-evidence/doctor.txt` — the Doctor JSON line.
- `/tmp/kiko-verify-evidence/vite.log` — the dev server log for the run.
- `/tmp/kiko-verify-evidence/theme-tokens.json` — every `--kiko-*` property read off `<html>`.
- `/tmp/kiko-verify-evidence/app-shell.snapshot.txt` — the ARIA snapshot of the mounted app.
- `/tmp/kiko-verify-evidence/app-shell.png` — a screenshot with the themed page visible.

Standards:

- Exercise the real user path. Proving the theme layer means loading `http://127.0.0.1:<port>/` the way a user's browser does and reading what the page actually applied — not importing the palette module into a scratch script.
- Capture the action and the resulting state. A screenshot alone is not proof; the token read is the assertion and the screenshot is context.
- Assertions live in the script's own output, not in comments: `console.log` the value you checked.
- Write artifacts from inside the script, with Node's `fs`, so the file is produced by the same run that asserted it:

```bash
KIKO_PORT=3001
ego-browser nodejs <<EOF
const { writeFile } = await import("node:fs/promises");
const port = $KIKO_PORT;
const task = await taskSpace("kiko verify theme tokens");
const page = task.page("p1");
await page.goto("http://127.0.0.1:" + port + "/");
const tokens = await page.evaluate(() => {
  const style = document.documentElement.style;
  const out = {};
  for (const name of style) if (name.startsWith("--kiko-")) out[name] = style.getPropertyValue(name);
  return out;
});
const empty = Object.entries(tokens).filter(([, value]) => value === "");
await writeFile("/tmp/kiko-verify-evidence/theme-tokens.json", JSON.stringify(tokens, null, 2));
const snapshot = await page.snapshot();
await writeFile("/tmp/kiko-verify-evidence/app-shell.snapshot.txt", snapshot);
await page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" });
console.log({ taskSpaceId: task.spaceId, tokenCount: Object.keys(tokens).length, emptyTokens: empty });
await task.finish({ keep: [] });
if (Object.keys(tokens).length === 0 || empty.length > 0) process.exit(1);
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
