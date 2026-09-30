# Slice ownership

One writer per file. A file with no named owner is dropped work, not shared
work — that failure is why this file exists.

## Frozen before the fan-out

Owned by the contract pass, committed to `main`, present in every worktree. Do
not edit these from a slice; if a shape is wrong, change it on `main` first and
let the slices pick it up.

| File | Purpose |
| --- | --- |
| `src/lib/types.ts` | Domain types and every slice's props |
| `src/lib/fixtures.ts` | Static v1 data |
| `src/lib/store.ts` | Shared state: selection, messages, bots |

Tokens are owned by the design system, not by a slice: every colour, radius
and type step is declared once in `packages/ui/src/styles/kat.css` and reaches
components as Tailwind utilities. A slice never writes a raw colour and never
edits that file.

## Slice-owned

Each slice owns its whole directory. Nothing here is edited by another slice.

| Slice | Branch | Owns |
| --- | --- | --- |
| Chat | `chat` | `src/chat/**` |
| Composer | `composer` | `src/composer/**` |

CSS is per-slice for the same reason: `chat.css` in `src/chat/`, and so on.
Two slices writing one stylesheet is a two-way merge on every visual tweak.

## The one file nobody owns

`src/main.tsx` composes the slices. It is edited once, on `main`, after the
slices land — not during. A slice that needs a new prop on the composition
raises it rather than reaching for the file.
