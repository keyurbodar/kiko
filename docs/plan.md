# Kiko v1

Kiko is an open-source chat product. An agent is a participant you talk to, not a tool you invoke.

---

## What v1 is

v1 is the interface and nothing else. It renders a complete conversation and every state around it. It runs on local fixtures. It does not talk to a server.

There is no backend in v1. No database, no Convex, no worker, no auth, no networking of any kind. All data lives in `apps/web-solid/src/lib/fixtures.ts` as static modules.

The point of building this way is that interface decisions are cheap now and expensive later. A UI that renders from fixtures makes every state reachable without a server, and it leaves the types as the only thing a later data layer has to respect.

---

## What v1 contains

**The roster sidebar.** Rows and groups and a rail. A row carries an avatar, a label, an optional second line, unread state, and a hover-revealed action cluster. Groups collapse and expand. The rail is the narrow form of the same sidebar.

**The top bar.** The title of the open conversation and the controls that belong to it.

**The thread.** A single column of messages, scrolled and measured. It reads as one transcript, not a stack of cards.

**A linear transcript.** A message is text on a background — no bubble, no box, no per-message fill. Consecutive messages from one sender inside a time window collapse into a run, and the run carries the sender's avatar and name once, at its top. Every later message in the run indents beneath it with no avatar and no repeated name.

**Date dividers and timestamps.** A divider marks a change of day and stays pinned to the top of the viewport while its messages are on screen. A timestamp sits beside the sender's name, quiet, and reveals the full date on hover. A run's later messages show theirs in the gutter, and only on hover.

**Reactions.** A message can carry emoji reactions with a count. Clicking a chip the reader has already used removes it. The picker hangs off the hover action cluster, not a separate surface.

**Inline replies.** A reply nests under the message it answers, one level deep, and renders as a short quoted line above its own body. No thread panel, no side column, no second scroll.

**The waiting state.** An agent that is working shows a row of pulsing dots under the last message. It disappears the moment the message lands. Nothing blocks the composer or the scroll.

**The composer.** Text entry and send.

**The empty state.** What the thread shows before there is anything in it.

**The jump-to-latest pill.** When the viewport is away from the bottom and a message arrives, a pill appears offering to return. It never yanks the view. The reader's place is the thing being protected.

---

## What v1 excludes

These are out by decision, not by neglect.

- Attachments
- Markdown
- Code blocks
- Syntax highlighting
- Tool calls
- Reasoning traces
- Thread panels and nested replies deeper than one level
- Editing and deletion
- Search indexing
- Settings
- Paging to older messages. `loadEarlier` and its tests exist, but no sentinel is rendered and `hasOlder` is false, because the fixtures are the whole history and there is nothing older to fetch. The claim that a reader's position survives a load cannot be verified with nothing to load.
- The loading skeleton and the error surface. Both components exist and neither is mounted. v1 has no async, so neither state can be reached, and the states that can are the empty thread and the waiting row.

A message in v1 is text. Anything that would render a non-text payload is out of scope.

---

## Sourcing rule

Look in a fixed order. **pi-do/web-legacy first, then akeru-bot, then t3code.** That is a priority order, not a menu.

For UI, use the **opencode v2 set in `packages/ui/src/v2`**, **npm packages**, or the **shadcn registry through the CLI**. Never vendor a file by hand. Never hand-build a component.

Layout a component does not ship is ours to style, in the slice's own stylesheet, against our own `data-*` attributes. v2 components style themselves through `data-component` and `data-slot`; do not reach for class names that do not exist.

t3code is the exception where copying logic is acceptable.

---

## Parallelisation

One writer per file. Two agents never edit the same file at the same time, and a file with no owner is worse than a file with a slow owner.

Freeze the contract before fanning work out. Types, prop shapes, and token names get declared and agreed first. Once they are frozen, slices can run side by side against them instead of waiting on each other's values.

**The failure that taught this.** `packages/ui/src/components/bubble.tsx` was wanted by two slices and owned by neither. Both slices assumed the other would land it. It sat broken until one of them took it. A shared file with no named owner is not shared work, it is dropped work.

---

## What comes after v1

Undecided. No data layer, no backend, no schedule for either. Anything beyond the interface is a decision to make once v1 exists and can be looked at.
