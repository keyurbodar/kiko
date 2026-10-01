# Attribution

The composer in this directory is copied from opencode, which is MIT licensed,
© 2025 opencode. Most of it comes from the session UI package
(`@opencode-ai/session-ui`); `editor-dom.ts` comes from `packages/app`.

Every statement in this file was checked by diffing this directory against
upstream commit `7945de208964a49300d7f770d1a71d078db9a4c4` on `sst/opencode`
`dev`. That branch moves, so the commit is the reference, not the branch name.

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
| `type-label.ts` | `packages/session-ui/src/components/message-file.ts` |
| `path.ts` | `packages/core/src/util/path.ts` |

## What was changed

- Import specifiers repointed from `@opencode-ai/*` to `@kiko/ui/*`, except
  `@opencode-ai/core/util/path` in `comment-card-v2.tsx`, which points at the
  local `./path` instead.
- `FilePartSource`, previously imported from `@opencode-ai/sdk/v2/client`, is
  declared locally in `prompt-input/types.ts`. Kiko has no SDK.
- `typeLabel` in `type-label.ts` drops the `shiki` dependency upstream pulls for
  its language-name table, in favour of a local extension map.
- `getFilename` and `getFilenameTruncated` in `path.ts` are local
  implementations of `@opencode-ai/core/util/path`, which Kiko does not vendor.
  `getFilenameTruncated` is not behaviourally equivalent: upstream keeps the
  extension and cuts from the front (`verylo…name.ts`), this cuts from the tail
  behind a leading ellipsis (`…name.ts`). Its only caller is
  `comment-card-v2.tsx`, which renders only when the host passes `comments`.
- `composer.tsx` is Kiko-authored. It builds the controller against fixtures and
  Kiko's frozen contract instead of the opencode SDK.
- `prompt-input/index.tsx` was restyled to a single-row Discord-like layout:
  controls pinned to the top of the box, a larger type size, and a placeholder
  driven by a local `blank` signal rather than `controller.value()`. The
  contenteditable, part reconciliation and event wiring are upstream's. Three
  smaller changes inside it are deliberate, but large enough to record rather
  than leave to a diff: the add-menu trigger and the submit button were both
  resized to 32px (`!size-8 !rounded-lg` on the trigger, `size-7 rounded-md
  p-[6px]` to `size-8 rounded-lg p-2` on the button), and the placeholder's
  unwrapped fallback text changed from the mode-aware
  `ui.promptInput.placeholder.normal` and `.shell` strings to
  `ui.promptInput.label`. The wording is why: upstream's normal-mode string
  advertises `/` for commands and `@` for context, and Kiko has no commands. A
  host that passes `view.placeholder` — Kiko does — never reaches that fallback.

Byte-identical to upstream: `prompt-input/machine.ts`, `prompt-input/store.ts`,
`prompt-input/attachments.ts`, `prompt-input/attachments.css` and
`editor-dom.ts`. The controller, reducer, part store and DOM reconciliation are
upstream's.

`attachment-card-v2.tsx` is NOT byte-identical: an interactive card is a native
`<button>`, where upstream shipped a `<div onClick>` with no role and no
keyboard path. A card with no `onClick` is still a `<div>`.

`comment-card-v2.tsx` is NOT byte-identical either. Its imports differ as
described above, and it observes with `createResizeObserver` from
`@solid-primitives/resize-observer` rather than a raw `new ResizeObserver`, so
the observer's teardown is owned by the primitive.

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
