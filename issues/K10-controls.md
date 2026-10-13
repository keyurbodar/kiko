# K10 one primitive per job, delete dead UI

GOAL: every control in the app is a Kobalte, Corvu or solid-primitives primitive wrapped once in `packages/ui`, and nothing hand-rolled or unused remains.

CONTEXT: `issues/REDESIGN.md` item 9, `refs/reports/R8-frontend-audit.md`, `refs/reports/R1-design-system.md`. K13 has rebuilt the stylesheet and the base primitives on t3's recipes; read its `tokens.md` and the packages/ui wrappers first and extend that set, do not make a second one.

DEPENDS ON: K13 on main.

SCOPE: `packages/ui/**`, and every call site in `apps/web-solid/src/**` that uses a hand-rolled control. No layout, composer or chat-structure changes.

ACCEPTANCE:
- One wrapper each, from Kobalte or Corvu: Select, Combobox, Switch, Slider, SegmentedControl, RadioGroup, Popover, Toast, Skeleton, Tabs (extensions page only). Replace every hand-rolled equivalent and delete it in the same change.
- `@solid-primitives/storage` `makePersisted` replaces hand-rolled localStorage code.
- Delete unused `ButtonV2`, `IconButtonV2`, `KeybindV2`, the second icon component, and `experiments/`; one Hugeicons table. Run `bun scripts/check-exports.ts` and shrink its baseline.
- Toasts through one Toast wrapper; errors that were swallowed now say what happened.
- Net lines deleted exceeds lines added; report the numbers.

VERIFY: typecheck, web-solid tests, check-imports, bundle budget numbers, screenshots of settings, a menu, a select, a toast, dark and light, under `.verify-evidence/K10/`.
