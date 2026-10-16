import { type Agent, type AgentSlug, type Chat, KIKO, KIKO_HOME_ROOM, type RoomId } from "@kiko/protocol"

/*
 * The pure rules of the chat list (architecture section 7.11): which chats the sidebar shows, and
 * which chat the app opens when the URL names none. The store and the routes only call these.
 */

/** The agent every user has. It is not stored, so it is never missing. */
export const BUILTIN_AGENT: Agent = { id: KIKO, name: "Kiko", slug: KIKO as AgentSlug, prompt: "", model: "" }

/** The user's agents with the built-in one first. */
export function agentList(stored: readonly Agent[]): Agent[] {
  return [BUILTIN_AGENT, ...stored.filter((a) => a.id !== BUILTIN_AGENT.id)]
}

/** The pinned Kiko tile of an account whose cache is empty. It has the id the server gives a new account, so the server copy replaces it in place. */
export function kikoPlaceholder(now: number): Chat {
  return { roomId: KIKO_HOME_ROOM, title: "Kiko", pinned: true, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: now, agents: [KIKO], kiko: true }
}

/** The chats the sidebar lists: all of them, with the Kiko chat first, since it is the first pinned tile. */
export function rosterChats(chats: readonly Chat[]): Chat[] {
  const kiko = chats.findIndex((c) => c.kiko)
  return kiko > 0 ? [chats[kiko]!, ...chats.slice(0, kiko), ...chats.slice(kiko + 1)] : [...chats]
}

/**
 * The chat to open when the URL names none. The first of `wanted` (this device's last chat, then
 * the server's) that is in the list, else the kiko chat. Before the list has
 * loaded, this device's last chat is trusted, so the first paint never waits; the chat route sends
 * the reader on if it turns out to be gone.
 */
export function resumeChat(chats: readonly Chat[], loaded: boolean, wanted: readonly (string | null | undefined)[]): RoomId | null {
  if (!loaded) return (wanted.find(Boolean) as RoomId | undefined) ?? null
  for (const id of wanted) {
    const chat = id ? chats.find((c) => c.roomId === id) : undefined
    if (chat) return chat.roomId
  }
  return chats.find((c) => c.kiko)?.roomId ?? null
}

/** The chat that takes `id`'s place in a list once it leaves: the one below it, else the one above, else none. */
export function chatAfter(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id)
  const rest = ids.filter((other) => other !== id)
  return rest[at] ?? rest[at - 1] ?? null
}

/**
 * Chats that share a title (older installs made several agents with one name) get " 2", " 3" so
 * no two rows look alike. The lowest room id keeps the plain title. Nothing is hidden or deleted.
 */
export function distinctTitles(chats: readonly Chat[]): Chat[] {
  const seen = new Map<string, number>()
  const suffix = new Map<string, string>()
  for (const c of [...chats].sort((a, b) => (a.roomId < b.roomId ? -1 : 1))) {
    const key = c.title.trim().toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) suffix.set(c.roomId, `${c.title.trim()} ${n}`)
  }
  return suffix.size ? chats.map((c) => (suffix.has(c.roomId) ? { ...c, title: suffix.get(c.roomId)! } : c)) : [...chats]
}
