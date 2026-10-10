# P17-02 A CDP client that reads and acts on a page

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p17-02-a-cdp-client-that-reads-and-acts` |

## Verification

`bun run --cwd packages/cdp test` passes against a scripted fake CDP server. `bun yuki verify browser-cdp` passes against a real Kernel browser from a Durable Object under `wrangler dev`. Two tabs load two sites in parallel. The page read returns ids and position hints. A click by id lands. A stale id is refused. Each step's time is printed, and a read must be under 400 ms at p50.

## Task

**Goal.** `@yuki/cdp` gives a Durable Object a fast, typed handle on browser tabs.

**Files.** `packages/cdp/` (new), `scripts/check-imports.ts`, `apps/server/src/agent/dev-browser.ts`, `apps/cli/src/verify/suites/browser-cdp.ts`.

**Build.**

- A CDP session on Effect 4. It is a scoped resource over one WebSocket, with a timeout per command and flat sessions per tab. Commands are typed from `devtools-protocol`.
- `openTab`, `closeTab`, and focus emulation, so background tabs keep rendering.
- The page script from "How a page is read", as a string constant, and `read(tab)`.
- `act(tab, step)` for click, type, select, press, scroll, and back. Clicks are real mouse events at the element's center after a fresh guard and geometry check. Typing is select-all, then `Input.insertText`. Then it settles as in the table.
- Popups and dialogs as in the failures table.
- `check-imports.ts` puts `packages/cdp` beside `packages/durable`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
