> Current implementation and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposals below are historical and do not override it.

# Plan

> **Update, third round:** the logo is **R8 Full** (`logo-rich.html`), main's Yuki with shade, two-tone leaves, sparkle eyes and a small smile, flat, on a black tile. The sky is **B4 Aurora**, kept as-is (`aurora.html` `A1`), shared by onboarding and the sidebar band. No ground and no snow. Where this file disagrees with `aurora.html`, `aurora.html` wins.

Branch each step from `main`, not from `ui/warm-refresh`. Each step is one PR. To take a file from the PR, run `git checkout ebd856c1 -- <path>`, then remove what this plan rejects.

Check every step with:

- `bun run check`
- `bun scripts/bundle-budget.ts`
- the `verify-kiko` skill in a real browser: dark and light, 1440x900 and 390x844, reduced motion, and a cold load from the snapshot

Take a before and after screenshot. Steps 1, 3 and 4 can run in parallel. Step 7 needs 3 and 4. Step 2 touches every CSS file, so land it alone.

## 1. Settings as a dialog

- Take `settings/settings-dialog.tsx`, `settings-dialog.css` and `dialog-state.ts`.
- Take the `openSettings` changes in `sidebar/sidebar.tsx` (Foot), `app/shell.tsx`, `app/sections.ts`, `commands/nav-commands.ts` (and its test) and `scripts/bundle-budget.ts` (tier 4 path).
- Delete `app/routes/settings.tsx` and `sidebar/settings/sidebar.tsx`.
- `routes.tsx`: `/settings` and `/settings/:section` render nothing. They call `openSettings(section)` and replace the URL with the last chat.
- Style it with main's tokens. Don't take any `--surface`, ring or `--line-w` usage from `settings-dialog.css` and `kit.css`.

Accept when:

- The gear, the account row and ⌘, open the dialog over the chat.
- `/settings/models` opens the dialog on the Models section.
- Esc returns focus to the opener.

## 2. Tokens

See `TOKENS.md`. The rename ships with no visual change. Compare screenshots of main before and after: they must match pixel for pixel.

## 3. One flat bunny (locked: R8 Full)

See `logo-rich.html`, `R8`. It is main's Yuki, drawn flat: `#FAFAF7` body, a `#DDE4EE` shade ellipse across the lower body, two-tone leaves (`#5F7A66`/`#4C6553` back, `#86A38D`/`#6F8C77` front) with a `#C3D5C6` vein, `#C6D3E6` speckles, a white highlight on the upper left, `#C22F2A` eyes with a `#E0453B` ring and a white catchlight, `#F2A08E` blush at .85, and a `#9B4B42` smile. No gradient, glow, drop shadow or warm tile.

- Write `brand/logo/kiko-mark.svg` (the bare mark, `viewBox="16 10 88 92"`) and `brand/logo/kiko-icon.svg` (the mark on a `#0a0a0a` tile, `rx 27/120`).
- Write `brand/logo/kiko-icon-small.svg`: no speckles, smile, vein, highlight or feet; eyes r 4.4 with no ring and no catchlight. Use it for the 16 and 32 favicons only. Both files are generated from one template so the two cuts can't drift.
- `scripts/gen-brand.ts`: generate `favicon.ico`, the 16 and 32 PNGs, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` for `apps/web-solid/public` and `apps/landing/public`. Regenerate `kiko.svg`, the mascot SVGs and the inline `#boot` SVG in `index.html`.
- `lib/brand.tsx` `KikoMark` renders the bare mark with `data-leaf` groups so CSS can move the leaves, and one `eyes` group so CSS can blink. The Kiko identity avatar (`packages/avatar`, seed `KIKO`) renders it too. Other agents keep their generated avatars.
- `theme-color`, `manifest.webmanifest` and the boot colours stay main's `#0a0a0a` / `#fcfcfc`.
- Keep the PR's `#boot` fade-in after 160ms.

Accept when:

- The 16px favicon reads as a bunny with two red eyes in a Chrome tab, in dark and light.
- `grep -E "Gradient|filter" apps/web-solid/public/kiko*.svg brand/logo/*.svg` finds nothing.
- The two eyes blink together on a 5s loop, and the leaves sway, under `prefers-reduced-motion: no-preference` only.

## 4. Sidebar top: the aurora band (locked: A1 / B4)

See `aurora.html` `A1`, and `sidebar-top.html` for it in place at 220, 280 and 420, dark and light. It replaces main's blueprint `.brand-art` (grid, orbits, planet) with the top of the onboarding sky, so the two are one scene.

- New `sidebar/aurora-sky.tsx`: a `div` with three blurred blobs and one curtain-line overlay, all static markup, `height: 112px`, `overflow: hidden`, absolutely positioned behind the header and search. No JS, so it paints in the first frame from the snapshot.
  - base `linear-gradient(#06070d, #0a0a0a 70%)`;
  - three `position: absolute` ellipses, `border-radius: 50%`, `filter: blur(30px)`, `mix-blend-mode: screen`: azure `oklch(0.62 0.17 262)` at opacity .85, violet `oklch(0.6 0.17 295)` at .85, teal `oklch(0.72 0.12 200)` at .5;
  - the blob wrapper is masked `linear-gradient(#000 25%, transparent 95%)` so the colour dissolves upward instead of ending on an edge;
  - the curtain overlay is `repeating-linear-gradient(98deg, rgb(255 255 255 / .05) 0 1px, transparent 1px 7px)`, masked `linear-gradient(transparent, #000 25%, transparent 65%)`;
  - a six-dot star layer at `background-size: 260px 74px`, opacity .9, static;
  - the whole band is masked `linear-gradient(#000 0, #000 26%, rgb(0 0 0 / .72) 54%, rgb(0 0 0 / .28) 80%, transparent)`. This four-stop fade is the important part: a two-stop fade shows a line where it starts.
- The sky is `width: max(100%, 380px)` and cropped from the left, so a wider sidebar shows more aurora and never stretches the blobs.
- No border, no card, no rounded panel, and no shadow under the band. It fades into `--sidebar`, which is how main and `refs/t3code` separate surfaces.
- Drift: the three blobs move on 17s, 21s and 15s `alternate` loops (translate and scale, as in `aurora.html`). Off under reduced motion, which leaves the same still frame.
- Light mode is `A11`: pale azure and lavender on `#dbe6ff` to `#fdfdff`, no stars, no curtain lines, a shorter fade (gone by 96px), a 1px dark drop shadow on the mark, and the search field flips from a dark fill to white at 60% with a 1px `rgb(24 24 40 / .06)` inset ring.
- The sky colours are role tokens in `palette.ts` (`--sky-*`), shared with onboarding. Onboarding is the same component at full height.
- Header stays main's: 50px tall, `0 8px 0 12px` padding, mark at 22px, name at 14.5px/600, two 32px icon buttons. The wordmark image is replaced by the word in the interface font so it stays crisp at every zoom.
- Optional (S3): while any agent is working, a 24px sleeping Yuki with drifting "z"s sits left of the header icons. It replaces no existing indicator. Ship it in a follow-up if at all.

Accept when:

- The band paints in the first frame from the snapshot (static markup, no JS).
- Resizing the sidebar shows more sky and never stretches the blobs.
- The band and the onboarding sky are the same pixels at the same width.
- Screenshot at 220, 280 and 420 in dark and light, and at `prefers-reduced-motion: reduce`.

## 5. Tool calls: keep main's (locked)

Main's design stays: one live row (dots, `RunChevron`, caption) that never grows, and the floating `RunPanel`. Don't take `RunTree.tsx`, `run-tree.css`, `run-tree-rows.ts` or the PR's `summarizeSteps`. From the PR, take only the `runOpener` focus return and `glyphs.ts` (listed in step 6).

## 6. Small wins

From the PR, on main's tokens:

- `run-panel-state.ts` `runOpener` (focus returns to the opener) and `chat/run/glyphs.ts`
- `ThreadSkeleton`
- the `#snap` no-animation rule
- the sidebar `slide()`
- the main agent row with its status line, and the "Chats" label
- the motion.css rules those need
- the AGENTS.md "Instant" wording

Leave out the empty-state font change.

## 7. Onboarding

Build the aurora onboarding from `ONBOARDING.md`. The prototype is section 3 of `lock.html`, with the sky from `aurora.html` `A1`. If the owner wants to swap skies later, `aurora.html` has eleven siblings that change nothing but the background.

## 8. Icon set (optional, last)

Decide between Remix (the PR) and Hugeicons (main). If Remix, take `packages/ui/src/remix-icon.tsx`, `icons.gen.ts`, `scripts/gen-icons.ts` and the lucide removal. Render every glyph at 12, 14 and 16px next to main's in one screenshot, and fix any weight mismatch before merging.

## Don't

- Self-hosted fonts.
- A warm default.
- Accent-tinted neutrals by default. An opt-in Appearance toggle later is fine.
- The inset framed column.
- `--line-w`.
- Press-edge buttons.
- Ring borders in shadow tokens.
- Changing bubble or type sizes.
- An inline step list or the run tree.
- A split-screen onboarding, or an access-code field in the hosted flow.
- Dot separators (`•`, `·`) anywhere.
