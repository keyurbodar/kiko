# Attribution

The composer in this directory is copied from the opencode session UI package
(`@opencode-ai/session-ui`), which is MIT licensed, © 2025 opencode.

## What was copied

| File | Upstream path |
| --- | --- |
| `prompt-input/index.tsx` | `packages/session-ui/src/v2/components/prompt-input/index.tsx` |
| `prompt-input/interaction.ts` | `packages/session-ui/src/v2/components/prompt-input/interaction.ts` |
| `prompt-input/machine.ts` | `packages/session-ui/src/v2/components/prompt-input/machine.ts` |
| `prompt-input/store.ts` | `packages/session-ui/src/v2/components/prompt-input/store.ts` |
| `prompt-input/types.ts` | `packages/session-ui/src/v2/components/prompt-input/types.ts` |
| `prompt-input/attachments.ts` | `packages/session-ui/src/v2/components/prompt-input/attachments.ts` |
| `prompt-input/attachments.css` | `packages/session-ui/src/v2/components/prompt-input/attachments.css` |
| `editor-dom.ts` | `packages/app/src/components/prompt-input/editor-dom.ts` |
| `attachment-card-v2.tsx` | `packages/session-ui/src/v2/components/attachment-card-v2.tsx` |
| `attachment-card-v2.css` | `packages/session-ui/src/v2/components/attachment-card-v2.css` |
| `comment-card-v2.tsx` | `packages/session-ui/src/v2/components/comment-card-v2.tsx` |

## What was changed

- Import specifiers repointed from `@opencode-ai/*` to `@kiko/ui/*`.
- `FilePartSource`, previously imported from `@opencode-ai/sdk/v2/client`, is
  declared locally in `prompt-input/types.ts`. Kiko has no SDK.
- `typeLabel` in `type-label.ts` drops the `shiki` dependency upstream pulls for
  its language-name table, in favour of a local extension map.
- `getFilename` and `getFilenameTruncated` in `path.ts` are local
  implementations of `@opencode-ai/core/util/path`, which Kiko does not vendor.
- `composer.tsx` is Kiko-authored. It builds the controller against fixtures and
  Kiko's frozen contract instead of the opencode SDK.
- `prompt-input/index.tsx` was restyled to a single-row Discord-like layout:
  controls pinned to the top of the box, a larger type size, and a placeholder
  driven by a local `blank` signal rather than `controller.value()`. The
  contenteditable, part reconciliation and event wiring are upstream's.

Unmodified: `machine.ts`, `store.ts`, `attachments.ts`, `editor-dom.ts`, and
the two card components. The controller, reducer, part store and DOM
reconciliation are upstream's.

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
