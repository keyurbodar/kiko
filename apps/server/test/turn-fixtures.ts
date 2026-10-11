// Shared by `turn.test.ts` and the worker it builds. No imports, so Bun can load it outside workerd.

export const BEFORE = ["before: one moment.", Array.from({ length: 6 }, (_, i) => `before paragraph ${i + 1} with some words in it.`).join("\n\n")]
export const AFTER = "after one.\n\nafter two."
