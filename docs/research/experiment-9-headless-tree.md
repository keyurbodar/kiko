# Experiment 9: headless-tree without React

Question: does `@headless-tree/core` work without React? Architecture section 21 asks for a 1,000-node tree on a Solid binding.

## Result

Decision: keep `@headless-tree/core`.

The core has no React dependency. It runs in Solid behind a small binding, `packages/ui/src/v2/components/tree/create-tree.ts`.

## What was built

- `createTree` in `packages/ui/src/v2/components/tree/create-tree.ts`. It owns the tree state in one Solid signal, passes it to the core as `state` and `setState`, and keeps the core's config in sync with a `createComputed`. It returns `items` (the visible rows), `expanded`, `focused`, `selected`, `itemProps`, and `containerProps`.
- The experiment page `apps/web-solid/src/experiments/tree.html` with its script `tree.tsx`. It renders 1,000 nodes (10 folders, 9 folders in each, 10 files in each) with indent only.
- Features used: sync data loader, selection, hotkeys core. Drag and drop, search, and renaming are not loaded.

## What was checked

Run in the browser on the Vite dev server:

| Check | Result |
| --- | --- |
| 1,000 nodes loaded | yes |
| first paint shows only the 10 roots | yes |
| click on a folder expands it (10 to 19 rows) | yes |
| click again collapses it (back to 10 rows) | yes |
| ArrowDown and ArrowUp move focus and selection | yes |
| ArrowRight expands the focused folder, ArrowLeft collapses it | yes |
| all 100 folders expanded gives 1,000 rows | yes |

## Facts the binding depends on

- The core sends no change event of its own. Every state change goes through `config.setState`, so the binding writes that into a signal and the rows react to it.
- `getProps()` reads core state, not signals. `itemProps` reads the state signal first so the spread stays reactive. Row markup that shows expansion must read `tree.expanded()`, not `item.isExpanded()`.
- ArrowUp and ArrowDown move focus only. The binding adds `selectionFollowsFocus` to move selection with focus.
- The container ref must call `setMounted(true)` and `rebuildTree()`. Without them the core queues updates and never applies them.
- `updateDomFocus` uses `setTimeout` and polling. That is client code, so the Durable Object rule does not apply.
- Rows were not virtualized. 1,000 rows rendered with no visible delay. The core returns a flat list, so `virtua` can wrap it later.

## Bundle cost

Minified, then gzip level 9, bundled with Bun for the browser:

| Imports | min | gzip |
| --- | --- | --- |
| `createTree` only | 12.8 kB | 4.3 kB |
| `createTree` + sync data loader + selection + hotkeys | 18.9 kB | 6.0 kB |

The core adds 6.0 kB gzip with the features the binding uses. The binding itself is under 1 kB gzip. The package is `sideEffects: false`, so unused features drop out.

## Decision

Keep. No fallback is needed, so the `virtua` tree from section 21 is not written. UNVERIFIED in `docs/architecture.md` section 19.9 is settled and the label should be removed there.
