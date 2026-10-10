# P17-04 Workers with the model or Jev

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 2 |
| Depends on | P17-03 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p17-04-workers-with-the-model-or-jev` |

## Verification

`bun yuki verify browser-run` passes twice with real keys, once with only Kernel and OpenCode Go, once with a TypeSafe key added. Each time, one `browser_run` with 3 tasks on 3 sites finishes all 3 at once, and main-model turns per task are at most 2. The suite prints and checks p50 step time, under 1.2 s with Jev and under 2.5 s without, and p50 Jev input tokens per decision under 1,500. A forced low-confidence page hands back with the top 3 options. A login page stops and asks for a takeover.

## Task

**Goal.** A worker takes the clicks, the main model plans, and parallel tasks run at once. Jev is used only when the user has a TypeSafe key.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/browser-worker.ts`, `apps/server/test/browser-worker.test.ts`, `apps/cli/src/verify/suites/browser-jev.ts`.

**Build.**

- The candidate cut, the single Choice, value selection, and the hand-back table from "How a step is chosen". The question text is a constant, and so are the thresholds.
- `browser_run` with up to 4 workers, one tab each, sharing the agent's socket.
- Jev ranks `browse` passages for `find`, with one Noul a passage, about 20 passages in one request.
- Confirm that pi-ai `classify` returns per-option probabilities and confidence for a Choice. If it does not, call `POST https://api.typesafe.ai/v1/systemone` through egress, and record the DEVIATION.
- Each worker checks the takeover flag before each action.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
