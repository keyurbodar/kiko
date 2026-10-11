# U05 Spike: can a human message stop a running tool, and should ask stop waiting

**Model** Opus 5.5 medium. **Wave** 1. **Read-only** (no worktree, no edits). **Timebox** 75 min.

## Questions
1. AGENTS.md rule 4 says a human message can interrupt work. Today `core/agent/src/mid-run.ts` steers after a running tool round, and bash can run up to 120 s (`apps/server/src/files/bash.ts`). Can an arriving human message abort the running tool through `pi-durable`'s public extension points only (AGENTS.md forbids patching it)? Read the installed `pi-durable` package under `node_modules`, `core/agent/src/host.ts`, `mid-run.ts`, and how tools get an AbortSignal. Answer yes or no with the exact API, and sketch the smallest change if yes.
2. `ask` holds the run open up to 120 s on an in-object `setTimeout` (`core/agent/src/answers.ts`, `apps/server/src/agent/extensions/messaging.ts`). Option A: keep the wait, label it a DEVIATION. Option B: the agent asks and ends its run; the human's reply arrives as the next burst (`messaging.ts` already does this after the wait expires). Which is simpler and better for the human? What breaks in option B: tests, CLI suites (`team-ask` and others under `apps/cli/src/verify/suites`), the client under `apps/web-solid/src` (search for ask, answer)?
3. `RoomDO.endRun` (`apps/server/src/room/room-do.ts` near 860) marks the run ended after side effects. Is moving `markEnded` first safe, or must each side effect be keyed by run id?

## Report
For each question: the answer, evidence as `file:line`, the recommended change in under 15 lines of prose, files it touches, and the test that would fail before it. Say plainly when the answer is "leave it".
