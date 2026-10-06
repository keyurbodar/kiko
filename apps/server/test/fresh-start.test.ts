import { expect, test } from "bun:test"
import { CONTEXT_BUDGET_CHARS, startsFresh, TASK_BUDGET_CHARS, TASK_IDLE_MS } from "../src/agent/host"

// Section 13. When a new run starts over from <memory> and when it goes on with its transcript.
const minute = 60_000
const cases: [string, Parameters<typeof startsFresh>[0], boolean][] = [
  ["the first run", { inputs: 0, chars: 0, toolChars: 0, idleMs: 0 }, true],
  ["a short chat", { inputs: 5, chars: 20_000, toolChars: 2_000, idleMs: minute }, false],
  ["a long plain chat, still active", { inputs: 40, chars: CONTEXT_BUDGET_CHARS + 1, toolChars: 5_000, idleMs: minute }, true],
  ["a working task past the soft budget", { inputs: 6, chars: 150_000, toolChars: 120_000, idleMs: 2 * minute }, false],
  ["the same task after a long pause", { inputs: 6, chars: 150_000, toolChars: 120_000, idleMs: TASK_IDLE_MS + 1 }, true],
  ["a working task past the hard cap", { inputs: 9, chars: TASK_BUDGET_CHARS + 1, toolChars: 200_000, idleMs: minute }, true],
]

for (const [name, transcript, fresh] of cases) {
  test(`${name}: ${fresh ? "starts fresh" : "goes on"}`, () => expect(startsFresh(transcript)).toBe(fresh))
}
