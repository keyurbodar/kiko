# Kiko v1

Kiko is an open-source chat product. An agent is a participant you talk to, not a tool you invoke.

---

## What v1 is

v1 is the interface and nothing else. It renders a complete conversation and every state around it. It runs on local fixtures. It does not talk to a server.

There is no backend in v1. No database, no Convex, no worker, no auth, no networking of any kind. All data lives in `apps/web/src/fixtures/` as static modules.

The point of building this way is that interface decisions are cheap now and expensive later. A UI that renders from fixtures makes every state reachable without a server, and it leaves the types as the only thing a later data layer has to respect.

---

## What v1 contains

**The roster sidebar.** Rows and groups and a rail. A row carries an avatar, a label, an optional second line, unread state, and a hover-revealed action cluster. Groups collapse and expand. The rail is the narrow form of the same sidebar.

**The top bar.** The title of the open conversation and the controls that belong to it.

**The thread.** The message column, scrolled and measured.

**Bubbles.** A message renders as a bubble. Consecutive messages from one sender group into a run, and the run carries the sender's identity once rather than on every message. Collapsed corners mark the run, so the first and last bubble of a run take a tighter radius on the side that faces the next bubble.

**Date dividers and timestamps.** A divider marks a change of day. A timestamp sits with the message metadata.

**The composer.** Text entry and send.

**The empty state.** What the thread shows before there is anything in it.

**The scroll-to-bottom pill.** It appears when the viewport is away from the bottom and returns you there.

---

## What v1 excludes

These are out by decision, not by neglect.

- Attachments
- Markdown
- Code blocks
- Syntax highlighting
- Tool calls
- Reasoning traces
- Search indexing
- Settings

A message in v1 is text. Anything that would render a non-text payload is out of scope.

---

## Sourcing rule

Look in a fixed order. **pi-do/web-legacy first, then akeru-bot, then t3code.** That is a priority order, not a menu.

For UI, use the **shadcn registry through the CLI** and **npm packages**. Never vendor a file by hand. Never hand-build a component. Never write custom CSS.

t3code is the exception where copying logic is acceptable.

---

## Parallelisation

One writer per file. Two agents never edit the same file at the same time, and a file with no owner is worse than a file with a slow owner.

Freeze the contract before fanning work out. Types, prop shapes, and token names get declared and agreed first. Once they are frozen, slices can run side by side against them instead of waiting on each other's values.

**The failure that taught this.** `packages/ui/src/components/bubble.tsx` was wanted by two slices and owned by neither. Both slices assumed the other would land it. It sat broken until one of them took it. A shared file with no named owner is not shared work, it is dropped work.

---

## What comes after v1

Undecided. No data layer, no backend, no schedule for either. Anything beyond the interface is a decision to make once v1 exists and can be looked at.
