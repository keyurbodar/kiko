# Whirl theme tokens

A user who loads Kiko sees a dark page whose colors come from the Whirl palette, applied to the document before anything renders. Every Kiko slice styles against these tokens, so if the palette is missing or partial the whole app is wrong even when the markup is right.

## Sub-features

- `theme-palette-applied` paints the full Whirl palette onto the document as custom properties.
- `theme-id-marker` marks the document with the active theme id.
- `theme-dark-appearance` renders the app in dark mode by default.
- `theme-token-readable` exposes every token as a non-empty value, so a slice never binds to an undefined variable.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/` in a browser. There is no route, menu, or control that reaches this — it is what the user sees the instant the page loads, on every route, forever.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true`.
- Port 3001 is free, or you have substituted a free port everywhere, including the `goto` below.

- **Load the page.** Open Kiko the way a user does. Run `page.goto("http://127.0.0.1:3001/")`. The page title reads `Kiko` and `loc=css:#root` resolves to exactly one element.
- **Wait for the palette.** The tokens land before first paint of any UI, so wait on the condition rather than a delay. Run `page.waitForFunction(() => document.documentElement.style.getPropertyValue("--kiko-message-surface") !== "", undefined, { timeout: 15000 })`. It resolves, and the returned value is a hex color, not an empty string.
- **Confirm the theme id.** Read the marker. Run `page.evaluate(() => document.documentElement.dataset.themeId)`. The result is `"whirl"`, and `loc=css:html[data-theme-id="whirl"]` matches.
- **Confirm dark appearance.** Read the root class. Run `page.evaluate(() => document.documentElement.classList.contains("dark"))`. The result is `true`, and `loc=css:html.dark` matches.
- **Count the tokens.** Read the applied set. Run `page.evaluate(() => [...document.documentElement.style].filter((name) => name.startsWith("--kiko-")).length)`. The result is `57`.
- **Proof.** Capture both the values and the visual. Run `page.evaluate` over `document.documentElement.style` to build a `{ "--kiko-*": value }` object, write it to `/tmp/kiko-verify-evidence/theme-tokens.json`, then run `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The JSON has 57 keys with no empty value. The screenshot shows the dark canvas at `--kiko-canvas` (`#131313`) with no content on it — the page is genuinely empty, so there is no in-viewport branding to capture. App identity is proven by `page.title()`, not by the screenshot.

## Gotchas

- `main.tsx` throws when `#root` is missing, so a blank page with a console error means the mount point, not the theme, is broken.
- The token count is 57 today. If a slice adds a role to the palette, the count changes; report the new number, do not edit the assertion to match.
- The tokens are inline properties on `<html>`, not a stylesheet rule. `getComputedStyle` will also resolve Tailwind's own variables and inflate the count; read `documentElement.style` only.
- A palette is applied, not previewed. If you ever see `data-theme-id="__preview"`, a preview path ran instead of the real palette — that is a bug, not a variant.
- Do not import `@kiko/ui/app-theme` into a scratch script to prove this. The proof is the value on the live page, written by the app's own entry point.
