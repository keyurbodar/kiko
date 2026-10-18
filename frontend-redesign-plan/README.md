> Current implementation and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposals below are historical and do not override it.

# Frontend redesign plan

> **Update, second round of `lock.html`:** the logo is now main's Yuki (headphones, grey leaves, red eyes) with the PR's blush, on a black tile. The background has no ground or drifts: the owner picks one of four infinite skies (Quiet snow, Aurora, Nightly, Moonlit). Onboarding keeps main's five screens and copy, Clerk modal included. Where this file disagrees with `lock.html`, `lock.html` wins.

This is a review of PR #5 (`ui/warm-refresh`, one commit `ebd856c1`, 185 files) against `main` at `6167d2b1`, and the plan for what to take, change and drop. I ran both apps side by side and compared them in the browser.

## Files

| File | What it is |
|---|---|
| `board.html` | The visual board. Open it in a browser. It has screenshots of main and the PR, five logo options, sidebar header options, the tool-call comparison and three onboarding options. |
| `shots/` | Screenshots taken from both running apps, used by the board. |
| `PLAN.md` | The work, in order, one PR per step, with files, acceptance checks and things not to do. |
| `PHASES.md` | **The build order for parallel lanes.** Waves, file ownership, the three contracts, and the brief to hand a model. |
| `TOKENS.md` | The token restructure. |
| `ONBOARDING.md` | The chosen onboarding (snow night), specified. |
| `lock.html` | **The locked designs.** The logo, the sidebar top and a clickable onboarding prototype. Open it in a browser. Where it disagrees with `board.html`, it wins. |
| `backgrounds.html` | Twelve onboarding skies. The owner picked **B4 Aurora**. |
| `logo-rich.html` | Nine richer cuts of the Yuki mark, flat colour only. The owner's pick is **R8 Full**. |
| `aurora.html` | **The aurora family around B4:** twelve skies in the same shape language, each shown with the onboarding frame and the sidebar strip it becomes. This is the shortlist for the final pick. |
| `sidebar-top.html` | **The band in place.** B4 cropped into the real sidebar at 280, 220 and 420, dark and light, with the band on its own at three strengths. Open it in a browser. |

## How the screenshots were made

- Main ran from a detached worktree at `6167d2b1`. The PR ran from this worktree.
- Both were launched with `.cursor/skills/verify-kiko/bin/up.sh`. The PR branch doesn't have `issues/bin/heavy.sh`, so it used main's launcher with `ROOT` pointed at the PR worktree.
- Tool calls: the OpenCode Go key came back with "quota or credit used up", so the runs came from the dev mock room. Start vite with `VITE_KIKO_SYNC=mock KIKO_SERVER_PORT=<server>`, sign in with the dev token, open `/chat/01JZ8Q4T6M0000000000000001`, then push `RunStep`s and messages through `globalThis.__mockRooms` (`step()`, `store()`, `broadcast()`). `tool` must be a real `ToolKind` (`read`, `edit`, `search`, `run`, `web`, `other`). Any other value crashes the PR's `summarizeSteps`.

## Owner decisions

These are fixed:

1. Keep main's default theme everywhere: the canvas, favicon tiles, boot screen, `theme-color`, manifest and the azure accent.
2. Keep main's bubble and font sizes.
3. The sidebar band stays, and it is the **aurora sky** from onboarding (`aurora.html`, `A1` = `B4`), in place of main's blueprint art. The band is the top of the same sky, not a separate drawing.
4. The logo is **R8 Full** (`logo-rich.html`): main's Yuki with shade, two-tone leaves, sparkle eyes and a small smile, flat, on a black tile. No glow, gradient or shadow. At 32px and 16px it drops the speckles, smile, veins and highlight and thickens the eyes.
5. No unnecessary borders. Main and `refs/t3code` separate surfaces by tone, not lines.
6. Onboarding is the snow night: the Clerk flow in three steps (sign in, Cloudflare, connect a model), with Yuki reacting on the snow. No split screen, and no access code in the hosted flow.
7. Tool calls stay as main draws them.

## Audit

### Good: take it

| What | Files | Notes |
|---|---|---|
| Settings as a dialog over the chat, instead of a route | `settings/settings-dialog.tsx`, `settings-dialog.css`, `dialog-state.ts`, `sidebar/sidebar.tsx` (Foot), `app/shell.tsx`, `routes.tsx`, `sections.ts`, `commands/nav-commands.ts`, `scripts/bundle-budget.ts` | You keep the chat behind settings. Make `/settings/:section` redirect so old links still open the dialog. |
| Focus returns to the row that opened the run panel | `run-panel-state.ts` `runOpener`, `RunPanel.tsx` | |
| `GLYPH` map in its own module | `chat/run/glyphs.ts` | Keeps the panel chunk out of first paint. |
| Thread skeleton that appears only on a slow load | `chat/ui/EmptyState.tsx` `ThreadSkeleton`, `empty-state.css` | |
| Boot mark that fades in after 160ms | `index.html` `#boot` style | Keep the mechanism and swap in the new mark. |
| No animation inside the saved snapshot | `index.html` `#snap *` rule | |
| Sidebar slides only on toggle, never during a drag | `app/shell.tsx` `slide()`, `styles/motion.css` | |
| The main agent as a full-width row with a status line, and a "Chats" label under the pins | `sidebar/chat-panel.tsx` `PinTile main`, `filter.ts` `pinnedRows`, `sidebar.css` | Restyle it on main's tokens. |
| Removes `lucide-solid` and `lucide` from the client | `apps/web-solid/package.json` | Optional step. It goes with the icon-set decision. |

### Reject

| What | Seen in | Why |
|---|---|---|
| Warm default palette (`#18130e`, accent `mikan`) and neutrals tinted by the accent (`paletteFor`) | Every screenshot | It overrides your default. Mikan can be an extra accent, but not the default. |
| New icons: a glowing brown tile, a gradient bunny, an outlined lowercase "kiko" with a red dot | `apps/*/public/*`, `kiko.svg`, `lib/brand.tsx`, `brand/logo/*` | Glow and gradient. Replace with the flat mark (PLAN step 3). |
| Sidebar band removed | `sidebar.tsx`, `sidebar.css` | Bring the band back as the aurora sky (PLAN step 4). |
| Text sizes +1px, bubble padding 14px, radius 12px, tail and one-line pill removed | `index.css`, `bubble.css`, `bubble.tsx` | Main's bubbles are better. |
| Main column inset by 8px with a ring, ring borders inside the shared shadow tokens, composer edge and halo, 1.5px field lines | `index.css` shadows and `--frame-*`, `sidebar.css` | Borders everywhere. |
| A live run tree that grows to 4 rows under the typing dots | `chat/run/RunTree.tsx`, `typing/TypingIndicator.tsx` | The thread jumps on every step. Main's single live row is better. |
| Clicking the summary unfolds the step list inline, and clicking a row opens the panel with the same list | `RunTree.tsx` | Two copies of one list on screen. |
| Onboarding drawn as a technical drawing ("Fig. 1", "3:1", "A1", callouts) | `app/first-run/*`, `scripts/gen-mural.ts`, `mural.gen.ts` | Replace it (ONBOARDING.md). |
| Self-hosted Figtree and Bricolage fonts | `public/fonts`, `index.css` `@font-face` | The swap reflows text after the snapshot paints, and Bricolage ExtraBold headings are loud. Keep main's system stack. |
| One 185-file commit | | AGENTS.md says one change per PR. |

## What main gets wrong too, found while comparing

- There are three bunnies: the favicon (grey leaves, headphones, closed eyes, on a blueprint grid), the onboarding mascot (headphones, open eyes) and the in-app avatar (green leaves, speckles). The logo step unifies them.
- Onboarding takes four screens before you can type. On a 1440x900 window, the provider step runs past the fold.
- When a run finishes, the only trace is a bare chevron beside the bubble that says nothing.
- There are 256 custom properties in `index.css`, about 250 ad-hoc `color-mix()` calls in component CSS, and `--accent` names a grey hover fill while the real accent is `--ring`.
