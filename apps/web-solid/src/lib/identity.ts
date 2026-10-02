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

/** The agent a chat made without a pick talks to. It matches the server's `DEFAULT_AGENT`. */
export const DEFAULT_AGENT_SLUG = "kiko"

/**
 * The seed for a chat's avatar. A chat with one agent wears that agent's face, as a Telegram
 * chat with a bot shows the bot, so the same bot looks the same in the chat list, the tab,
 * the header, the members list, and its bubbles. Only a group has a face of its own.
 */
export function chatSeed(chat: { roomId: string; agents?: readonly string[] }, agents: readonly { id: string; slug: string }[]): string {
  const ids = chat.agents ?? []
  if (ids.length > 1) return chat.roomId
  if (!ids.length) return DEFAULT_AGENT_SLUG
  return agents.find((a) => a.id === ids[0])?.slug ?? ids[0]!
}
