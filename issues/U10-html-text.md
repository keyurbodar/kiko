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

## Report

STATUS: done

BRANCH: s/u10-html-text

HEAD: 98727cd0614a56187c3f1d18f5a311978a28b290

CHANGED:
- `core/durable/src/html-text.ts`: the script and style pass is now a linear indexOf scan (`closeIndex` plus `stripElements`), the head title extraction is indexOf based (`titleOf`), and the final tag strip is `/<[^<>]*>/g`.
- `apps/server/test/web-tools.test.ts`: added two timing tests for 1 MB of `<` and 50,000 unclosed `<script>` tags.

VERIFIED:
- `bun run --cwd core/durable typecheck` -> exit 0.
- `bun run --cwd apps/server typecheck` -> exit 0.
- `bun scripts/check-imports.ts` -> `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun run --cwd apps/server test -- web-tools` -> `ok   web-tools.test.ts  8 pass` / `8 pass, 0 fail across 1 files`.
- Output unchanged: 25 hand-picked cases (the existing fixtures plus malformed tags, unclosed tags, comments, nested openers, spaced close tags, upper case) are byte-identical between the old and new code.
- Timings, same machine, old vs new:
  - 64 KB of `<`: 5517.3 ms -> 2.0 ms.
  - 16,000 unclosed `<script>`: 2209.1 ms -> 7.7 ms.
  - 1 MB of `<` (new): 86.3 ms.
  - 50,000 unclosed `<script>` (new): 68.3 ms.
- The test file was run five more times and passed every time (the 200 ms budget holds in practice).

FAILED-BEFORE:
- Old code, the exact committed test at 50,000: `(fail) web_fetch > htmlToText finishes 50,000 unclosed script tags quickly [11883.06ms]` with `Received: 11882.841903`.
- Old code, 1 MB case at reduced size (30,000) because the full 1 MB case is quadratic and would take about 23 minutes: `(fail) web_fetch > htmlToText finishes 1 MB of bare '<' quickly [1419.53ms]`.

DEVIATIONS:
- The committed 1 MB `<` test was not run against the old code at full size. It is quadratic there (roughly 23 minutes on this machine), which exceeds the timebox. The failure was shown at 30,000 and the old-code 64 KB benchmark is 5517 ms, so the direction is proven.

FOLLOW-UPS:
- `BLOCK` at line 13 still uses `[^>]*`, which is quadratic on input like `"<p".repeat(n)`: 20,000 repetitions take 874.5 ms on the new code. Changing it to `[^<>]*` would bound it and stay byte-identical for well-formed tags.
- The comment pass `<!--[\s\S]*?-->` at line 17 is also quadratic on input like `"<!--".repeat(n)`: 20,000 repetitions take 617.1 ms on the new code. An indexOf scan for the first `-->` would bound it.

## Discoveries

Two more patterns in the same file are quadratic on hostile input, outside this unit's two named lines. Both are measured on the new code and reachable from the same callers (the web tool at up to 1 MB, routine watches at 256 KB).

1. `BLOCK` (line 13), `/<\/?(?:...)\b[^>]*>/gi`. The `[^>]*` rescans to the end from every `<tag` with no `>`, so `"<p".repeat(20_000)` takes 874.5 ms. Replacing `[^>]*` with `[^<>]*` bounds it and is byte-identical for well-formed tags, exactly like the change this unit made to the final tag strip.
2. The comment pass (line 17), `/<!--[\s\S]*?-->/g`. The lazy body rescans to the end from every `<!--` with no `-->`, so `"<!--".repeat(20_000)` takes 617.1 ms. Scanning with `indexOf("<!--")` then `indexOf("-->")` bounds it.

The head title path is now linear, so `"<head>" + "<title>".repeat(20_000) + "</head>"` takes 0.5 ms.


