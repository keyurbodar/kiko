# Attribution

The files in this directory are copied from the opencode UI package (`@opencode-ai/ui`, version
1.18.33), which is MIT licensed, © 2025 opencode.

- Upstream repository: <https://github.com/anomalyco/opencode>
- Upstream package directory: `packages/ui`
- Copied from upstream `src/`, which is available in this repository as a read-only reference
  checkout at `solid-refs/opencodeai-ui/src/`.

## Copied files

| Upstream (`src/...`)        | Local path               |
| --------------------------- | ------------------------ |
| `theme/types.ts`            | `types.ts`               |
| `theme/color.ts`            | `color.ts`               |
| `theme/resolve.ts`          | `resolve.ts`             |
| `theme/loader.ts`           | `loader.ts`              |
| `theme/context.tsx`         | `context.tsx`            |
| `theme/index.ts`            | `index.ts`               |
| `theme/default-themes.ts`   | `default-themes.ts`      |
| `theme/v2/resolve.ts`       | `v2/resolve.ts`          |
| `theme/v2/mapping.ts`       | `v2/mapping.ts`          |
| `theme/v2/foreground.ts`    | `v2/foreground.ts`       |
| `theme/v2/avatar.ts`        | `v2/avatar.ts`           |
| `theme/v2/default-primitives.ts` | `v2/default-primitives.ts` |
| `theme/themes/*.json` (37 files) | `themes/*.json`     |
| `styles/theme.css`          | `../styles/theme.css`    |
| `context/helper.tsx`        | `../context/helper.tsx`  |

Every copied file is byte-identical to upstream, including the `$schema` fields of the theme
JSON files, with the two exceptions listed below.

## Kiko extensions

None. The first batch is byte-identical to upstream, including the `$schema` fields of the theme
JSON files.

An earlier revision carried Kiko typography and sugar-high fields on the opencode variant. Those
moved to the T3 role engine in `src/app-theme` (`extend.ts`), which owns typography, `--sh-*`,
markdown, and syntax tokens. The opencode engine is left exactly as upstream ships it, so
re-copying it stays a plain `cp`.

`context.tsx` is unmodified: it imports `../context/helper`, which resolves to the copied
`context/helper.tsx`.
## Batch 2 — v2 component set

A second batch was copied verbatim from the same upstream checkout to make the v2 component set
importable as `@kiko/ui/v2/*`. Every file below is byte-identical to upstream (no Kiko edits):

| Upstream (`src/...`)             | Local path                          | Files |
| -------------------------------- | ----------------------------------- | ----- |
| `v2/components/*.tsx`            | `../v2/components/*.tsx`            | 31    |
| `v2/components/*.css`            | `../v2/components/*.css`            | 29    |
| `v2/styles/colors.css`           | `../v2/styles/colors.css`           | 1     |
| `v2/styles/theme.css`            | `../v2/styles/theme.css`            | 1     |
| `v2/styles/tailwind.css`         | `../v2/styles/tailwind.css`         | 1     |
| `context/i18n.tsx`               | `../context/i18n.tsx`               | 1     |
| `i18n/en.ts`                     | `../i18n/en.ts`                     | 1     |
| `hooks/index.ts`                 | `../hooks/index.ts`                 | 1     |
| `hooks/use-filtered-list.tsx`    | `../hooks/use-filtered-list.tsx`    | 1     |
| `hooks/create-auto-scroll.tsx`   | `../hooks/create-auto-scroll.tsx`   | 1     |
| `components/file-icon.tsx`       | `../components/file-icon.tsx`       | 1     |
| `components/file-icon.css`       | `../components/file-icon.css`       | 1     |
| `components/file-icons/types.ts` | `../components/file-icons/types.ts` | 1     |
| `components/file-icons/sprite.svg` | `../components/file-icons/sprite.svg` | 1 |

The upstream directory layout is mirrored (`src/v2/…`, `src/context/…`, `src/components/…`,
`src/hooks/…`), so the components' relative imports (`../../context/i18n`,
`../../components/file-icon`, `../../hooks`) resolve unchanged and no import path was rewritten.

`v2/components/*.css` use `--v2-*` tokens. Those are **not** declared by the batch-1
`../styles/theme.css` (which is byte-identical to upstream `src/styles/theme.css`); they live in
`v2/styles/colors.css` and `v2/styles/theme.css`, which is why both were copied. Consumers enable
them by importing `@kiko/ui/v2/styles/tailwind.css` (it `@import`s `colors.css` + `theme.css`).

### Runtime dependencies added (pinned to the versions upstream `@opencode-ai/ui` 1.18.33 declares)

| Dependency                            | Version | Imported by                                      |
| ------------------------------------- | ------- | ------------------------------------------------ |
| `@kobalte/core`                       | 0.13.11 | accordion, button, checkbox, dialog, menu, radio, select, switch, tabs, tooltip, toast |
| `@solid-primitives/event-listener`    | 2.4.5   | `hooks/create-auto-scroll.tsx`                   |
| `@solid-primitives/resize-observer`   | 2.1.3   | `hooks/create-auto-scroll.tsx`                   |
| `fuzzysort`                           | 3.1.0   | `hooks/use-filtered-list.tsx`                    |
| `remeda`                              | 2.26.0  | `hooks/use-filtered-list.tsx`                    |
| `solid-list`                          | 0.3.0   | `hooks/use-filtered-list.tsx`                    |
| `solid-sonner`                        | 0.3.1   | `v2/components/toast-v2.tsx`                     |

### Deliberately not copied

Upstream v1 component styles, `marked*` context modules, `context/dialog.tsx`,
`context/file.tsx`, `context/worker-pool.tsx`, `assets/` (fonts, audio, icons), the locale
dictionaries other than `i18n/en.ts` (only `en` is imported by `context/i18n.tsx`), the
`file-icons` sprite's generator inputs, and `custom-elements.d.ts` (declares only the
`@pierre/diffs` element).

## License

MIT License

Copyright (c) 2025 opencode

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
