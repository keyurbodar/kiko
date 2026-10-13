# K07 avatar integration, picker, mascot deletion, look v3

GOAL: every bird in the app comes from `@kiko/avatar`, the user and each agent can pick an avatar in a plain dialog, and the animated mascot chrome is gone.

CONTEXT: `refs/reports/R7-avatars-rename.md`, `issues/REDESIGN.md` item 3. `packages/avatar` and `@kiko/theme` are on main.

SCOPE: `apps/web-solid/src/**` where avatars, the mascot, snow, hoarfrost and moments are used, the look store (now in `packages/theme`), a new avatar picker dialog built on the existing `@kiko/ui` dialog. No composer, chat bubble or layout files except to swap the avatar component.

ACCEPTANCE:
- Avatar choices are a sparse `avatars` record in the look, version 3, converted once from the old `birds` record, with a test for the conversion that fails on old code.
- Kiko defaults: charm, outfit, pattern none, mood calm.
- Picker is a plain dialog with 0 ms animation; choosing applies at once (optimistic) and survives reload.
- Snow, hoarfrost, moments and the animated mascot are deleted, with their CSS and tests. Nothing animates.
- One avatar component is used in sidebar, header, empty state, account and message rows.

VERIFY: typecheck, web-solid tests, bun scripts/check-imports.ts, bundle budget numbers reported (do not edit the budget constants), browser screenshots under `.verify-evidence/K07/` (light and dark, 1440 px and 390 px).

## Report

STATUS: done, with two gaps listed under VERIFIED (group stacks and the flavor grid were not reachable in the browser).

BRANCH: s/k07-avatar-ui

HEAD: see `git rev-parse HEAD` after this commit (the wip commit before it is f08c61c1)

CHANGED:
- packages/theme/src/look.ts: look version 3, `avatars` pins, v2 `birds` converted once, unknown values dropped
- packages/theme/src/theme.test.ts: round trip and conversion tests rewritten for the new shape
- packages/theme/package.json, apps/web-solid/package.json, bun.lock: `@kiko/avatar` workspace links only, no new external dependency
- scripts/check-imports.ts: theme may import `@kiko/avatar`
- apps/web-solid/src/avatar/picks.ts (new, replaces mascot/choices.ts): pins mirror, Kiko keeps hatsuyuki
- apps/web-solid/src/avatar/picks.test.ts (new)
- apps/web-solid/src/avatar/picker.tsx (new, replaces mascot/picker.tsx): one plain dialog, drawn flavor, charm and outfit choices, save and reset
- apps/web-solid/src/avatar/picker-state.ts (new)
- apps/web-solid/src/lib/IdentityAvatar.tsx: draws `@kiko/avatar` through `cachedUri`, no mood prop
- apps/web-solid/src/lib/identity.ts: colour from the flavor's grain, Kiko keeps the accent
- apps/web-solid/src/lib/identity.test.ts: bird tests replaced by avatar tests
- apps/web-solid/src/theme/live.ts: mirrors `avatars`
- apps/web-solid/src/chat/ui/EmptyState.tsx, empty-state.css: the hero is the chat's avatars at 72 px
- apps/web-solid/src/sidebar/sidebar.tsx, chat-panel.tsx, settings/sidebar.tsx, app/top-bar.tsx, app/sign-in.tsx, app/shell.tsx, app/routes/chat.tsx: swapped to the avatar components, snowball removed
- apps/web-solid/src/chat/members/members.tsx, info/panel.tsx, info/tasks.tsx, info/memory/views.tsx, typing/TypingIndicator.tsx, typing/harness.tsx, typing/typing.css: moods and moments removed
- apps/web-solid/src/search/overlay.tsx, settings/models.tsx: moments removed
- apps/web-solid/src/commands/theme-commands.ts, use-kat-commands.ts: "Change avatar" command
- apps/web-solid/scripts/gen-logo.ts: boot logo and favicon from `@kiko/avatar`
- apps/web-solid/public/kiko.svg: regenerated
- apps/web-solid/index.html: boot logo regenerated, boot animation removed (user edited the logo after my run; I left their edit)
- apps/web-solid/src/sidebar/sidebar.css: comment only
- deleted: src/mascot/ (all files), src/sidebar/header-snow.tsx and .css, src/composer/snowball.tsx and .css
- docs/architecture.md, docs/product.md, packages/ui/src/styles/tokens.md: text that described birds and the mascot chrome

VERIFIED:
- `bun run --cwd apps/web-solid typecheck` (tsc --noEmit): exit 0
- `packages/theme`: `bun run typecheck` exit 0, `bun test`: THEME_EXIT=0, 0 fail
- `apps/web-solid`: `bun test`: 626 pass, 0 fail, 58 files
- `bun scripts/check-imports.ts`: imports ok, exit 0
- `bun scripts/check-rules.ts`: check-rules ok, exit 0
- `bun scripts/check-exports.ts`: check-exports ok: 205 files, 185 baselined, exit 0
- `bun run --cwd apps/web-solid build`: finished, rolldown output in /tmp/k07-build.log (exit code not captured on that run)
- `bun scripts/bundle-budget.ts`: exit 0. index.html 17627 of 20480 bytes raw. tier 1 1963 of 2092 gzip. tier 2 first paint of /chat 189549 of 189595 gzip (recorded 180567). tier 3 130561 of 136266. tier 4 route chunks 25762 of 28461. Budget constants untouched.
- Browser (agent-browser session k07, dev owner k07, own ports 5307 and 5407, both stopped after use):
  - empty chat, 1440, dark: .verify-evidence/K07/empty-1440-dark.png. The loaf avatars render on charcoal. Viewed.
  - empty chat, 1440, light: .verify-evidence/K07/empty-1440-default.png. Viewed.
  - settings appearance, 1440, dark and light: settings-1440-dark.png, settings-1440-light.png
  - picker (Kiko), 1440, dark and light: picker-kiko-1440-dark.png, picker-kiko-1440-light.png
  - picked a charm (beret), saved, reloaded: after-save-reload-dark.png shows the beret in the sidebar tile, hero, details and members list.
  - picker at 390, light: picker-390-light.png
  - empty chat at 390, dark and light: empty-390-dark.png, empty-390-light.png
  - mobile sidebar at 390, light: sidebar-390-light.png
  - reset to generated, reloaded: after-reset-390-light.png shows the plain avatar again.
- Not verified in the browser: group stacks (the Add list is empty for this owner, no provider), the flavor grid of a non-Kiko agent (the picker is only reachable for Kiko here), and message rows (no model reply). The shared `IdentityAvatar` draws them, but the stacked ring cutout still uses the old body ratios and is untested on the new art.

FAILED-BEFORE:
- packages/theme "a version 2 bird record converts once to avatar pins, and the next save writes version 3" failed on the HEAD `look.ts`. Output: `(fail) the look record > a version 2 bird record converts once ...` with `- Expected - 6`, `+ Received + 1`. Also failed on old code: the round trip test, the old theme system test, and the version 3 test. Run by swapping in the HEAD `look.ts` and restoring mine (cmp confirmed).

DEVIATIONS:
- The default look mode is untouched (system). The stored mode is kept by parse and format. K13 changes the default.
- Snowball deleted now, not in K04. It played the bird's animation, and the brief lists snow as deleted. K04 will find nothing to delete.
- The typing dots keep their own motion. Only the bird state went. K08 replaces that row.
- The boot screen loses its hop animation (nothing animates).
- The picker uses drawn button grids, not Kobalte RadioGroup or Select. `@kiko/ui` has no Select wrapper, and drawn choices read better than text options.
- The colour is the flavor's grain, not the accent mixed in oklch as R7 3a suggests. Kiko keeps the accent.
- Moment call sites (sidebar, search, memory, tasks, models, harness) lose the picture. Their text stays.
- `theme/look.ts` imports `@kiko/avatar` for the name lists, so `check-imports` allows that one edge.
- The user's index.html edit keeps a duplicate `aria-hidden` on the boot svg. I changed `gen-logo.ts` so it stops adding one, but left their index.html as it is.

FOLLOW-UPS:
- First paint (tier 2) is 46 bytes under its limit. The avatar catalog and draw code go into the first paint through `theme/look.ts`, which imports `@kiko/avatar`. Import only the name lists in look.ts, or move the parser off first paint, before the next client change.
- Verify group stacks and the ring cutout on the new art once a second agent exists (needs a provider).
- Verify the flavor grid for a non-Kiko agent.
- `.typing-bird` and `sidebar.css` class names still say bird. Cosmetic, left for K08 to rename with the typing row.
