> Current implementation and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposals below are historical and do not override it.

# Phases

How to build this in parallel without two people editing the same file.

Everything here assumes `main` at `6167d2b1` and the PR at `ebd856c1`. Each lane is one branch, one PR, one person or agent. A **wave** is a merge gate: everything in it can run at the same time, and the next wave starts when the wave is merged.

Read `README.md` for the audit and `PLAN.md` for the per-step detail. This file only adds ordering, ownership and the contracts lanes must share.

---

## The short version

```
Wave 0  (serial, ~half a day)
  └─ 0. Harness: screenshot script + token baseline

Wave 1  (serial, ~1 day, blocks everything)
  └─ 1. Tokens rename

Wave 2  (three lanes, parallel)
  ├─ 2A. Brand: R8 logo
  ├─ 2B. Sidebar: aurora band
  └─ 2C. Settings as a dialog

Wave 3  (two lanes, parallel)
  ├─ 3A. Onboarding: aurora flow      (needs 2B)
  └─ 3B. Small wins                    (needs 2C)

Wave 4  (one lane, optional)
  └─ 4A. Icon set
```

Six PRs if you skip the optional one, seven with it. Waves 2 and 3 are where the parallel speedup is: five lanes across two weeks instead of seven PRs in a row.

---

## Why tokens go first

The rename touches every CSS file in the client. If it lands after the sidebar or onboarding work, it has to be rebased across both, and a mechanical rename over fresh code is where silent mistakes hide.

Two options, pick one:

- **Serial (recommended).** Land the rename first, then everyone branches from it. Costs one day, buys clean rebases for every lane after.
- **Parallel.** Everyone branches from `main`, the rename lands last and gets rebased. Only do this if the rename is a single script run you can re-run on the new `main` at any moment. It is, so this is viable, but the screenshot gate gets harder because three lanes of visual change land before the rename's "zero visual change" proof.

Either way, the rename is a **pure rename**. No values change. Its PR shows before/after screenshots that match pixel for pixel. If a screenshot moves, the rename is wrong, not the design.

---

## File ownership

The conflict map. A lane owns its files; nobody else edits them in the same wave.

| Lane | Owns | Must not touch |
|---|---|---|
| 0 Harness | `scripts/shots.ts`, `frontend-redesign-plan/shots/` | everything else |
| 1 Tokens | `packages/theme/src/palette.ts`, `packages/theme/scripts/gen-palette.ts`, `apps/web-solid/src/index.css`, every `*.css` under `apps/web-solid/src` and `packages/ui/src`, `scripts/rename-tokens.ts`, `index.html` boot defaults | component `.tsx` logic, `sidebar.css` layout rules |
| 2A Brand | `brand/logo/*`, `scripts/gen-brand.ts`, `lib/brand.tsx`, `packages/avatar/*`, `apps/*/public/*` brand assets, the `#boot` SVG in `index.html` | `index.html` boot *colours* (lane 1 owns those) |
| 2B Sidebar band | `sidebar/aurora-sky.tsx`, `sidebar/sidebar.css`, `sidebar/sidebar.tsx` (header only), `packages/theme/src/palette.ts` (`--sky-*` only) | `app/shell.tsx`, `chat-panel.tsx`, `index.css` outside the palette block |
| 2C Settings | `settings/*`, `app/routes.tsx`, `app/sections.ts`, `commands/nav-commands.ts`, `app/shell.tsx` | `sidebar/sidebar.css` (2B), `chat-panel.tsx` (3B) |
| 3A Onboarding | `app/first-run/*`, `scripts/gen-mural.ts` (delete), `mural.gen.ts` (delete), `progress.test.ts`, `steps.ts` | the sky component itself (2B owns it; 3A consumes it) |
| 3B Small wins | `run-panel-state.ts`, `chat/run/glyphs.ts`, `chat/ui/EmptyState.tsx`, `sidebar/chat-panel.tsx`, `sidebar/filter.ts`, `styles/motion.css`, `index.html` `#snap` rule | `app/shell.tsx` (2C owns it) |
| 4A Icons | `packages/ui/src/remix-icon.tsx`, `icons.gen.ts`, `scripts/gen-icons.ts`, `apps/web-solid/package.json` | every other file |

Three known collisions, resolved by ordering:

1. **`index.html`** — lane 1 generates the boot colours, lane 2A replaces the boot SVG, lane 3B adds the `#snap` rule. Different regions of one file. Whichever lands second resolves a small conflict by hand; keep the regions apart with comment markers so it stays trivial.
2. **`app/shell.tsx`** — lane 2C adds `openSettings`, lane 3B adds `slide()`. Both small. 2C lands first, 3B rebases.
3. **`palette.ts`** — lane 1 renames, lane 2B adds `--sky-*`. If both are in flight, 2B appends the sky group and leaves the rename to lane 1.

---

## Contracts

Lanes in the same wave can't talk to each other, so they code against these. Write them down before wave 2 opens.

### C1. The sky component

Lane 2B ships it; lane 3A consumes it. Fix the shape now.

```tsx
// apps/web-solid/src/sky/aurora-sky.tsx
export function AuroraSky(props: {
  class?: string
  height?: number        // default 112, the sidebar band; onboarding passes a large value
  drift?: boolean        // default true, false forces the still frame
}): JSX.Element
```

- Renders only markup and CSS. No JS beyond the props. No canvas, no SVG filters, no image.
- Positioned absolutely, `inset: 0 0 auto`, `width: max(100%, 380px)`, cropped from the left.
- Reads colours from `--sky-1`, `--sky-2`, `--sky-3`, `--sky-base`, which lane 1's palette generates.
- The fade is built into the component, so a caller can't accidentally leave a hard edge.
- Onboarding passes `height={window.innerHeight}` and gets the identical scene at full size. Same pixels at the same width, by construction.

### C2. The token names

Lane 1 produces these; every later lane writes against them and never against main's names.

```
--bg  --bg-sidebar
--ink  --ink-2  --ink-3
--fill-1  --fill-2  --fill-3  --fill-4
--raised  --line
--accent  --accent-wash  --accent-fill
--sky-1  --sky-2  --sky-3  --sky-base
```

If a lane needs a colour that isn't here, it adds a component token defined *from* a role (`--band-fade: ...`) and says so in its PR. It does not add a hex literal.

### C3. The mark

Lane 2A ships `KikoMark` with a stable API, because lanes 2B and 3A both render it.

```tsx
export function KikoMark(props: { size?: number; mood?: "idle" | "curious" | "happy"; class?: string })
```

- `size` in px. 16 and 32 automatically use the simplified cut.
- `mood` only changes CSS classes; no JS animation. `idle` is the default and is what the sidebar and the boot screen use.
- The bare mark and the tile version are separate components: `KikoMark` (transparent) and `KikoIcon` (on `#0a0a0a`).

---

## Wave 0: harness

**Branch** `ui/0-harness` from `main`. **One PR, half a day.** Blocks nothing but makes every later gate cheap.

- `scripts/shots.ts`: launches the app, sets a fixed viewport, signs in with the dev token, opens a fixture room, and writes named screenshots to `frontend-redesign-plan/shots/<lane>/<name>.png`. Args: `--lane`, `--theme dark|light`, `--viewport 1440x900|390x844`, `--reduced-motion`.
- Fixture: one room with a user message, an agent reply, a finished run and a live run, so tool-call work has something to shoot.
- A `--diff <a> <b>` mode that reports the percentage of differing pixels, so lane 1 can prove zero visual change mechanically instead of by eye.
- `bun run shots --lane tokens --theme dark --viewport 1440x900` works from a clean checkout.

**Gate:** every lane after this produces its before/after with one command.

---

## Wave 1: tokens

**Branch** `ui/1-tokens` from `main`. **One PR, about a day.** `TOKENS.md` is the spec.

- `scripts/rename-tokens.ts` rewrites variables and Tailwind utilities across `apps/web-solid/src` and `packages/ui/src`.
- Add `--sky-*` to `palette.ts` and `gen-palette.ts` now, so lane 2B only consumes them. Values: azure `oklch(0.62 0.17 262)`, violet `oklch(0.6 0.17 295)`, teal `oklch(0.72 0.12 200)`, base `#06070d`.
- Generate the boot colours in `index.html` from `tokensFor()` with markers.
- Add the two rules to `check-rules.ts`: no `0 0 0 <n>px` inside `--*-shadow`, and a hex-literal ratchet outside `index.css`.
- `--accent` becomes the azure that `--ring` holds today, and the grey hover fill becomes `--fill-2`. This is the one rename that changes a name people will actually type, so grep for it twice.

**Gate:** `shots --diff` between `main` and the branch is **0.00%** in dark, light, both viewports. Any diff means a value moved.

**Handoff note for the next lane:** "tokens are renamed, `--accent` is azure, `--fill-2` is the hover, `--sky-*` exist, boot colours are generated."

---

## Wave 2: three lanes

All three branch from `ui/1-tokens` (or from `main` if you chose the parallel-rename option). None of them touch the others' files.

### 2A. Brand: R8

**Branch** `ui/2a-brand`. Spec: `PLAN.md` step 3, art: `logo-rich.html` `R8`.

- Two SVG sources generated from one template: the full cut and the small cut (no speckles, smile, vein, highlight or feet; eyes r 4.6, no ring, no catchlight).
- `gen-brand.ts` writes the favicons, apple touch icon, 192 and 512, for both `apps/web-solid/public` and `apps/landing/public`.
- `KikoMark` and `KikoIcon` per contract C3, with `data-leaf` and `eyes` groups.
- Replace the three existing bunnies (favicon, onboarding mascot, in-app avatar) with this one mark, so there is one drawing in the codebase.
- Keep the `#boot` fade-in; replace only the SVG inside it.

**Gate:** the 16px favicon reads as a bunny with two red eyes in a real Chrome tab, dark and light. `grep -E "Gradient|filter"` over the brand SVGs is empty. Blink and leaf sway only under `prefers-reduced-motion: no-preference`.

### 2B. Sidebar: the aurora band

**Branch** `ui/2b-sidebar`. Spec: `PLAN.md` step 4, art: `sidebar-top.html` `S1`, `S2`, `S3`.

- Ship `AuroraSky` per contract C1 in `apps/web-solid/src/sky/`.
- Wire it into the sidebar behind the header and search: 112px tall, four-stop fade, no border, no card.
- Delete main's `.brand-art` (grid, orbits, planet, pulse).
- Header keeps main's metrics: 50px, `0 8px 0 12px`, mark 22px, name 14.5px/600, two 32px buttons. The wordmark image becomes text.
- Light mode is the dawn variant, including the search field's white fill and the 1px inset ring.

**Gate:** paints in the first frame from the snapshot with JS disabled. At 220, 280 and 420 the blobs never stretch. Screenshots in dark, light and reduced motion.

### 2C. Settings as a dialog

**Branch** `ui/2c-settings`. Spec: `PLAN.md` step 1.

- Take `settings-dialog.tsx`, `settings-dialog.css` and `dialog-state.ts` from `ebd856c1`, then strip every `--surface`, `--line-w` and ring-in-shadow rule and restyle on the new roles.
- `/settings` and `/settings/:section` open the dialog and replace the URL with the last chat.
- Delete the settings route and the old settings sidebar.
- Add the tier-4 path to `scripts/bundle-budget.ts`.

**Gate:** gear, account row and ⌘, all open it over the chat. Deep link works. Esc returns focus to the opener. Bundle budget unchanged.

---

## Wave 3: two lanes

### 3A. Onboarding: the aurora flow

**Branch** `ui/3a-onboarding` from `ui/2b-sidebar`. Spec: `ONBOARDING.md`, art: `aurora.html` `A1` and `lock.html` section 3.

- `stepsFor(true)` becomes `["sign-in", "cloudflare", "connect"]`; `welcome` and `model` go. Update `progress.test.ts`.
- Full-height `AuroraSky` from contract C1, Yuki above the card using `KikoMark` at 150px with `mood`.
- Three dots, current one an 18px pill. Card `min(380px, 100vw - 32px)`, frosted, radius 20, no border, max height with internal scroll so "Skip for now" always shows.
- Self-hosted keeps the access-code step inside the same card; hosted has no access code.
- Finale: the clip-path shrinks to the measured sidebar band, then `/chat/<kiko>` with focus in the composer.
- Delete `backdrop.tsx`'s grid, orbits, pulses and satellites, and the PR's whole mural.

**Gate:** at 1440x900 and 390x844 the connect step including "Skip for now" fits without page scroll. Keyboard only: Tab, Enter, pick a provider, Enter. Cold open reaches the sign-in buttons on the first frame after the snapshot. `bun kiko verify` suites for `data-step` and connect updated in the same PR.

### 3B. Small wins

**Branch** `ui/3b-small-wins` from `ui/2c-settings` (it needs `shell.tsx`). Spec: `PLAN.md` step 6.

- `runOpener` focus return, `glyphs.ts`, `ThreadSkeleton`, the `#snap` no-animation rule, the sidebar `slide()`, the main agent row with its status line, the "Chats" label.
- Leave out the empty-state font change.

**Gate:** each item is small enough to verify in one screenshot pair. No behavioural change to the run panel beyond focus.

---

## Wave 4: icons (optional)

**Branch** `ui/4-icons`. Only after everything else. Render every glyph at 12, 14 and 16px next to main's, decide, then either take the PR's Remix set or leave Hugeicons.

---

## Gates that apply to every PR

Run all four before asking for review.

```bash
bun run check
bun scripts/bundle-budget.ts
bun run shots --lane <lane> --diff main
bun kiko verify --list        # then the suites this lane touches
```

Plus, in a real browser through the `verify-kiko` skill:

- dark and light
- 1440x900 and 390x844
- `prefers-reduced-motion: reduce`
- a cold load with JS disabled, for the snapshot
- one keyboard-only pass

A lane that changes a backend hook (`data-step`, connect, install stages) extends the matching verify suite in the same PR. A lane that only changes paint does not need one.

---

## When a lane lands early

- **2A before 2B or 3A:** they pick up the real mark immediately. Nothing blocks.
- **2B before 3A:** expected. 3A branches from it.
- **2C before 3B:** expected. 3B branches from it.
- **2B before 2A:** the band renders the old mark for a day. Fine, it's one component swap.
- **Anything before 1:** rebase onto the rename and re-run the diff. The rename is the only lane whose gate is "nothing changed", so it must never be the one to move.

---

## What to hand a model

Each lane is self-contained. Give a model exactly this:

1. `frontend-redesign-plan/PHASES.md`, its lane section.
2. `frontend-redesign-plan/README.md`, the audit and the owner decisions.
3. The lane's spec file: `PLAN.md` step N, or `ONBOARDING.md`, or `TOKENS.md`.
4. The lane's art file: `logo-rich.html`, `sidebar-top.html`, or `aurora.html`.
5. The contract it consumes (C1, C2 or C3) and nothing else from this file.
6. `AGENTS.md` and `apps/web-solid/AGENTS.md` if it exists.

Do not hand it the whole plan. The file ownership table is what keeps parallel lanes from colliding, and a model that reads every lane will start editing files it doesn't own.

---

## Order of confidence

If you only ship three things, ship these: the **tokens rename**, the **sidebar band**, and **onboarding**. Those are the three the owner named as wrong in the PR, and the three that change how the app feels on first open. The logo is visible but small, settings is a nice-to-have, and icons are a detail.
