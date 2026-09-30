# Kat token layer

A user who loads Kiko gets a single dark page whose every colour, type step and corner radius comes from one stylesheet. Nothing paints a palette at runtime, there is no theme to switch, and no user action anywhere in the app changes a colour. If a role fails to resolve, the whole app is wrong even when the markup is right, so this is the first thing a verification run should prove.

## Sub-features

- `kat-roles-resolve` — every colour role resolves to a non-empty computed value on the live page, so no slice ever binds to an undefined variable.
- `kat-roles-derive` — the roles are composed from a split lightness/chroma scale, so one knob (`--hue` = 6, `--cm` = 1) rotates and saturates the whole warm family at once.
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
  | `--text` / `--text-muted` / `--text-faint` | the three text weights, a warm off-white stepping down to faint |
  | `--assistant-bubble` | the incoming bubble fill, one step off the canvas |
  | `--user-bubble` / `--user-bubble-text` | the viewer's own bubble: a dark dusty rose, with pale text |
  | `--accent` / `--accent-fill` | the peach-rose accent, as text colour and as fill |
  | `--danger` / `--success` | the semantic rose and green, each on its own hue |
  | `--font-base` | `14px` |
  | `--line-height` | `1.45` |
  | `--radius-bubble` | `18px` |
  | `--radius-sm` | `8px` |
  | `--content-max-w` | `768px` |
  | `--brm` | `0.5`, or `1` where the browser draws a continuous corner |
  | `--hue` | `6` |

  **Read them through `getComputedStyle`, never through `document.documentElement.style`.** These are stylesheet rules, not inline properties. An agent that reads the inline style object sees an empty list and concludes the palette is missing — that conclusion is always wrong on this branch.

- **Prove the Tailwind bridge, not just the variables.** A role that resolves but is never bridged still leaves components colourless. Run `page.evaluate(() => { const shell = document.querySelector(".sidebar-shell"); const cs = getComputedStyle(shell); return { shellBg: cs.backgroundColor, role: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(), rootText: cs.color }; })`. `shellBg` is the same colour as the `--bg` role and `rootText` is the same as `--text`, so a utility class in the shell's class list is genuinely reaching the ramp. **The shell is `.sidebar-shell`** — it is the flex row `main.tsx` composes and the scope class for the sidebar's stylesheet. `.app-shell` no longer exists and returns `null`, which makes this read throw before it can report anything.

- **Prove the fonts loaded rather than declared.** Run `page.evaluate(() => ({ inter: document.fonts.check("14px InterVariable"), mono: document.fonts.check("14px 'Fantasque Sans Mono'"), faces: [...document.fonts].map((f) => f.family + "|" + f.style + "|" + f.weight + "|" + f.status) }))`, then write it to `/tmp/kiko-verify-evidence/font-load.json`. `inter` and `mono` are both `true` and `faces` holds four entries whose `status` is `loaded`: `InterVariable` roman, `InterVariable` italic, and `Fantasque Sans Mono` at 400 and 700. An `@font-face` rule in the stylesheet proves nothing on its own — a `false` with the rule present is a real failure, and it is the reason the assertion is `document.fonts.check`, not a grep of the CSS.

- **Confirm the type scale landed on the body.** Run `page.evaluate(() => ({ bodyFontSize: getComputedStyle(document.body).fontSize, bodyLineHeight: getComputedStyle(document.body).lineHeight, bodyFamily: getComputedStyle(document.body).fontFamily, rootFontSize: getComputedStyle(document.documentElement).fontSize }))`. `bodyFontSize` is `14px`, `rootFontSize` is the browser default `16px`, and `bodyFamily` names `InterVariable`. A 14px root would rescale every `rem` and shrink Tailwind's spacing utilities to 0.875x, so a 16px root is the correct end state, not a missing declaration.

- **Confirm dark-only and that light mode is not hiding anywhere.** Run one `page.evaluate` that reads `getComputedStyle(document.documentElement).colorScheme` and counts stylesheet rules wrapped in a `prefers-color-scheme: light` condition, guarding each `cssRules` read in a `try` because a cross-origin sheet throws. `colorScheme` is `dark` and the light-rule count is `0`. Also read `document.documentElement.dataset.themeId ?? null` and `document.documentElement.dataset.theme ?? null`: both are `null`. A non-zero light-rule count or a theme dataset is drift to report, not a variant to document.

- **Confirm there is no switcher to find.** Run `page.evaluate(() => ({ themeSwitches: document.querySelectorAll("[data-theme-id], [data-kat-theme], [data-theme-switch], [role=switch]").length, htmlClass: document.documentElement.className }))`. `themeSwitches` is `0`. The root does carry `class="dark"`, which comes from `apps/web-solid/index.html` and does nothing on its own; the dark appearance is `color-scheme`, not the class.

- **Confirm the border roles are inert.** Run `page.evaluate(() => ["--border", "--border-dashed", "--border-heavy", "--border-heavy-dashed"].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]))`. All four read `none`, which is what makes the per-component no-border rule provable rather than aspirational. See [Chat bubbles](./chat-bubbles.md) for the per-element check.

- **Proof.** Write `/tmp/kiko-verify-evidence/kat-tokens.json` and `/tmp/kiko-verify-evidence/font-load.json` from the same run, then `page.screenshot({ path: "/tmp/kiko-verify-evidence/app-shell.png" })`. The screenshot shows the dark canvas with the transcript column on it. App identity is proven by `page.title()`, not by the screenshot.

## Gotchas

- **Inline properties are the wrong door.** `document.documentElement.style` is empty by design, so a token read that returns `""` there is not evidence of a missing palette. Use `getComputedStyle`. The deleted inline engines left behind three assertions that are now false and must never be reinstated: `kikoTokens === 57`, `dataset.themeId === "whirl"`, and a non-empty `--kiko-message-surface`. The current regression guard is the inverse — `inlineKikoVars` is `0` and `themeId` is `null`.
- **`--radius-*` come from a different block than the rest.** The two radius roles are declared in Tailwind's `@theme` block, which the compiler emits as a real `:root` rule. They resolve through `getComputedStyle` like everything else, but a slice cannot redeclare them in another `:root` without self-reference. Radius at a call site is either `rounded-bubble` / `rounded-sm` or the `calc(Npx * var(--brm))` idiom.
- **`--brm` is conditional.** It is `0.5` by default and `1` under `@supports (corner-shape: squircle)`, so the `calc(Npx * var(--brm))` idiom renders half a corner on a browser that cannot draw a continuous one. The menu, the picker and the typing bubble use the idiom, so a menu corner reading half its expected value is correct there and a halved bubble is not. Assert each component's radius against the utility that component actually ships.
- **Roles whose colour is genuinely off-family carry their own hue.** `--accent`, `--accent-fill`, `--user-bubble`, `--user-bubble-text`, `--danger`, `--success` and `--gold` resolve through their own `--h-<role>` and are exempt from `--hue` and `--cm`. The canvas, the surfaces, the agent bubble and the three text weights all sit on `--hue`, so rotating it moves those and leaves the accent and the viewer's bubble where they are. Do not report that split as a broken derivation.
- **`--border: none` means a border is silently invisible, not loudly absent.** A slice that asks for a border renders nothing and a screenshot looks fine. Assert the per-element `border-width` in the no-border recipe, not the token.
- **An unlayered rule outranks every `@layer`, and margin was the casualty for real.** Section 7 of `packages/ui/src/styles/kat.css` used to be a bare `*, ::before, ::after { box-sizing: border-box }` plus `* { margin: 0 }` and `dialog { margin: auto }`, sitting *outside* any layer. Cascade layers beat unlayered rules only by being later in the declared order — an unlayered rule outranks every `@layer` regardless of specificity, so that reset silently beat Tailwind's `@layer utilities` and **every margin utility in the app was dead**. `mx-auto` computed to `0px`, and the 768px transcript column sat pinned to the left edge of the surface instead of centred, with every width and radius reading correctly. It is now wrapped in `@layer base`, in the same layer as the Tailwind preflight, which is what puts a utility in front of it. Padding was never affected, because the preflight that zeroes padding is already in `base`.
- **Assert that a margin utility resolves, and never author an unlayered rule.** Nothing about the failure is visible in the token read: every role still resolves, every width is still right, and `getPropertyValue("--content-max-w")` still says `768px`. The only proof is the computed margin. Confirmed live after the fix: the transcript column is 768px wide at `left: 326` in a 1420px viewport — exactly `(1420 - 768) / 2` — and a throwaway `<div class="mx-auto" style="width:200px">` appended to `body` computes `margin-left: 610px`. The rule for anyone editing these stylesheets: **every rule goes in a layer.** A reset belongs in `@layer base`; anything bare outranks utilities silently and the break is invisible until a layout is visibly wrong.
- **The v2 bridge is `:root`-scoped, so the `--v2-*` roles resolve to the kat palette.** Section 6 of `packages/ui/src/styles/kat.css` re-points the vendored component set's `--v2-*` roles at the kat roles under `:root`, not under `html[data-kat-theme]`, so a v2 component *is* themed here. Confirmed live: the chat message menu computes the kat `--menu-bg` fill, `oklch(0.273 0.005 6)`, rather than the v2 default `rgb(250,250,250)`. **Keep the bridge scoped to `:root`, or to an ancestor that always exists** — nothing in the app sets `data-kat-theme`, so re-scoping it back to that attribute would silently re-open the gap without failing any build.
- **The proof is the value on the live page.** Do not import `@kiko/ui/kat.css` into a scratch script, and do not read the stylesheet source as a substitute for the computed read. A role can be declared in the file and still fail to resolve.
- **A dev-server hot reload can land mid-run.** If the page reloads under you, re-`goto` and re-read rather than reading a stale value as evidence.
