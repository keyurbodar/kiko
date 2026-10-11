# U05 Spike: can a human message stop a running tool, and should ask stop waiting

**Model** Opus 5.5 medium. **Wave** 1. **Read-only** (no worktree, no edits). **Timebox** 75 min.

## Questions
1. AGENTS.md rule 4 says a human message can interrupt work. Today `core/agent/src/mid-run.ts` steers after a running tool round, and bash can run up to 120 s (`apps/server/src/files/bash.ts`). Can an arriving human message abort the running tool through `pi-durable`'s public extension points only (AGENTS.md forbids patching it)? Read the installed `pi-durable` package under `node_modules`, `core/agent/src/host.ts`, `mid-run.ts`, and how tools get an AbortSignal. Answer yes or no with the exact API, and sketch the smallest change if yes.
2. `ask` holds the run open up to 120 s on an in-object `setTimeout` (`core/agent/src/answers.ts`, `apps/server/src/agent/extensions/messaging.ts`). Option A: keep the wait, label it a DEVIATION. Option B: the agent asks and ends its run; the human's reply arrives as the next burst (`messaging.ts` already does this after the wait expires). Which is simpler and better for the human? What breaks in option B: tests, CLI suites (`team-ask` and others under `apps/cli/src/verify/suites`), the client under `apps/web-solid/src` (search for ask, answer)?
3. `RoomDO.endRun` (`apps/server/src/room/room-do.ts` near 860) marks the run ended after side effects. Is moving `markEnded` first safe, or must each side effect be keyed by run id?

## Report
For each question: the answer, evidence as `file:line`, the recommended change in under 15 lines of prose, files it touches, and the test that would fail before it. Say plainly when the answer is "leave it".

## Report (written by the coordinator from the read-only spike, Opus 5.5)

1. **Tool abort: yes.** `Harness.abortTask(id, context)` is public in pi-durable (`dist/harness/types.d.ts:493-497`). Aborting the running `pi.tool` task makes the tool return "Tool X was aborted", and a steer queued first lands right after it in the same run (`generation.js:502-513`). Measured with a faux model: run done in 543 ms after abort. `abortTask` waits for the tool to return (1924 ms for a tool that ignores its signal), so never await it inside `drain()`. Bash already honors `context.abortSignal` (`apps/server/src/files/bash.ts:400,407`).
2. **ask: keep the wait (option A).** Option B costs every ask a second run and routes the answer through relay mail, where hop and root limits can drop it (`room/mail.ts:197`). The timer bounds a live tool call and is recovered by safe replay, so it is not scheduled work. Real bug: the wait ignores the abort signal (`messaging.ts:68` passes no context, `core/agent/src/answers.ts:7` takes no signal), so stop during an ask can hold the agent's alarm up to 120 s, and tool abort cannot cut an ask short.
3. **endRun: leave it.** Every side effect is already safe to run twice (`asks.ts:61-64`, `memory.ts:254-256`, `initiative-loops.ts:138-143`), and moving `markEnded` first would turn at-least-once into at-most-once.
