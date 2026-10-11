# Phase 16. Initiative: open loops and learned attention

The owner asked for this on 2026-10-10. Yuki should keep the human's open loops and speak up rarely, at a moment learned from the human's own rhythm, never from a fixed clock or cue words. The work is shipped. Architecture section 26 has the decisions and the reasons.

## Tasks

### P16-01 Open loops store and detectors

`deps: none` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun yuki verify initiative` passes with the real model: a stated goal becomes one loop whatever detector sees it first, and a deleted message forgets its loops.

**Goal.** Keep the human's goals, plans, deadlines, waits, and agents' promises as open loops, found by model judgment.

**Files.** `core/memory/src/loops.ts`, `core/memory/src/loop-tool.ts`, `apps/server/src/user/`, `apps/server/src/initiative/judge.ts`, `apps/server/src/agent/factory.ts`.

**Build.**

- Table `loops` with FTS5 in `UserDO`. A repeat merges into the same loop and never crosses owners.
- Three detectors share one write path: the agent's `loop` tool, a batched Jev classify of each burst, and the summary pass of the memory model.
- A private chat keeps no loops.

### P16-02 Attention engine and nudges

`deps: P16-01` `difficulty: 5` `area: backend` `parallel: no`

**Verify.** `bun yuki verify initiative` passes: a nudge goes out only in the human's usual window, an ignored kind backs off, and a dismissal drops the loop.

**Goal.** Decide when to nudge from learned rhythm and appetite. Replace the daily check-in and the stall sweep.

**Files.** `apps/server/src/initiative/`, `apps/server/src/room/wake.ts`, `apps/server/src/room/signals.ts`, `apps/server/src/room/brief.ts`, `apps/server/src/agent/`.

**Build.**

- A decayed histogram of message times sets the moment. A Beta posterior per kind sets the appetite.
- One verdict per candidate: rest, brief, or nudge. At most one nudge per room and one per pass at digest.
- A nudge is one wake. Its run may only read, message, and use the `loop` tool.
- The brief carries `you owe`, `related`, and `on their plate` lines. A skip counts against its kind.

### P16-03 Client surfaces and settings

`deps: P16-01` `difficulty: 2` `area: frontend` `parallel: yes`

**Verify.** `bun run --cwd apps/web-solid test` passes and `bun scripts/bundle-budget.ts` is unchanged. In the browser, the On your plate page refreshes when an agent speaks.

**Goal.** Show open loops in the details panel and set the initiative level in Settings.

**Files.** `apps/web-solid/src/chat/info/loops.tsx`, `apps/web-solid/src/chat/info/panel.tsx`, `apps/web-solid/src/settings/initiative.tsx`, `core/protocol/src/loops.ts`.

**Build.**

- Done, tomorrow, and drop apply at once and roll back with a toast.
- The list refreshes on panel open, page show, and room activity, debounced.
- The Initiative page has four levels and three capture modes. Saves are serialized per field.
