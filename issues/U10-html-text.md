# U10 Bound the html-to-text regexes

**Model** DeepSeek V4.1 Flash high. **Wave** 1. **Depends on** nothing. **Timebox** 45 min.

## Goal
A hostile web page must not burn the Durable Object's CPU. `core/durable/src/html-text.ts:151` uses `/<[^>]*>/g`, which is quadratic on input full of `<` with no `>`: 64 KB took 3.2 s when measured. Line 147 (the script or style pass) is also super-linear on many unclosed `<script>` tags. Callers pass up to 1 MB (`apps/server/src/agent/extensions/web.ts:40`).

## Build
1. Write the failing test first in the file that already tests `htmlToText` (search `apps/server/test` for it): 1 MB of `<` and 50,000 unclosed `<script>` each finish in under 200 ms, and existing outputs stay identical.
2. Change the tag pattern to `/<[^<>]*>/g` and make the script/style pass linear (for example, `indexOf` scanning, or a pattern that cannot backtrack across the whole input).
3. Keep output byte-identical for normal HTML. The existing tests prove that.

## Scope
`core/durable/src/html-text.ts` and the one test file.

## Verify
`bun run --cwd core/durable typecheck`, the test file via `bun run --cwd apps/server test web-tools`. Paste the timing lines before and after.
