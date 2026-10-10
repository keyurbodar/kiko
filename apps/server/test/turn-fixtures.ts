// Shared by `turn.test.ts` and the worker it builds. No imports, so Bun can load it outside workerd.

/** The faux run before the crash: a short note with a tool call, then six paragraphs. Each model turn is one bubble, so a crash lands between the two. */
export const BEFORE = ["before: one moment.", Array.from({ length: 6 }, (_, i) => `before paragraph ${i + 1} with some words in it.`).join("\n\n")]
/** The different faux answer after the crash. */
export const AFTER = "after one.\n\nafter two."
