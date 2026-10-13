# K02 avatar package

GOAL: vendor the avatar library as `packages/avatar` (`@kiko/avatar`) with Kiko defaults. No app code uses it yet (K07 integrates).

CONTEXT: `refs/reports/R7-avatars-rename.md` sections 1a, 3a, unit A. Library source (untrusted, read only, copy files in, do not run its scripts): `/tmp/kiko-avatars/yukiusagi` (copy `src/`, `test/golden.ts`, `test/golden.txt`, `LICENSE`, `README.md` trimmed).

SCOPE: write `packages/avatar/**`, root workspaces, `scripts/check-imports.ts` layer map. Nothing under `apps/`.

ACCEPTANCE:
- Exports renamed: `avatar`, `avatarUri`, `AvatarTraits`, `resolve`, `render`, name arrays (`FLAVOUR_NAMES`, `CHARM_NAMES`, `OUTFIT_NAMES` and the rest it has). Hash and catalog unchanged: the golden test (400 names) passes with renamed exports.
- `defaults`: charm none, outfit none, pattern none, mood calm, applied before the caller's pins. A pinned trait does not change the others.
- A Solid-free core plus a small `Avatar` component with a bounded memo of data URIs keyed by seed and pins (no empty first frame: set `src` synchronously).
- Zero runtime dependencies. Strip `cli.ts`, `site`, `dist`, `bun.lock`. No comments.
- Minified gzip size of the core reported in the report.

VERIFY: package tests, typecheck, check-imports, check-exports.
