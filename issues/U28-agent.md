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
