# U28 Agent: a human message stops a running tool, and stop reaches ask

**Model** Haiku 5.5 medium (escalate to Sonnet if blocked). **Wave** 2. **Depends on** U01 landed. **Port** 8828. **Timebox** 2.5 h.

## Goal
AGENTS.md rule 4: a human message can interrupt work. Today a human arriving during a tool round only steers after the round, and bash can hold 120 s. Read `issues/U05-spike-agent.md` first; it is the design and the evidence.

## Build
1. `core/agent/src/mid-run.ts`: `decide` returns a new action `interrupt` when a human arrives while `run.toolRunning` (today `steer`). Update the comment near line 30.
2. `core/agent/src/host.ts` `drain`: on `interrupt`, submit the human input with `whenBusy: "steer"` first, then find the root's running tasks with `harness.inspect` (`kind === "pi.tool"`, `conversationId === root.id`, `state.kind === "running"`) and call `harness.abortTask(id, context).catch(() => {})` for each WITHOUT awaiting.
3. A host option `interruptible?: (toolName: string) => boolean`. `AgentDO` builds it from the effect table: `read` tools plus `bash` and `ask`. Tools with `write`, `message`, or `external` effects are never aborted mid-flight.
4. ask honors abort: `AnswerWaiters.wait(id, ms, signal?)` settles `null` on abort and clears its timer; `MessagingPort.waitAnswer` takes the signal; `ask.execute` passes `context.abortSignal` (`apps/server/src/agent/extensions/messaging.ts:68`, `apps/server/src/agent/agent-do.ts` near 247).
5. Small fixes: `core/agent/src/host.ts:393-396` sets `steered=1` before submit; swap the order. `core/agent/src/inbox.ts:206-207` puts slug and reason into XML attributes unescaped; escape them. `apps/server/src/agent/extensions/spill.ts:33-40` re-encodes per line; keep a running byte count.
6. `docs/architecture.md` sections 6.2 and 7.8: one or two sentences on interrupt. Section 7.5: one sentence that ask's wait is a bounded tool wait recovered by safe replay, not scheduled work.

## Tests (each fails before)
- `apps/server/test/mid-run.test.ts`: human during a running tool returns `interrupt`.
- `apps/server/test/answers.test.ts`: an aborted signal ends the wait at once (under 50 ms).
- `apps/cli/src/verify/suites/mid-run.ts` "steer during a tool" (lines 93-107): with the fake slow tool, a human message during the tool gets an answer within 3 s that says the tool was aborted. Run `bun yuki verify mid-run --url http://localhost:8828`.
- spill: a test with many short lines that fails on time today.

## Scope
`core/agent/src/{mid-run,host,answers,inbox}.ts`, `apps/server/src/agent/{agent-do.ts,extensions/messaging.ts,extensions/spill.ts}`, the named tests, the named doc sections.

## Report

**STATUS** done (the mid-run suite passed on the merged tree; one earlier run failed on a 25 s wait under load, see FOLLOW-UPS)

**BRANCH** s/u28-agent

**HEAD** 4f73f728e27610e2d6c6666760ef1b814c2eae74 (merge of main). The report commit follows it.

**CHANGED**
- `core/agent/src/mid-run.ts`: `decide` returns `interrupt` when a human arrives while a tool runs.
- `core/agent/src/host.ts`: `interrupt` submits a steer, then aborts each stoppable running tool without awaiting. Budget steer is marked sent after submit. New `interruptible` option. Tool name is read from the assistant entry.
- `core/agent/src/answers.ts`: `wait(id, ms, signal?)` ends at once on abort and clears its timer.
- `core/agent/src/text.ts`: `escapeAttr` (escapes quotes too).
- `core/agent/src/inbox.ts`: work, agent, and system attributes use `escapeAttr`.
- `apps/server/src/agent/factory.ts`: `BuiltAgent.effects`; `stoppable(effects, tool)`: read, `bash`, or `ask`.
- `apps/server/src/agent/agent-do.ts`: `interruptible` option, `effects` set in both setup branches, `waitAnswer` passes the signal.
- `apps/server/src/agent/extensions/messaging.ts`: `ask` passes `context.abortSignal` to `waitAnswer`.
- `apps/server/src/agent/extensions/spill.ts`: `head` keeps a running byte count.
- `apps/cli/src/verify/suites/mid-run.ts`: "steer during a tool" expects an answer within 3 s that says the tool was aborted.
- `apps/server/test/mid-run.test.ts`, `answers.test.ts`, `spill.test.ts`: new or changed cases.
- `apps/server/test/inbox-render.test.ts` (new): quotes in attributes.
- `apps/server/test/stoppable.test.ts` (new): the stoppable policy.
- `docs/architecture.md`: 6.2 (table row, reasoning, DEVIATION, UNVERIFIED), 7.5 (ask wait sentence), 7.8 (bullet).

**VERIFIED**
- `bun run typecheck` → `10 of 10` packages `Exited with code 0`, exit 0.
- `bun scripts/check-imports.ts` → `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bunx biome check apps/server core apps/cli scripts` → exit 0; warnings are in files this branch does not change.
- `bun scripts/check-rules.ts` → `check-rules ok in 98 ms` (report-only items; the `setTimeout` in `core/agent/src/answers.ts:23` predates this change).
- `bun scripts/check-exports.ts` → `check-exports ok: 199 files, 209 baselined`.
- `bun run --cwd apps/server test -- <file> --no-cache` on the merged tree: mid-run 18 pass, answers 6 pass, spill 6 pass, inbox-render 3 pass, stoppable 3 pass, agent-factory 6 pass, work-tools 6 pass.
- `bun yuki verify mid-run --url http://localhost:8828` → `pass mid-run (35086ms)` on the merged tree. All four cases ok, including `steer during a tool` (`heard: [tool] check | also this; tool: <harness>[error] Tool slow_tool was aborted</harness>`).
- `bun yuki verify team-ask --url http://localhost:8828` → `pass team-ask (6463ms)`.

**FAILED-BEFORE** (each run on the unchanged code, with the new tests in place)
- `mid-run.test.ts` "a tool is running: interrupt it, then steer": `expect(received).toBe(expected)` (received steer, expected interrupt). Same for "a bubble was posted and a tool is running: interrupt".
- `answers.test.ts` "an aborted signal ends the wait at once, with no answer": timed out at 5003 ms, the wait ignored the signal. "a signal that is already aborted ends the wait at once": 5012 ms.
- `spill.test.ts` "a result of many short lines is cut to its start quickly": `expect(received).toBeLessThan(expected)` at 557 ms against a 100 ms limit. The benchmark on 200 KB of one-byte lines was 368 ms per call.
- `inbox-render.test.ts`: all 3 fail with `expect(received).toContain(expected)` (the quote closed the attribute).
- `mid-run` CLI "steer during a tool": `timed out waiting for an answer that says the tool was aborted; statuses typing,working; bubbles []`.
- `stoppable.test.ts`: not run on the old code. It imports `stoppable`, which did not exist, so it could not have passed.

**DEVIATIONS**
- The brief assumed the tool name is in the running task. It is not: a `pi.tool` input is `{assistant, callId}` (`ToolTaskInput`). `toolName()` in `host.ts` reads the name from the assistant entry with `root.entries` (one read per stopped tool).
- The policy `stoppable` lives in `factory.ts`, next to the effect table. `AgentDO` stores the table in `this.effects`. The dev fake branch in `setup()` returns before the real `buildAgent` call, so `this.effects` is set in both branches.
- Two test files are new. The brief named no test for the attribute escape or the policy, and standing order 6 requires one per behavior change.
- `escapeAttr` is new. `escapeXml` escapes no quotes, so I left it unchanged; body text output is the same.
- `decide` returns `interrupt` for `toolRunning` even when inputs are queued. The old queued rule only matters with no tool running. Pinned by a row in `mid-run.test.ts`.
- The docs label the queue behavior UNVERIFIED (see FOLLOW-UPS). The 6.2 DEVIATION bullet is my addition, as section 6.2 changed.
- `apps/web-solid/dist` was built in this worktree so `wrangler dev` could start. It is gitignored and not committed.
- The `agent-do.ts` merge conflict was U29's `DEV` constant. I kept main's line and added my assignment after it.

**FOLLOW-UPS**
- `mid-run` "steer after a bubble" waits 25 s for an answer. It timed out once in 11 post-change runs, when the load average was about 15. The other 10 passed. Four more runs passed with the wait set to 60 s, and the file is back at 25 s. Raise the wait, or make the slow tool's timing fixed.
- UNVERIFIED (labeled in `architecture.md` 6.2): a tool stop leaves queued inputs in place. Settle it with a live case: queue a steer while a tool runs and check it still lands.
- No CLI suite covers a human message stopping an `ask` or `bash` call end to end. Only the unit tests and the `slow_tool` case do.
- A tool that ignores its signal takes about 1.9 s to return from `abortTask` (spike measurement). The drain does not wait for it, so it does not add to the answer time.

## Discoveries
- A `pi.tool` task's input does not hold the tool name, so anything that needs the name must read the assistant entry.
- `escapeXml` in `core/agent/src/text.ts` does not escape quotes. Any value in an XML attribute needs `escapeAttr`. I checked only `inbox.ts`.
- The dev fake setup path in `AgentDO.setup()` returns before the real build. Per-setup state has to be set in both branches.
- `scripts/test-each.ts` caches by a hash of the whole tree and prints `cached` without running. Use `--no-cache` for fresh evidence.
- `wrangler dev` needs `apps/web-solid/dist` to exist. A fresh worktree has none, and `bun run --cwd apps/web-solid build` creates it.
