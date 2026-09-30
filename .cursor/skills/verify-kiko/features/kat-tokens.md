# Kat token layer

A user who loads Kiko gets a single dark page whose every colour, type step and corner radius comes from one stylesheet. Nothing paints a palette at runtime, there is no theme to switch, and no user action anywhere in the app changes a colour. If a role fails to resolve, the whole app is wrong even when the markup is right, so this is the first thing a verification run should prove.

## Sub-features

- `kat-roles-resolve` — every colour role resolves to a non-empty computed value on the live page, so no slice ever binds to an undefined variable.
- `kat-roles-derive` — the roles are composed from a split lightness/chroma scale, so one knob (`--hue` = 340, `--cm` = 1) rotates and saturates the whole warm family at once.
- `kat-tailwind-bridge` — each role is registered as a Tailwind colour, so a utility class in the DOM resolves to the same value the token holds.
- `kat-type-scale` — the 11/12/13/14px type ladder, a 1.45 line height and the sans/mono families all resolve, and the 14px base face lands on `body`.
- `kat-radius-roles` — `--radius-sm` (8px) and `--radius-bubble` (18px) resolve, with `--brm` available as the squircle scale factor.
- `kat-fonts-loaded` — the four self-hosted faces are actually loaded, not merely declared.
- `kat-dark-only` — the root carries `color-scheme: dark` and there is no light variant to find.
- `kat-no-borders` — the border roles are `none`, so a component that asks for a border draws nothing.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/`. There is no route, menu, or control that reaches this — it is what the user sees the instant the page loads, on every route, forever. The app has no router; a sub-path 404s and that is expected.
- Nothing else. There is no theme switcher to click, no light-mode toggle, and no preference that changes the page's colours. A user who goes looking for one is looking for a bug.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- Port 3001 is free, or you have substituted a free port everywhere, including the `goto` below.

- **Load the page.** Open Kiko the way a user does. Run `page.goto("http://127.0.0.1:3001/")` and then `page.title()`. The result is `Kiko`, and `loc=css:#root` resolves to exactly one element.

- **Wait for the token layer, not for a delay.** The stylesheet is applied by the entry point's CSS imports, so wait on the condition. Run `page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() !== "", undefined, { timeout: 15000 })`. It resolves once the role has a computed value.

- **Read the roles the way the app uses them.** Run one `page.evaluate` that loops the role list over `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`. The result is 20 non-empty strings, written to `/tmp/kiko-verify-evidence/kat-tokens.json`. The observed set on this branch:

  | Role | Resolves to |
  | --- | --- |
  | `--bg` | a dark oklch, the app canvas |
  | `--bg-subtle` | one step lighter than `--bg` |
  | `--surface-raised` | a raised fill, used by menus and cards |
  | `--menu-bg` | a raised fill for an open menu |
  | `--text` / `--text-muted` / `--text-faint` | the three text weights, cream to faint |
  | `--assistant-bubble` | the incoming bubble fill |
  | `--user-bubble` / `--user-bubble-text` | the viewer's own bubble fill and its warm text |
  | `--accent` / `--accent-fill` | the rose accent, as text colour and as fill |
  | `--danger` / `--success` | the semantic rose and green, each on its own hue |
  | `--font-base` | `14px` |
  | `--line-height` | `1.45` |
  | `--radius-bubble` | `18px` |
  | `--radius-sm` | `8px` |
  | `--content-max-w` | `768px` |
  | `--brm` | `0.5`, or `1` where the browser draws a continuous corner |
  | `--hue` | `340` |

  **Read them through `getComputedStyle`, never through `document.documentElement.style`.** These are stylesheet rules, not inline properties. An agent that reads the inline style object sees an empty list and concludes the palette is missing — that conclusion is always wrong on this branch.

- **Prove the Tailwind bridge, not just the variables.** A role that resolves but is never bridged still leaves components colourless. Run `page.evaluate(() => { const shell = document.querySelector(".app-shell"); const cs = getComputedStyle(shell); return { shellBg: cs.backgroundColor, role: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(), rootText: cs.color }; })`. `shellBg` is the same colour as the `--bg` role and `rootText` is the same as `--text`, so a utility class in the DOM resolves through to the token. A transparent `shellBg` means the bridge is broken even though every role reads back non-empty.

- **Prove the fonts loaded rather than declared.** Run `page.evaluate(() => ({ inter: document.fonts.check("14px InterVariable"), mono: document.fonts.check("14px 'Fantasque Sans Mono'"), faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status) }))`, then write it to `/tmp/kiko-verify-evidence/font-load.json`. `inter` and `mono` are both `true` and `faces` holds four entries whose `status` is `loaded`: `InterVariable` roman, `InterVariable` italic, and `Fantasque Sans Mono` at 400 and 700. An `@font-face` rule in the stylesheet proves nothing on its own — a `false` with the rule present is a real failure, and it is the reason the assertion is `document.fonts.check`, not a grep of the CSS.

- **Confirm the type scale landed on the body.** Run `page.evaluate(() => ({ bodyFontSize: getComputedStyle(document.body).fontSize, bodyLineHeight: getComputedStyle(document.body).lineHeight, bodyFamily: getComputedStyle(document.body).fontFamily, rootFontSize: getComputedStyle(document.documentElement).fontSize }))`. `bodyFontSize` is `14px`, `rootFontSize` is the browser default `16px`, and `bodyFamily` names `InterVariable`. A 14px root would rescale every `rem` and shrink Tailwind's spacing utilities to 0.875x, so a 16px root is the correct end state, not a missing declaration.

- **Confirm dark-only and that light mode is not hiding anywhere.** Run one `page.evaluate` that reads `getComputedStyle(document.documentElement).colorScheme` and counts stylesheet rules wrapped in a `prefers-color-scheme: light` condition, guarding each `cssRules` read in a `try` because a cross-origin sheet throws. `colorScheme` is `dark` and the light-rule count is `0`. Also read `document.documentElement.dataset.themeId ?? null` and `document.documentElement.dataset.theme ?? null`: both are `null`. A non-zero light-rule count or a theme dataset is drift to report, not a variant to document.

- **Confirm there is no switcher to find.** Run `page.evaluate(() => ({ themeSwitches: document.querySelectorAll("[data-theme-id], [data-kat-theme], [data-theme-switch], [role=switch]").length, htmlClass: document.documentElement.className }))`. `themeSwitches` is `0`. The root does carry `class="dark"`, which comes from `apps/web-solid/index.html` and does nothing on its own; the dark appearance is `color-scheme`, not the class.

- **Confirm the border roles are inert.** Run `page.evaluate(() => ["--border", "--border-dashed", "--border-heavy", "--border-heavy-dashed"].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]))`. All four read `none`, which is what makes the per-component no-border rule provable rather than aspirational. See [Chat bubbles](./chat-bubbles.md) for the per-element check.

- **Proof.** Write `/tmp/kiko-verify-evidence/kat-tokens.json` and `/tmp/kiko-verify-evidence/font-load.json` from the same run, then `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The screenshot shows the dark canvas with the transcript column on it. App identity is proven by `page.title()`, not by the screenshot.

## Gotchas

- **Inline properties are the wrong door.** `document.documentElement.style` is empty by design, so a token read that returns `""` there is not evidence of a missing palette. Use `getComputedStyle`. The deleted inline engines left behind three assertions that are now false and must never be reinstated: `kikoTokens === 57`, `dataset.themeId === "whirl"`, and a non-empty `--kiko-message-surface`. The current regression guard is the inverse — `inlineKikoVars` is `0` and `themeId` is `null`.
- **`--radius-*` come from a different block than the rest.** The two radius roles are declared in Tailwind's `@theme` block, which the compiler emits as a real `:root` rule. They resolve through `getComputedStyle` like everything else, but a slice cannot redeclare them in another `:root` without self-reference. Radius at a call site is either `rounded-bubble` / `rounded-sm` or the `calc(Npx * var(--brm))` idiom.
- **`--brm` is conditional.** It is `0.5` by default and `1` under `@supports (corner-shape: squircle)`, so the `calc(Npx * var(--brm))` idiom renders half a corner on a browser that cannot draw a continuous one. `chat.css` uses literals throughout; `interactions.css` still uses the idiom for the menu, so a menu corner reading half its expected value is correct there and a halved bubble is not. Assert each file's radii against the rule that file actually ships.
- **Roles whose colour is genuinely off-family carry their own hue.** `--text`, `--user-bubble-text`, `--accent`, `--accent-fill`, `--danger`, `--success` and `--gold` resolve through their own `--h-<role>` and are exempt from `--hue` and `--cm`. Rotating `--hue` will not move the cream text or the rose accent. Do not report that as a broken derivation.
- **`--border: none` means a border is silently invisible, not loudly absent.** A slice that asks for a border renders nothing and a screenshot looks fine. Assert the per-element `border-width` in the no-border recipe, not the token.
- **The v2 bridge is scoped to an attribute nothing sets.** The vendored component set resolves its own `--v2-*` roles, and the block that re-points them at the kat palette is scoped to `html[data-kat-theme]`. No file in the app sets that attribute today, so a v2 component renders its own default ramp rather than the kat palette. Report that as a real gap; do not assert that a v2 component is themed because the kat roles resolve.
- **The proof is the value on the live page.** Do not import `@kiko/ui/kat.css` into a scratch script, and do not read the stylesheet source as a substitute for the computed read. A role can be declared in the file and still fail to resolve.
- **A dev-server hot reload can land mid-run.** If the page reloads under you, re-`goto` and re-read rather than reading a stale value as evidence.
