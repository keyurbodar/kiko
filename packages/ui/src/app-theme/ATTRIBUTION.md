# Attribution — app-theme (t3code role engine)

The role engine in this directory is derived from T3 Code, MIT licensed, © 2026 T3 Tools Inc.

- Upstream repository: <https://github.com/T3Tools/t3code> (local read-only checkout at `refs/t3code/`)
- Upstream files: `packages/shared/src/themePalettes.ts`, `apps/web/src/themePalette.ts`
- License: MIT (full text below)

## Copied

| Upstream path | Local path | Notes |
| --- | --- | --- |
| `packages/shared/src/themePalettes.ts` | `shared.ts` | Verbatim, byte-identical copy. Holds the 57 `THEME_COLOR_ROLES`, `ThemeDefinition`, reserved ids, and the 5 built-in palettes (t3-chat, grove, ocean, ember, iris) plus the T3 Code light/dark defaults. |
| `apps/web/src/themePalette.ts` (selected logic) | `parse.ts` | Color canonicalization, validators, `parseThemeFile` / `serializeThemeFile`, built-in lookups. |
| `apps/web/src/themePalette.ts` (selected logic) | `apply.ts` | `--kiko-*` variable map, palette application, preview, appearance resolution. |

## Deliberate changes

- `ThemePreference` is a plain `string` alias. Upstream declares it with `effect/Schema`; the
  client has no effect dependency.
- Variables are `--kiko-<role>` (camelCase lowered with hyphens). Upstream uses `--app-theme-<role>`.
  Prefixing keeps the two engines in this package from colliding.
- The vivid palette engine (`createVividThemeColors`), OKLCH gamut-derivation helpers, guided
  editor family updates, localStorage CRUD for custom themes, theme halves, sidebar artwork, and
  environment-published themes are not copied. They are product features of T3 Code, not part of
  the file format.
- `extend.ts` is new Kiko code, not copied: typography, sugar-high (`--sh-*`), markdown, and syntax
  token bridges layered on top of the t3 role set.

## Dependency

- `culori` `4.0.2` (runtime) and `@types/culori` `^4.0.1` (dev) — the same color parser upstream
  uses (`import "culori/css"` plus `culori/fn`). The `culori/css` bootstrap is required for hex
  parsing: `culori/fn` alone parses `oklch()` but returns `undefined` for `#131313`.

## Format

`{ "version": 1, "id", "name", "appearance": "light" | "dark", "colors": { <role>: <css color> },
"variants"?: { "light"?: {...}, "dark"?: {...} } }`. Colors are decoded to canonical
`oklch(L C H)` form; `variants` may not repeat the base appearance. Missing roles fall back to the
flagship t3-chat palette for that mode, so a theme file may ship only the roles it changes.

## License

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
