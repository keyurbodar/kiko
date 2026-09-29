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
| `src/styles/kiko.css` | Token bridge (in `packages/ui`) |

## Slice-owned

Each slice owns its whole directory. Nothing here is edited by another slice.

| Slice | Branch | Owns |
| --- | --- | --- |
| Chat | `chat` | `src/chat/**` |
| Composer | `composer` | `src/composer/**` |
| Sidebar | `sidebar` | `src/sidebar/**` |

CSS is per-slice for the same reason: `chat.css` in `src/chat/`, and so on.
Three slices writing one stylesheet is a three-way merge on every visual tweak.

## The one file nobody owns

`src/main.tsx` composes the three. It is edited once, on `main`, after the
slices land — not during. A slice that needs a new prop on the composition
raises it rather than reaching for the file.
