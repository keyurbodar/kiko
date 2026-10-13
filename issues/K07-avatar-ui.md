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
