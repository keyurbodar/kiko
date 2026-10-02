/*
 * One source of truth for how an identity looks. The seed is the agent's slug
 * for an agent, and the room id for a group or a chat with no agent. Never a
 * display name, an index, a random value, or a chat title: those change, and
 * then the same bot looks different in each place that draws it.
 *
 * The blobatar shape and colours come from the blobatar package, seeded with the
 * same string. The accent is one of a fixed set of kat tokens, picked from a
 * hash of the seed.
 */
export const ACCENTS = [
  "var(--accent)",
  "var(--syntax-string)",
  "var(--syntax-regexp)",
  "var(--syntax-primitive)",
  "var(--syntax-property)",
  "var(--syntax-type)",
] as const

export type IdentityLook = {
  /** The string handed to the blobatar. Equal to the seed. */
  seed: string
  /** A CSS colour from the kat tokens. */
  accent: (typeof ACCENTS)[number]
}

/** FNV-1a, 32 bits. Stable across reloads and platforms. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function identityLook(seed: string): IdentityLook {
  return { seed, accent: ACCENTS[hash(seed) % ACCENTS.length]! }
}
