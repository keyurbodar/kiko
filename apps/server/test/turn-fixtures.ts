// Shared by `turn.test.ts` and the worker it builds. No imports, so Bun can load it outside workerd.

/** The faux answer before the crash. Six paragraphs, so a crash lands between two of them. */
export const BEFORE = Array.from({ length: 6 }, (_, i) => `before paragraph ${i + 1} with some words in it.`).join("\n\n")
/** The different faux answer after the crash. */
export const AFTER = "after one.\n\nafter two."
