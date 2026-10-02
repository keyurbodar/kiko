// Shared by `agent-host.test.ts` and the worker it builds. No imports, so Bun can load it outside workerd.

/** A user message that contains this gets the long answer. */
export const SLOW = "slow"
/** About 4 seconds of faux streaming at 50 tokens a second. */
export const LONG_ANSWER = "one two three four five six seven eight nine ten ".repeat(16).trim()
