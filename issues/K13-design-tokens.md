# K13 design system: t3-style tokens, sizing, radii, type, neutral default

GOAL: the whole app visibly takes on T3 Code's design language (compact sizing, tighter radii, crisp type, quiet surfaces, ring-based borders) while keeping Kiko's bubbles, grouping and identity. Modern and minimal, not cute.

CONTEXT: read the real source in `refs/t3code` (apps/web index.css, theme tokens, button, input, menu, dialog, sidebar, settings sizing) and `refs/reports/R1-design-system.md`, `issues/REDESIGN.md` items 2 and 9. `@kiko/theme` (packages/theme) owns palette; `packages/ui/src/styles/kat.css` owns fonts, type scale, radii, icon sizes.

SCOPE: `packages/theme/**`, `packages/ui/**` (tokens, Button, Input, Menu, Dialog, Select, Switch, Tabs wrappers on Kobalte), `apps/web-solid/src/**/*.css` only to replace literal px, color and radius values with tokens. Do not edit composer/, chat bubble components, avatar code or the theme importer; those units are in flight.

ACCEPTANCE:
- Choose and document a better neutral default theme than t3's (light and dark), a UI font stack and a mono font, and font smoothing settings. State the choice and reason in `packages/ui/src/styles/tokens.md`.
- Named scales exist and are used: radii (xs 4, sm 6, md 10, lg 14, bubble 16, pill), icon sizes, type scale 11/12/13/14/16, control heights, spacing. Buttons, inputs, menus, dialogs, settings rows, sidebar rows and tabs use them.
- Settings page rows and controls match t3's sizing and layout feel (compact rows, label left, control right).
- 0 ms animation everywhere; Hugeicons only.
- Screenshots before and after under `.verify-evidence/K13/` at 1440 and 390 px, light and dark, for: home, a chat with long and short bubbles, settings, files panel. Look at them and fix visual inconsistencies you see.

VERIFY: typecheck, theme and web-solid tests, check-imports, bundle budget numbers reported, browser checks with agent-browser.
