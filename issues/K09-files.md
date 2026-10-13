# K09 file viewing upgrades

GOAL: the Files section views the same kinds t3code does, including CSV and TSV tables, and the tree feels like t3's.

CONTEXT: `refs/reports/R6-file-viewing.md` (read all of it), the real t3code source in `refs/t3code` (packages/shared filePreview.ts and delimitedPreview.ts, apps/web components/files, pierre-icons.ts), `issues/REDESIGN.md` item 8. Hugeicons only, no Lucide.

SCOPE: `apps/web-solid/src/files/**`, a shared file dialog in `packages/ui` only if nothing exists, and server file-read routes only if a cap or content-type is missing. No theme, composer, chat or avatar files.

ACCEPTANCE:
- Keep the existing kind table, lazy viewers and 1 MB read cap. Add: `diff` kind, BOM strip, delimited preview for csv and tsv (quotes, doubled quotes, multiline cells, 100 row cap with a visible notice, sticky header), one icon table keyed by kind.
- Table tests for kind detection and the delimited parser (quotes, multiline, BOM, cap) that fail when the parser breaks.
- Tree rows are 24 px, with t3-like search, expand and collapse behavior; the empty-file 416 error ("The server said 416") is fixed so a new empty file shows an empty viewer.
- A shared full-size file dialog opens from a file chip or the panel expand button.
- The Files header has no stray red outline in light mode.
- No animation. Lazy chunks stay out of tiers 1 to 3.

VERIFY: typecheck, web-solid tests, check-imports, bundle budget numbers reported, agent-browser screenshots under `.verify-evidence/K09/` of a csv, a tsv, an empty file, markdown and a diff, light and dark.
