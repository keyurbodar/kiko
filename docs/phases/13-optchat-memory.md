# Phase 13. Memory after OptChat

The OptMem author published OptChat, a spec of an endless chat whose history is its memory ([research](../research/optchat.md)). This phase takes what it measured to be better and leaves what does not fit yuki. Architecture sections 8 and 13 have every decision.

The owner asked for this phase on 2026-10-05, asked that OptChat's folded view ship only if it measured better, and gave full authority over it. It did not measure better and was deleted. The rest shipped in one change, so the tasks below record what was built and how each part is verified.

## Tasks

### P13-01 Summarize long items whole, without ids, for half the thinking

`deps: none` `difficulty: 3` `area: backend` `parallel: no`

**Verify.** `bun yuki verify memory-hard` scores at least 14 of 15 with deepseek-v4.1-flash, and `bun yuki verify memory-eval` still scores at least 9 of 10. `bun run --cwd apps/server test` passes `test/optmem.test.ts` (free nodes, the prompt has no ids and keeps a long item whole) and `test/log-memory.test.ts`.

**Goal.** A summary loses nothing in a long item and costs no more than memo's.

**Files.** `apps/server/src/lib/optmem.ts`, `room/memory.ts`, `user/life.ts`, `user/user-do.ts`, `apps/cli/src/verify/suites/memory-eval.ts`, `memory-hard.ts`.

**Build.**

- memo's prompt with each item whole, no ids, and a limit of 40 words instead of 280 bytes.
- Free nodes. No context, no retries, no ranked prompt: each was measured to cost more, and the owner asked that memory use no more than before.

### P13-05 Retry a summary whose call failed

`deps: none` `difficulty: 2` `area: backend`

**Verify.** `bun run --cwd apps/server test` passes the failed-page test in `test/optmem.test.ts`.

**Goal.** A page whose call failed while later pages were built is built again, so no stretch of a chat stays unsummarized.

**Files.** `apps/server/src/lib/optmem.ts`.

### P13-02 Never show cut text as if whole

`deps: P13-01` `difficulty: 2` `area: backend`

**Verify.** `bun run --cwd apps/server test` passes the cut-line test in `test/optmem.test.ts` and the floor test in `test/log-memory.test.ts`.

**Files.** `apps/server/src/lib/optmem.ts`, `room/memory.ts`.

**Build.**

- A cut line says so and how to zoom. The floor and the delta still cut a turn at 300 characters.
- `zoom` of one turn no longer cuts each message at 400 characters.

### P13-03 Keep what failed in a run's trace

`deps: none` `difficulty: 1` `area: backend`

**Verify.** `bun run --cwd apps/server test` passes `test/presence.test.ts`.

**Files.** `apps/server/src/agent/extensions/presence.ts`, `room/memory.ts`.

### P13-04 Give helpers the chat's memory

`deps: none` `difficulty: 2` `area: backend`

**Verify.** `bun yuki verify subagent` passes its memory case: a helper finds a code word said earlier in the chat with `recall`.

**Files.** `apps/server/src/agent/extensions/subagent.ts`, `extensions/memory.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `apps/cli/src/verify/suites/subagent.ts`.

**Build.**

- `note` is its own extension, so a helper keeps `recall` and `zoom` without it.
- No memory block in the helper's first message: the read tools cost nothing until used.
- The dev routes `usage`, `trace`, and `children` no longer open an agent that has had no delivery. Opened that way, the agent was built with no home: no memory tools and no role, for the life of the process. The suites that poll them early measured that broken agent.
