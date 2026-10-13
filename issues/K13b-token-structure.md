# K13b t3 token names and single stylesheet

GOAL: the stylesheet and tokens are written the way t3code's web app writes them, so t3 recipes and themes port directly.

CONTEXT: K13 landed the palette, system fonts, font settings, dark class. Read `packages/ui/src/styles/tokens.md` and `refs/t3code/apps/web/src/index.css` (2369 lines). Decisions by the lead: map Kiko's `--accent` and `--accent-fill` to `--primary` (the send and primary buttons are blue as in t3code); keep Kiko-only roles (message bubbles, reply bar) in one marked group at the end.

SCOPE: `packages/ui/src/styles/**`, `packages/theme/**`, and every user of an old token name in `apps/web-solid/src/**` and `packages/ui/src/**`.

DO IT AS A CODEMOD, NOT BY HAND: write `scripts/rename-tokens.ts` with a table of old name to new name (`--text` to `--foreground`, `--bg` to `--background`, and so on; `text-muted` to `text-muted-foreground`, `bg-hover` to the t3 equivalent), run it over css, ts and tsx, review the diff by sampling, then delete the script. The old names must not remain anywhere: `rg` for each old name must return nothing.

ACCEPTANCE:
- t3 semantic names: --background, --foreground, --card(-foreground), --popover(-foreground), --primary(-foreground), --secondary, --muted(-foreground), --accent(-foreground), --destructive, --border, --input, --ring, --sidebar-*, --info/--success/--warning with foregrounds, --radius (0.625rem).
- One stylesheet `packages/ui/src/styles/index.css` in t3 order: tailwind import, @custom-variant dark/light/any-hover, root non-color vars, @theme (fonts), @theme inline (colors, radii from --radius), @utility blocks actually used, @layer base, @layer components, light values, .dark values, then `html[data-theme-id]` block that maps an imported theme's role variables. Update imports and delete `kat.css`.
- K12's mapper in `packages/theme` writes those role variables; installing a theme from Open VSX recolors the whole app. Prove with a screenshot (Dracula, dark) under `.verify-evidence/K13b/`.
- Update the palette test for the accent change. Update `tokens.md` to a short page.
- Typecheck, web-solid and theme tests pass; bundle budget numbers reported; dark and light screenshots of home, chat, settings, files.
