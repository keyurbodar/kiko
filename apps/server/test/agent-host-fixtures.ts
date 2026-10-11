// Shared by `agent-host.test.ts` and the worker it builds. No imports, so Bun can load it outside workerd.

export const SLOW = "slow"
export const LONG_ANSWER = "one two three four five six seven eight nine ten ".repeat(16).trim()
